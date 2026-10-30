/**
 * 火山引擎 SignatureV4 签名，用于调用管理面 API（`*.volcengineapi.com`）。
 *
 * 为什么需要它：方舟的**数据面**（`/api/v3/chat/completions`）用 ARK API Key 就够，
 * 但**管理面**（余额、用量、开通状态）只认 Access Key + Secret Key，走 AWS 风格的
 * SignatureV4（服务名 `ark`、区域 `cn-beijing`）。官方文档对此写得很明确：
 * 「查询推理用量……本接口仅支持 Access Key 鉴权」。
 *
 * 这里不引第三方 SDK：签名算法本身是稳定公开的，自己实现可以避免为一个签名拖进
 * 一个几十 MB 的依赖，也让"到底签了什么"这件事在代码里可读。
 *
 * @module dsh-connect-volcengine/signature
 */
import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'HMAC-SHA256'
const SERVICE = 'ark'
const REGION = 'cn-beijing'
const HOST = 'ark.cn-beijing.volcengineapi.com'
const API_VERSION = '2024-01-01'

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** 火山要求的时间戳形态：`YYYYMMDDTHHMMSSZ`。 */
function xDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
  )
}

/**
 * 调用一个管理面 Action。
 *
 * @param action 形如 `GetInferenceUsage`
 * @param body 请求体（会被 JSON 序列化并参与签名，签完必须原样发送）
 * @returns `{ ok, status, data, error }`，不抛异常
 */
export async function callManageApi({ accessKey, secretKey, action, body, timeoutMs = 20000 }) {
  const payload = JSON.stringify(body ?? {})
  const date = xDate()
  const shortDate = date.slice(0, 8)
  const contentSha256 = sha256Hex(payload)

  // 参与签名的头固定为这四个，顺序即 SignedHeaders 的顺序（必须字典序）。
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${contentSha256}\n` +
    `x-date:${date}\n`

  const canonicalQuery = `Action=${action}&Version=${API_VERSION}`
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    contentSha256,
  ].join('\n')

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`
  const stringToSign = [ALGORITHM, date, credentialScope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(secretKey, shortDate)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `${ALGORITHM} Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  try {
    const response = await fetch(`https://${HOST}/?${canonicalQuery}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: HOST,
        'x-content-sha256': contentSha256,
        'x-date': date,
        authorization,
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text.slice(0, 400) }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: data?.ResponseMetadata?.Error?.Message ?? data?.message ?? `HTTP ${response.status}`,
      }
    }
    return { ok: true, status: response.status, data }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: undefined,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 查询推理用量并按模型聚合。
 *
 * 返回 `{ models: { [modelId]: { inputTokens, outputTokens, totalTokens, requests } }, from, to }`。
 * 用 `Filters` 不传任何 Key 时返回全部列；这里只按 `ModelName` 拆开，足够回答
 * 「每个模型用了多少」。
 */
export async function fetchInferenceUsage({ accessKey, secretKey, days = 30, now = new Date() }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const end = new Date(now)
  const start = new Date(now.getTime() - (days - 1) * 86_400_000)

  const result = await callManageApi({
    accessKey,
    secretKey,
    action: 'GetInferenceUsage',
    body: {
      QueryInterval: 'Day',
      StartTime: fmt(start),
      EndTime: fmt(end),
      ProjectName: 'default',
      Filters: [{ Key: 'ModelName', Values: [] }],
    },
  })

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      status: result.status,
      hint:
        result.status === 401 || result.status === 403
          ? 'AK/SK 无效或缺少 ark 权限策略'
          : undefined,
    }
  }

  const payload = result.data?.Result ?? result.data
  const fields = Array.isArray(payload?.Fields) ? payload.Fields.map((f) => f.Name) : []
  const rows = Array.isArray(payload?.Data) ? payload.Data : []
  const idx = (name) => fields.indexOf(name)

  const iModel = idx('ModelName')
  const iIn = idx('InputTokens')
  const iOut = idx('OutputTokens')
  const iTotal = idx('TotalTokens')
  const iReq = idx('ReqCnt')

  const models = {}
  for (const row of rows) {
    const model = iModel >= 0 ? String(row[iModel]) : ''
    if (model === '') continue
    const bucket = (models[model] ??= { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 })
    bucket.inputTokens += Number(row[iIn] ?? 0)
    bucket.outputTokens += Number(row[iOut] ?? 0)
    bucket.totalTokens += Number(row[iTotal] ?? 0)
    bucket.requests += Number(row[iReq] ?? 0)
  }

  return { ok: true, models, from: fmt(start), to: fmt(end), fields, rowCount: rows.length }
}
