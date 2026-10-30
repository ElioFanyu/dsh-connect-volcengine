/**
 * dsh-connect-volcengine — 把火山方舟（Ark）的模型接入 DeepSeek Harness。
 *
 * 单 provider + 五栏卡片（账号 / 模型 / 能力 / 诊断）+ 多账号池。
 * Ark 是标准 OpenAI 兼容网关，一把 API Key 直连，不需要回环 shim。
 *
 * 关键事实全部来自官方文档与实测，不猜：
 * - 上下文窗口取自 https://ark.volcengine.com/region:cn-beijing/docs/model-list.md
 * - 用量查询（GetInferenceUsage）**仅支持 Access Key 鉴权**，ARK Key 读不到余额，
 *   所以卡片如实给控制台链接，不做假读数。
 *
 * @module dsh-connect-volcengine
 */
import z from '@deepseek-ai/schemastery'
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { fetchInferenceUsage } from './signature.js'

export const VOLC_SETTINGS_NS = 'dsh-connect-volcengine'
export const VOLC_PROVIDER = 'volcengine'
export const VOLC_PROVIDER_DISPLAY_NAME = '火山方舟 · Ark'
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const ARK_CONSOLE_USAGE_URL =
  'https://ark.volcengine.com/region:cn-beijing/usageTracking?usageTrackingTab=model'
export const ARK_CONSOLE_APIKEY_URL = 'https://ark.volcengine.com/region:cn-beijing/apikey'
export const VOLC_ROUTE_PREFIX = '/plugins/dsh-connect-volcengine'
export const VOLC_STREAM_IDLE_TIMEOUT_MS = 300_000

const REQUEST_IMAGE_BUDGETS = Object.freeze({
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
})

const NO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** 「DSH 上下文预算」档位；0 = 用原生窗口。 */
export const CONTEXT_BUDGET_CHOICES = Object.freeze([0, 131_072, 262_144, 524_288, 1_000_000])

/**
 * 账号已开通的模型清单（来源：方舟控制台「开通管理」导出）。
 *
 * 这是**账号级事实**：`/models` 列出的是平台全量目录，其中大部分对本账号返回
 * 404（未开通）。所以刷新逻辑优先用这份清单过滤——只有这里列出的才可能真正调用。
 *
 * `freeUsed` / `freeTotal` 是控制台显示的免费推理额度，仅用于展示。
 * 已用完（used == total）的模型仍然保留：它们**能调用**，只是开始计费，隐藏起来
 * 反而让人以为没有这个模型。
 */
export const ENTITLED_MODELS = Object.freeze([
  { id: 'kimi-k3-1-pro-261024', freeUsed: 1_602, freeTotal: 500_000 },
  { id: 'deepseek-v4-1-flash-economy-261017', freeUsed: 32, freeTotal: 500_000 },
  { id: 'doubao-seed-2-1-lite-260915', freeUsed: 500_000, freeTotal: 500_000 },
  { id: 'deepseek-v4-1-flash-261017', freeUsed: 1_278, freeTotal: 500_000 },
  { id: 'glm-5-3-flash-260828', freeUsed: 2_050, freeTotal: 500_000 },
  { id: 'deepseek-v4-pro-ga-260813', freeUsed: 500_000, freeTotal: 500_000 },
  { id: 'deepseek-v4-flash-ga-260731', freeUsed: 0, freeTotal: 500_000 },
  { id: 'glm-5-2-260617', freeUsed: 0, freeTotal: 500_000 },
  { id: 'doubao-seed-evolving', freeUsed: 0, freeTotal: 5_500_000 },
  { id: 'doubao-seed-2-1-turbo-260628', freeUsed: 3_066, freeTotal: 500_000 },
  { id: 'doubao-seed-2-0-mini-260428', freeUsed: 2_878, freeTotal: 500_000 },
  { id: 'doubao-seed-2-0-lite-260428', freeUsed: 1_516, freeTotal: 500_000 },
  { id: 'doubao-seed-2-1-pro-260915', freeUsed: 500_000, freeTotal: 500_000 },
  { id: 'deepseek-v4-pro-260425', freeUsed: 0, freeTotal: 500_000 },
  { id: 'doubao-seed-2-0-code-preview-260215', freeUsed: 343, freeTotal: 500_000 },
  { id: 'doubao-seed-2-0-pro-260215', freeUsed: 0, freeTotal: 500_000 },
  { id: 'doubao-seed-character-260628', freeUsed: 0, freeTotal: 500_000 },
  { id: 'doubao-seed-translation-250915', freeUsed: 0, freeTotal: 500_000 },
])

const ENTITLED_IDS = new Set(ENTITLED_MODELS.map((m) => m.id))

/** 模型是否在本账号的开通清单里。清单为空时不拦截（当作「未知」而不是「全都没有」）。 */
function isEntitled(id) {
  return ENTITLED_IDS.size === 0 ? true : ENTITLED_IDS.has(id)
}

/**
 * 官方模型规格（`docs/model-list.md`，2026-10-26 版）。
 *
 * 这是**权威来源**，不是探测值。`contextWindow` 是模型的上下文窗口（最大输入），
 * `maxOutput` 是"最大回答"。两者是不同的量，混用会让压缩时机与长度校验全错。
 * 早期版本把 `max_tokens` 闸门当上下文窗口写死 256K，对 `*-2-1-pro-260915` 这类
 * 1M 模型是明显错的。
 *
 * `vision` 取自同一文档的多模态/视觉理解能力章节。
 * `multimodal` 在插件里仍可手工覆盖，但默认值来自这里。
 */
export const OFFICIAL_MODELS = Object.freeze([
  // ── 1M 上下文 ──
  { id: 'doubao-seed-evolving', name: 'Doubao-Seed-Evolving', contextWindow: 1_048_576, maxOutput: 262_144, vision: true },
  { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao-Seed-2.1-Pro (260915)', contextWindow: 1_048_576, maxOutput: 262_144, vision: true },
  { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao-Seed-2.1-Lite', contextWindow: 1_048_576, maxOutput: 262_144, vision: true },
  { id: 'glm-5-3-flash-260828', name: 'GLM-5.3-Flash', contextWindow: 1_048_576, maxOutput: 131_072, vision: true },
  { id: 'glm-5-2-260617', name: 'GLM-5.2', contextWindow: 1_048_576, maxOutput: 131_072, vision: false },
  { id: 'kimi-k3-1-pro-261024', name: 'Kimi-K3.1-Pro', contextWindow: 1_048_576, maxOutput: 1_048_576, vision: true },
  { id: 'deepseek-v4-1-flash-261017', name: 'DeepSeek-V4.1-Flash', contextWindow: 1_048_576, maxOutput: 393_216, vision: true },
  { id: 'deepseek-v4-1-flash-economy-261017', name: 'DeepSeek-V4.1-Flash-Economy', contextWindow: 1_048_576, maxOutput: 393_216, vision: true },
  { id: 'deepseek-v4-pro-ga-260813', name: 'DeepSeek-V4-Pro', contextWindow: 1_048_576, maxOutput: 393_216, vision: false },
  { id: 'deepseek-v4-flash-ga-260731', name: 'DeepSeek-V4-Flash', contextWindow: 1_048_576, maxOutput: 393_216, vision: false },
  // ── 256K 上下文 ──
  { id: 'doubao-seed-2-1-pro-260628', name: 'Doubao-Seed-2.1-Pro', contextWindow: 262_144, maxOutput: 262_144, vision: true },
  { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao-Seed-2.1-Turbo', contextWindow: 262_144, maxOutput: 262_144, vision: true },
  { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao-Seed-2.0-Lite', contextWindow: 262_144, maxOutput: 131_072, vision: true },
  { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao-Seed-2.0-Mini', contextWindow: 262_144, maxOutput: 131_072, vision: true },
  { id: 'doubao-seed-2-0-code-preview-260215', name: 'Doubao-Seed-2.0-Code', contextWindow: 262_144, maxOutput: 131_072, vision: true },
  { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao-Seed-2.0-Pro', contextWindow: 262_144, maxOutput: 131_072, vision: true },
  // ── 128K / 更小 ──
  { id: 'doubao-seed-character-260628', name: 'Doubao-Seed-Character', contextWindow: 131_072, maxOutput: 32_768, vision: true },
  { id: 'doubao-seed-translation-250915', name: 'Doubao-Seed-Translation', contextWindow: 4_096, maxOutput: 3_072, vision: false },
])

const NON_CHAT_PATTERNS = [
  /embedding/i,
  /rerank/i,
  /seedream/i,
  /seedance/i,
  /seed3d/i,
  /hyper3d/i,
  /hitem3d/i,
  /seaweed/i,
  /-t2v-/i,
  /-i2v-/i,
  /-t2i-/i,
  /-i2i-/i,
  /flf2v/i,
  /^wan2-/i,
]

function looksLikeChatModel(id) {
  return !NON_CHAT_PATTERNS.some((pattern) => pattern.test(id))
}

// ───────────────────────────── Config ─────────────────────────────

function asVolatile(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

function unwrapVolatile(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * 一个账号。
 *
 * `ref` 是**凭据引用名**（宿主 credentials 里的键），不是密钥本身：配置文件里
 * 永远只留引用名。多个账号就是多条记录，各自有独立的 ref。
 */
const accountConfig = z.object({
  id: z.string().required().description('稳定 id（创建时生成，改引用名不会丢状态）'),
  label: z.string().default('').description('显示名；留空则由引用名推导'),
  ref: z.string().required().description('凭据引用名，Key 存在于宿主凭据库'),
  enabled: z.boolean().default(true).description('是否参与轮换'),
})

const modelConfig = z.object({
  id: z.string().required().description('Ark 模型 id，同时也是线路上的 model 字段'),
  name: z.string().required().description('选择器里显示的名字'),
  contextWindow: z.number().step(1).min(0).default(0).description('上下文窗口；0 表示未知'),
  maxOutput: z.number().step(1).min(1).default(32_768).description('单次最大输出（上游 max_tokens 闸门）'),
  contextBudget: z
    .number()
    .step(1)
    .min(0)
    .default(0)
    .description('DSH 上下文预算：0 表示用原生窗口；只影响何时压缩'),
  multimodal: z.boolean().default(false).description('是否原生支持图片输入'),
  enabled: z.boolean().default(true).description('是否出现在模型选择器里'),
})

export const Config = z.object({
  enabled: asVolatile(z.boolean().default(true).description('是否注册这个供应商')),
  baseURL: asVolatile(z.string().default(ARK_DEFAULT_BASE_URL).description('Ark 网关地址')),
  accounts: asVolatile(z.array(accountConfig).default([]).description('账号池：每条一个凭据引用')),
  activeAccountId: asVolatile(z.string().default('').description('当前选中的账号 id；空则用第一个可用')),
  poolEnabled: asVolatile(
    z.boolean().default(false).description('启用账号池自动换号：某个账号失败时改用下一个可用账号重试'),
  ),
  models: asVolatile(z.array(modelConfig).default([]).description('已保存的模型目录')),
  imageToolEnabled: asVolatile(z.boolean().default(false).description('允许模型自主调用生图工具（真实计费）')),
  imageModel: asVolatile(
    z.string().default('doubao-seedream-3-0-t2i-250415').description('生图工具使用的模型 id'),
  ),
  /**
   * 管理面凭据（可选）。存的是**凭据引用名**，不是密钥本身。
   *
   * ARK API Key 只能走数据面（`/api/v3/chat/completions`）；余额与用量在管理面，
   * 只认 Access Key / Secret Key（SignatureV4）。填了这两个引用就能真读用量，
   * 不填则卡片只显示"去控制台看"。
   */
  accessKeyRef: asVolatile(z.string().default('').description('火山 Access Key 的凭据引用名（读用量用，可留空）')),
  secretKeyRef: asVolatile(z.string().default('').description('火山 Secret Key 的凭据引用名（读用量用，可留空）')),
})

/** 老配置没有 accounts 时，用单一的 ARK_API_KEY 合成一条，保证升级不丢可用性。 */
const LEGACY_REF = 'ARK_API_KEY'

function accountsOf(raw) {
  const list = Array.isArray(raw.accounts) ? raw.accounts : []
  if (list.length > 0) {
    return list.map((account, index) => ({
      id: typeof account.id === 'string' && account.id !== '' ? account.id : `acc-${index + 1}`,
      label: typeof account.label === 'string' ? account.label : '',
      ref: typeof account.ref === 'string' && account.ref !== '' ? account.ref : LEGACY_REF,
      enabled: account.enabled !== false,
    }))
  }
  // 迁移：单 ref 时代
  const ref = typeof raw.apiKeyRef === 'string' && raw.apiKeyRef !== '' ? raw.apiKeyRef : LEGACY_REF
  return [{ id: 'default', label: '', ref, enabled: true }]
}

/**
 * 目录按**名称**排序，不是按 id。
 *
 * 名称是人读的（`Doubao-Seed-2.1-Pro`），id 里带着日期后缀（`-260915`），按 id
 * 排会让同一系列的不同版本按发布日期散开，在列表里几乎找不到。用 `localeCompare`
 * 且指定 `zh`，数字段（2.1 / 2.0）才会按数值而不是字符顺序落位。
 */
function sortByName(models) {
  return [...models].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh', { numeric: true }))
}

function modelsOf(raw) {
  const saved = Array.isArray(raw.models) ? raw.models : []
  if (saved.length > 0) {
    return sortByName(
      saved.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow ?? 0,
        maxOutput: m.maxOutput ?? 32_768,
        contextBudget: m.contextBudget ?? 0,
        multimodal: m.multimodal === true,
        enabled: m.enabled !== false,
      })),
    )
  }
  // 首次运行：只给**本账号已开通**的模型。未开通的 id 在上游返回 404，
  // 列进来只会让人点到就报错。
  const official = new Map(OFFICIAL_MODELS.map((m) => [m.id, m]))
  const seeded = ENTITLED_MODELS.map((entitled) => {
    const spec = official.get(entitled.id)
    return {
      id: entitled.id,
      name: spec?.name ?? entitled.id,
      contextWindow: spec?.contextWindow ?? 0,
      maxOutput: spec?.maxOutput ?? 32_768,
      contextBudget: 0,
      multimodal: spec?.vision === true,
      enabled: true,
    }
  })
  return sortByName(seeded)
}

function configOf(config) {
  const raw = unwrapVolatile(config) ?? {}
  const accounts = accountsOf(raw)
  const activeId = typeof raw.activeAccountId === 'string' ? raw.activeAccountId : ''
  return {
    enabled: raw.enabled !== false,
    baseURL: typeof raw.baseURL === 'string' && raw.baseURL !== '' ? raw.baseURL : ARK_DEFAULT_BASE_URL,
    accounts,
    activeAccountId: accounts.some((a) => a.id === activeId) ? activeId : (accounts[0]?.id ?? ''),
    poolEnabled: raw.poolEnabled === true,
    models: modelsOf(raw),
    imageToolEnabled: raw.imageToolEnabled === true,
    imageModel:
      typeof raw.imageModel === 'string' && raw.imageModel !== ''
        ? raw.imageModel
        : 'doubao-seedream-3-0-t2i-250415',
    accessKeyRef: typeof raw.accessKeyRef === 'string' ? raw.accessKeyRef : '',
    secretKeyRef: typeof raw.secretKeyRef === 'string' ? raw.secretKeyRef : '',
  }
}

export function settingsNamespaceOf(ctx) {
  const id = ctx?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : VOLC_SETTINGS_NS
}

function windowLabel(value) {
  if (!value || value <= 0) return '?'
  if (value >= 1_000_000) return `${(value / 1_048_576 >= 0.97 ? 1 : value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(value / 1024)}K`
}

function displayNameOf(model) {
  const window = model.contextWindow
  return window > 0 ? `${model.name} · ${windowLabel(window)}` : model.name
}

function inputOf(model) {
  return model.multimodal === true ? ['text', 'image'] : ['text']
}

function toPiModel(model, baseUrl) {
  const window = model.contextWindow > 0 ? model.contextWindow : 131_072
  return {
    id: model.id,
    name: displayNameOf(model),
    api: 'openai-completions',
    provider: VOLC_PROVIDER,
    baseUrl,
    input: inputOf(model),
    cost: NO_COST,
    contextWindow: window,
    maxTokens: model.maxOutput > 0 ? model.maxOutput : 32_768,
    reasoning: false,
  }
}

// ───────────────────────────── adapter ─────────────────────────────

/**
 * 装配 PiAiAdapter，并支持多账号。
 *
 * 选号策略：`activeAccountId` 指定优先；账号池开启时，`resolveApiKey` 依次尝试
 * 池内账号（可用优先），任一解析成功即用。pi-ai 的重试由宿主 `llm-retry` 负责，
 * 这里只保证"这一次解析出一个能用的 Key"。
 */
function createVolcAdapter(options) {
  const { configOf: readConfig, resolveApiKeyFor, onAuthFailure, resolveAttachments } = options

  const catalog = () => readConfig().models.filter((m) => m.enabled !== false)
  const buildModels = () => {
    const cfg = readConfig()
    return catalog().map((m) => toPiModel(m, cfg.baseURL))
  }

  const provider = {
    ...createProvider({
      id: VOLC_PROVIDER,
      name: VOLC_PROVIDER_DISPLAY_NAME,
      auth: {
        apiKey: {
          name: 'Volcengine Ark API key',
          async resolve({ credential }) {
            const key = credential?.key
            if (key === undefined || key.length === 0) return undefined
            return { auth: { apiKey: key }, source: 'Ark' }
          },
        },
      },
      models: buildModels(),
      api: openAICompletionsApi(),
    }),
    getModels: () => buildModels(),
  }

  /** profiles 的 key 必须是 provider 名：`PiAiAdapter.profileOf()` 按它查表。 */
  const profile = () => ({
    provider: VOLC_PROVIDER,
    displayName: VOLC_PROVIDER_DISPLAY_NAME,
    streamIdleTimeoutMs: VOLC_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-connect-volcengine retryPolicy'),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    reasoning: 'off',
    ...REQUEST_IMAGE_BUDGETS,
    piProvider: provider,
  })

  let profiles = new Map([[VOLC_PROVIDER, profile()]])

  const inner = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async (provider) => {
      if (provider !== VOLC_PROVIDER) return undefined
      const picked = await resolveApiKeyFor()
      if (picked === undefined) {
        throw new LlmError(
          'dsh-connect-volcengine: 账号池里没有可用的 Ark API Key；在插件卡片的「账号」栏添加一个后即可使用',
          'MISSING_CREDENTIAL',
        )
      }
      lastPicked = picked
      return picked.key
    },
    auth: {
      credentials: {
        async read() {},
        async list() {
          return []
        },
        async modify() {
          throw new Error('dsh-connect-volcengine: Ark 路由没有 pi-ai 凭据生命周期')
        },
        async delete() {},
      },
      authContext: {
        async env() {},
        async fileExists() {
          return false
        },
      },
    },
    ...(resolveAttachments === undefined ? {} : { resolveAttachments }),
  })

  /**
   * 账号池的换号执行层。
   *
   * `resolveApiKey` 只能挑一个 Key，它无法知道这个 Key 上游认不认——所以真正的
   * "换下一个账号"必须发生在**看到 AUTH 失败之后**。这里包住 adapter 的流：
   * 一旦终态是鉴权失败，把该账号标记为失败、重新解析一个账号、整条请求重放一次。
   *
   * 为什么只在 AUTH 上重试：同一个请求体换谁发都是 400，那不值得再花一次额度；
   * 而 401 是「这个人没资格」，换个人大概率能过。限流（429）也不换——队列跟的是
   * 模型与平台，换账号拿到的还是同一个位次。
   */
  let lastPicked

  /**
   * 把一次派发包成"先跑一遍，AUTH 失败就换号再来一遍"。
   *
   * 正常路径逐块透传（不缓冲），因为终态判断只需要记住最后一个 chunk。
   */
  const wrap = (run) =>
    async function* wrapped() {
      const first = lastPicked?.accountId
      let retried = false
      for (;;) {
        let finishChunk
        for await (const chunk of run()) {
          if (chunk.type === 'finish') finishChunk = chunk
          else yield chunk
        }
        const failure = finishChunk?.reason?.kind === 'error' ? finishChunk.reason.failure : undefined
        const isAuth =
          failure !== undefined && (failure.code === 'AUTH' || failure.status === 401 || failure.status === 403)
        if (!isAuth || retried || onAuthFailure === undefined || first === undefined) {
          if (finishChunk !== undefined) yield finishChunk
          return
        }
        retried = true
        onAuthFailure(first)
        const next = await resolveApiKeyFor()
        if (next === undefined || next.accountId === first) {
          if (finishChunk !== undefined) yield finishChunk
          return
        }
        lastPicked = next
      }
    }

  const adapter = {
    providerInfo: (p) => inner.providerInfo(p),
    providerRetryPolicy: (p) => inner.providerRetryPolicy(p),
    imageRequestPricing: (p, m) => inner.imageRequestPricing(p, m),
    imageRequestTarget: (p, m, img) => inner.imageRequestTarget(p, m, img),
    listModels: (p) => inner.listModels(p),
    resolveModel: (p, m, s) => inner.resolveModel(p, m, s),
    /**
     * `prepareCall` 返回的 `stream` 走的是**另一条**派发路径（宿主用 prepareCall
     * 固化配置后再吐 chunk），所以它必须单独包一层；只包 `stream()` 会漏掉
     * 菜单里真正被点的那条路。
     */
    async prepareCall(provider, model, signal) {
      const call = await inner.prepareCall(provider, model, signal)
      return {
        model: call.model,
        stream: (options) => wrap(() => call.stream(options))(),
      }
    },
    stream: (options) => wrap(() => inner.stream(options))(),
  }

  return {
    adapter,
    invalidate: () => {
      profiles = new Map([[VOLC_PROVIDER, profile()]])
    },
  }
}

// ───────────────────────────── discovery ─────────────────────────────

async function fetchArkModels({ baseURL, apiKey, signal }) {
  const root = baseURL.replace(/\/+$/u, '')
  const response = await fetch(`${root}/models`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status === 404 || response.status === 405) return { supported: false, models: [] }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let detail = text.slice(0, 200)
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.error?.message ?? detail
    } catch {
      /* 上游偶尔返回纯文本 */
    }
    throw new LlmError(
      `Ark ${root}/models 返回 ${response.status}${detail === '' ? '' : `：${detail}`}`,
      response.status === 401 || response.status === 403 ? 'AUTH' : 'DISCOVERY_FAILED',
    )
  }
  const body = await response.json().catch(() => undefined)
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  return {
    supported: true,
    models: rows.flatMap((row) => {
      const id = typeof row?.id === 'string' ? row.id : typeof row?.name === 'string' ? row.name : undefined
      if (id === undefined || id === '') return []
      if (!looksLikeChatModel(id)) return []
      // 平台目录里绝大部分模型对本账号是未开通的（调用返回 404）。开通清单是本账号
      // 的权威边界，不在里面的直接丢弃——列出来只会让人点到就报错。
      if (!isEntitled(id)) return []
      // 目录里能拿到的就用官方表补规格，拿不到的留 0（未知），不编。
      const official = OFFICIAL_MODELS.find((m) => m.id === id)
      const entitled = ENTITLED_MODELS.find((m) => m.id === id)
      return [
        {
          id,
          name: official?.name ?? (typeof row.display_name === 'string' && row.display_name !== '' ? row.display_name : id),
          contextWindow: official?.contextWindow ?? 0,
          maxOutput: official?.maxOutput ?? 32_768,
          multimodal: official?.vision === true,
          freeUsed: entitled?.freeUsed,
          freeTotal: entitled?.freeTotal,
        },
      ]
    }),
  }
}

// ───────────────────────────── web helpers ─────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function requireLoopback(req, res) {
  const address = req.socket?.remoteAddress ?? ''
  const ok = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (!ok) {
    sendJson(res, 403, { error: 'loopback only' })
    return false
  }
  if (req.method === 'POST') {
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '') {
      try {
        const url = new URL(origin)
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1') {
          sendJson(res, 403, { error: 'cross-origin refused' })
          return false
        }
      } catch {
        sendJson(res, 403, { error: 'cross-origin refused' })
        return false
      }
    }
  }
  return true
}

async function readJsonBody(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// ───────────────────────────── image tool ─────────────────────────────

const DRAW_TOOL_NAME = 'volcengine_draw_image'

const DRAW_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: '画面描述（中文或英文都可以），写清楚主体、风格、构图、光线。' },
    size: {
      type: 'string',
      description: '图片尺寸，写成「宽x高」。常用：1024x1024 方图、1024x1536 竖图、1536x1024 横图。不填用 1024x1024。',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
}

function registerDrawTool(ctx, deps) {
  const render = (_args, value) => {
    const url = typeof value?.url === 'string' ? value.url : ''
    const note = typeof value?.note === 'string' ? value.note : ''
    return [{ type: 'text', text: url === '' ? note : `${note}\n${url}`.trim() }]
  }
  return ctx.tools.register({
    name: DRAW_TOOL_NAME,
    description:
      '用火山方舟（Ark）的生图模型画一张图。每张图都真实计费；上游返回 24 小时有效的签名 URL。只在用户明确要求画图时调用。',
    parameters: DRAW_TOOL_SCHEMA,
    output: {
      schema: {
        type: 'object',
        properties: { url: { type: 'string' }, note: { type: 'string' } },
        additionalProperties: false,
      },
      render,
    },
    async execute(args) {
      const cfg = deps.configOf()
      const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
      if (prompt === '') throw new Error('dsh-connect-volcengine: prompt 不能为空')
      const size = typeof args?.size === 'string' && args.size !== '' ? args.size : '1024x1024'
      const picked = await deps.resolveApiKeyFor()
      if (picked === undefined) throw new Error('dsh-connect-volcengine: 账号池里没有可用的 API Key')

      const response = await fetch(`${cfg.baseURL.replace(/\/+$/u, '')}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${picked.key}` },
        body: JSON.stringify({ model: cfg.imageModel, prompt, size, response_format: 'url' }),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`Ark 生图失败（${response.status}）：${text.slice(0, 400)}`)
      let body
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error('Ark 生图返回的不是 JSON')
      }
      const url = body?.data?.[0]?.url
      if (typeof url !== 'string' || url === '') throw new Error('Ark 生图没有返回图片 URL')
      return { url, note: `已生成（${picked.label} · ${cfg.imageModel} · ${size}）。链接约 24 小时后失效。` }
    },
  })
}

// ───────────────────────────── apply ─────────────────────────────

export const inject = ['llm']

export function apply(ctx, config) {
  const settingsNs = settingsNamespaceOf(ctx)
  let cfg = configOf(config)
  const configOfLive = () => cfg

  const refreshConfig = () => {
    const settings = ctx.get('settings')
    const live = settings?.describe?.()?.find((row) => String(row.ns) === settingsNs)?.value
    if (live !== undefined && live !== null) cfg = configOf(live)
  }

  /** 读一个账号的 Key。 */
  const readKey = async (account) => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(account.ref)
      if (hit !== undefined && hit.value.length > 0) return hit.value
      return undefined
    }
    const fromEnv = process.env[account.ref]
    return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : undefined
  }

  /**
   * 某个账号最近被上游拒绝过，暂时跳过它。
   *
   * 只记**确定性失败**（401/403 鉴权失败），不记网络抖动：一个真的坏 Key 换掉是对的，
   * 一次超时就冷落一个健康账号是错的。冷却只活在内存里，重启即清空——上游的判定
   * 随时可能变，把它写进配置文件会让一个早就好了的账号永远进不了池子。
   */
  const cooldowns = new Map()
  const COOLDOWN_MS = 10 * 60 * 1000
  const isCoolingDown = (accountId) => {
    const until = cooldowns.get(accountId)
    if (until === undefined) return false
    if (Date.now() >= until) {
      cooldowns.delete(accountId)
      return false
    }
    return true
  }
  const markAccountFailure = (accountId, status) => {
    if (status === 401 || status === 403) cooldowns.set(accountId, Date.now() + COOLDOWN_MS)
  }

  /** 上一次探测的结果，进程内缓存；重启即清空（可达性随时会变，不该落盘）。 */
  let probeCache

  /** 读一个管理面凭据引用（AK 或 SK）。 */
  const readManageKey = async (ref) => {
    if (typeof ref !== 'string' || ref === '') return undefined
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      return hit !== undefined && hit.value.length > 0 ? hit.value : undefined
    }
    const fromEnv = process.env[ref]
    return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : undefined
  }

  /**
   * 选一个可用账号并解析 Key。
   *
   * 顺序：当前选中账号 → 池内其它启用账号（池关闭时只用选中账号）。
   * 返回 `{ key, accountId, label }`；一个都解析不出来时返回 undefined，
   * 由调用方决定是报 MISSING_CREDENTIAL 还是如实报"没 Key"。
   */
  /**
   * 选一个账号并解析 Key。
   *
   * 顺序：当前选中账号 → 池内其它启用账号（池关闭时只用选中账号）。
   *
   * **这里的"可用"只是"配了 Key"，不是"Key 在上游有效"。** 后者只有发一次请求才知道，
   * 而 `resolveApiKey` 是每次派发前同步等待的钩子，在里面做网络探测会把每轮对话都
   * 拖慢一个往返。真正的前缀失效换号由 {@link markAccountFailure} 记录、下一次选号
   * 时跳过，再配合宿主的 `llm-retry` 那一层完成——两段职责分开，谁都不假装知道
   * 自己不知道的事。
   */
  const resolveApiKeyFor = async () => {
    const live = cfg
    const enabled = live.accounts.filter((a) => a.enabled)
    if (enabled.length === 0) return undefined
    const ordered = []
    const active = enabled.find((a) => a.id === live.activeAccountId)
    if (active !== undefined) ordered.push(active)
    if (live.poolEnabled) {
      for (const account of enabled) if (account.id !== live.activeAccountId) ordered.push(account)
    }
    for (const account of ordered) {
      if (isCoolingDown(account.id)) continue
      const key = await readKey(account).catch(() => undefined)
      if (key !== undefined && key !== '') {
        return { key, accountId: account.id, label: account.label || account.ref }
      }
    }
    // 全都在冷却里：宁可回退到第一个配了 Key 的账号，也不要让用户完全不能用。
    for (const account of ordered) {
      const key = await readKey(account).catch(() => undefined)
      if (key !== undefined && key !== '') {
        return { key, accountId: account.id, label: account.label || account.ref }
      }
    }
    return undefined
  }

  let adapter = createVolcAdapter({
    configOf: configOfLive,
    resolveApiKeyFor,
    onAuthFailure: (accountId) => markAccountFailure(accountId, 401),
    resolveAttachments: () => ctx.get('attachments'),
  })
  let handle
  /**
   * 只在**首次挂载**时让位：那一刻同一个 profile 里别的 provider 插件还没注册完，
   * 晚一拍才能排到它们后面。之后（用户开/关这个供应商、改配置）必须立刻生效，
   * 再延迟只会让操作看起来"没反应"。
   */
  let firstSync = true

  const sync = () => {
    refreshConfig()
    const deferred = firstSync
    firstSync = false
    const want = cfg.enabled
    const have = handle !== undefined
    if (want === have) {
      if (want) adapter.invalidate()
      return
    }
    if (!want) {
      try {
        handle?.()
      } catch (error) {
        ctx.logger?.warn?.('dsh-connect-volcengine: provider teardown failed', error)
      }
      handle = undefined
      return
    }
    adapter = createVolcAdapter({
      configOf: configOfLive,
      resolveApiKeyFor,
      onAuthFailure: (accountId) => markAccountFailure(accountId, 401),
      resolveAttachments: () => ctx.get('attachments'),
    })
    /**
     * 让火山在选择器里排到最后。
     *
     * 机制（读源码确认）：`buildModelCatalog` 按 `ctx.llm.listProviders()` 的
     * **注册顺序**产出一组 provider group，浏览器端 `orderModelProviders` 只把
     * `deepseek-account` / `deepseek-official` 提到最前，其余**原样保留**。
     * 也就是说选择器的分组顺序 = 注册顺序，插件无法从 UI 侧改它。
     *
     * 所以只能晚注册：先让其它 provider 完成注册，再登记自己。代价是一个极短的
     * 窗口内火山不可选（毫秒级），换来的是"第三方连接器排在原生供应商之后"这个
     * 稳定的阅读顺序。延迟用 `setTimeout(0)` 而不是固定毫秒数——它只要求"排在本轮
     * 同步注册之后"，不是要等某个具体时长；注册被做成幂等的，重复调用不会注册两次。
     */
    const register = () => {
      if (handle !== undefined) return
      try {
        const releaseAdapter = ctx.llm.registerAdapter([VOLC_PROVIDER], adapter.adapter)
        const releaseDirectory = ctx.llm.registerConfigurableProviders([
          {
            provider: VOLC_PROVIDER,
            displayName: VOLC_PROVIDER_DISPLAY_NAME,
            settingsNs,
            settingsPath: [],
            declared: false,
            defaultBaseURL: cfg.baseURL,
          },
        ])
        handle = () => {
          releaseDirectory?.()
          releaseAdapter?.()
        }
        // 目录变了，通知 UI 重取；否则打开选择器还是旧列表。
        ctx.emit?.('llm/adapters-updated')
      } catch (error) {
        ctx.logger?.error?.('dsh-connect-volcengine: 注册 provider 失败', error)
      }
    }
    if (!deferred) {
      register()
      return
    }
    setTimeout(register, 0)
  }

  sync()

  let drawToolCtx
  let drawTool = { release: undefined, registered: false }
  let syncDrawTool = () => {}

  const reconcile = (origin) => {
    try {
      refreshConfig()
      sync()
      if (drawToolCtx !== undefined) syncDrawTool(drawToolCtx)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-connect-volcengine: reconcile after ${origin} failed`, error)
    }
  }

  ctx.on('settings/document-updated', (ns) => {
    if (String(ns) !== settingsNs) return
    reconcile('settings/document-updated')
  })
  ctx.on('app-boot/config-reload', () => reconcile('app-boot/config-reload'))

  ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
    const live = cfg
    const picked = request.apiKey !== undefined ? { key: request.apiKey } : await resolveApiKeyFor()
    if (picked === undefined) return []
    const found = await fetchArkModels({
      baseURL: request.baseURL ?? live.baseURL,
      apiKey: picked.key,
      signal,
    })
    return found.models.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow > 0 ? model.contextWindow : undefined,
      maxTokens: model.maxOutput,
      inputModalities: inputOf(model),
    }))
  })

  ctx.effect(() => () => {
    try {
      handle?.()
    } catch {
      /* 已经在拆 */
    }
    handle = undefined
  }, 'dsh-connect-volcengine: provider lifetime')

  syncDrawTool = (toolCtx) => {
    const want = cfg.imageToolEnabled
    if (want === drawTool.registered) return
    if (!want) {
      try {
        drawTool.release?.()
      } catch (error) {
        ctx.logger?.warn?.('dsh-connect-volcengine: draw tool teardown failed', error)
      }
      drawTool = { release: undefined, registered: false }
      return
    }
    try {
      drawTool = {
        release: registerDrawTool(toolCtx, { configOf: configOfLive, resolveApiKeyFor }),
        registered: true,
      }
    } catch (error) {
      ctx.logger?.error?.('dsh-connect-volcengine: 注册生图工具失败', error)
      drawTool = { release: undefined, registered: false }
    }
  }

  ctx.inject(['tools'], (toolCtx) => {
    drawToolCtx = toolCtx
    toolCtx.effect(
      () => {
        syncDrawTool(toolCtx)
        return () => {
          drawToolCtx = undefined
          try {
            drawTool.release?.()
          } catch {
            /* 已在拆 */
          }
          drawTool = { release: undefined, registered: false }
        }
      },
      'dsh-connect-volcengine: draw tool',
    )
  })

  // ── 卡片用的 HTTP 路由 ──
  ctx.inject(['webServer'], (webCtx) => {
    const route = (path, handler) =>
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'exact', path, handler }),
        `dsh-connect-volcengine: ${path}`,
      )

    /** 账号状态：每个账号是否配了 Key、是否当前使用。 */
    const accountsView = async () => {
      const out = []
      for (const account of cfg.accounts) {
        const key = await readKey(account).catch(() => undefined)
        out.push({
          id: account.id,
          label: account.label || account.ref,
          ref: account.ref,
          enabled: account.enabled,
          configured: key !== undefined && key !== '',
          active: account.id === cfg.activeAccountId,
          // 只给尾部 4 位，够认人又不泄漏密钥。
          tail: key === undefined ? '' : key.slice(-4),
        })
      }
      return out
    }

    route(`${VOLC_ROUTE_PREFIX}/status`, async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      refreshConfig()
      const accounts = await accountsView()
      sendJson(res, 200, {
        settingsNs,
        provider: VOLC_PROVIDER,
        displayName: VOLC_PROVIDER_DISPLAY_NAME,
        enabled: cfg.enabled,
        baseURL: cfg.baseURL,
        accounts,
        activeAccountId: cfg.activeAccountId,
        poolEnabled: cfg.poolEnabled,
        availableAccounts: accounts.filter((a) => a.enabled && a.configured).length,
        models: cfg.models,
        registered: handle !== undefined,
        imageToolEnabled: cfg.imageToolEnabled,
        imageModel: cfg.imageModel,
        contextChoices: CONTEXT_BUDGET_CHOICES,
        consoleUsageUrl: ARK_CONSOLE_USAGE_URL,
        consoleApiKeyUrl: ARK_CONSOLE_APIKEY_URL,
        /**
         * 选择器里的分组顺序。
         *
         * 浏览器端 `orderModelProviders` 只把 deepseek-account / deepseek-official
         * 提到最前，其余原样保留，而这份列表来自 `listProviders()` 的注册顺序。
         * 把它原样报出来，是为了让"火山排第几"这件事可观测，而不是靠看截图猜。
         */
        providerOrder: ctx.llm.listProviders().map((p) => p.id),
        /** 管理面凭据是否已配（只报布尔，不报值）。 */
        manageCredential: {
          accessKeyRef: cfg.accessKeyRef,
          secretKeyRef: cfg.secretKeyRef,
          configured:
            cfg.accessKeyRef !== '' &&
            cfg.secretKeyRef !== '' &&
            (await readManageKey(cfg.accessKeyRef)) !== undefined &&
            (await readManageKey(cfg.secretKeyRef)) !== undefined,
        },
        /** 上一次探测的结果（缓存，进程内有效）。 */
        probe: probeCache,
        drawTool: {
          registered: drawTool.registered,
          toolsService: drawToolCtx !== undefined,
          wanted: cfg.imageToolEnabled,
        },
      })
    })

    route(`${VOLC_ROUTE_PREFIX}/models`, async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        const models = await ctx.llm.listModels(VOLC_PROVIDER)
        sendJson(res, 200, {
          provider: VOLC_PROVIDER,
          count: models.length,
          models: models.map((m) => ({ id: m.id, name: m.name, input: m.inputModalities })),
        })
      } catch (error) {
        sendJson(res, 200, { provider: VOLC_PROVIDER, error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${VOLC_ROUTE_PREFIX}/save`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        const body = await readJsonBody(req)
        const settings = ctx.get('settings')
        if (settings === undefined) return sendJson(res, 503, { error: 'settings service unavailable' })
        const credentials = ctx.get('credentials')

        const ops = []

        // 新增账号：写凭据 + 追加一条账号记录。
        if (body.addAccount !== undefined) {
          if (credentials === undefined) return sendJson(res, 503, { error: 'credentials service unavailable' })
          const key = typeof body.addAccount.apiKey === 'string' ? body.addAccount.apiKey.trim() : ''
          if (key === '') return sendJson(res, 400, { error: 'API Key 不能为空' })
          const label = typeof body.addAccount.label === 'string' ? body.addAccount.label.trim() : ''
          const id = `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          const ref = `ARK_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
          await credentials.set(ref, key)
          ops.push({
            op: 'set',
            path: ['accounts'],
            value: [...cfg.accounts, { id, label: label || ref, ref, enabled: true }],
          })
        }

        // 更新某个账号的 Key（复用同一条记录）。
        if (body.updateAccountKey !== undefined) {
          if (credentials === undefined) return sendJson(res, 503, { error: 'credentials service unavailable' })
          const target = cfg.accounts.find((a) => a.id === body.updateAccountKey.id)
          if (target === undefined) return sendJson(res, 404, { error: 'account not found' })
          const key = typeof body.updateAccountKey.apiKey === 'string' ? body.updateAccountKey.apiKey.trim() : ''
          if (key === '') return sendJson(res, 400, { error: 'API Key 不能为空' })
          await credentials.set(target.ref, key)
        }

        if (typeof body.removeAccountId === 'string') {
          const remaining = cfg.accounts.filter((a) => a.id !== body.removeAccountId)
          ops.push({ op: 'set', path: ['accounts'], value: remaining })
          if (cfg.activeAccountId === body.removeAccountId) {
            ops.push({ op: 'set', path: ['activeAccountId'], value: remaining[0]?.id ?? '' })
          }
        }

        if (typeof body.activeAccountId === 'string') {
          ops.push({ op: 'set', path: ['activeAccountId'], value: body.activeAccountId })
        }
        if (Array.isArray(body.accounts)) ops.push({ op: 'set', path: ['accounts'], value: body.accounts })
        if (typeof body.poolEnabled === 'boolean') ops.push({ op: 'set', path: ['poolEnabled'], value: body.poolEnabled })
        if (Array.isArray(body.models)) ops.push({ op: 'set', path: ['models'], value: body.models })
        if (typeof body.baseURL === 'string' && body.baseURL !== '') {
          ops.push({ op: 'set', path: ['baseURL'], value: body.baseURL })
        }
        if (typeof body.enabled === 'boolean') ops.push({ op: 'set', path: ['enabled'], value: body.enabled })
        if (typeof body.imageToolEnabled === 'boolean') {
          ops.push({ op: 'set', path: ['imageToolEnabled'], value: body.imageToolEnabled })
        }

        // 管理面 AK/SK：写凭据 + 记录引用名。引用名固定，便于升级/复用。
        if (typeof body.manageCredentials === 'object' && body.manageCredentials !== null) {
          if (credentials === undefined) return sendJson(res, 503, { error: 'credentials service unavailable' })
          const ak = typeof body.manageCredentials.accessKey === 'string' ? body.manageCredentials.accessKey.trim() : ''
          const sk = typeof body.manageCredentials.secretKey === 'string' ? body.manageCredentials.secretKey.trim() : ''
          if (ak !== '' && sk !== '') {
            await credentials.set('VOLC_ACCESS_KEY', ak)
            await credentials.set('VOLC_SECRET_KEY', sk)
            ops.push({ op: 'set', path: ['accessKeyRef'], value: 'VOLC_ACCESS_KEY' })
            ops.push({ op: 'set', path: ['secretKeyRef'], value: 'VOLC_SECRET_KEY' })
          }
        }
        if (body.clearManageCredentials === true) {
          ops.push({ op: 'set', path: ['accessKeyRef'], value: '' })
          ops.push({ op: 'set', path: ['secretKeyRef'], value: '' })
        }

        if (ops.length > 0) await settings.mutate(settingsNs, ops)
        refreshConfig()
        sync()
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${VOLC_ROUTE_PREFIX}/refresh`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        refreshConfig()
        const picked = await resolveApiKeyFor()
        if (picked === undefined) {
          return sendJson(res, 200, {
            supported: false,
            reason: 'missing-key',
            message: '账号池里还没有可用的 API Key',
            models: cfg.models,
          })
        }
        const found = await fetchArkModels({ baseURL: cfg.baseURL, apiKey: picked.key })
        if (!found.supported) {
          return sendJson(res, 200, {
            supported: false,
            reason: 'endpoint-absent',
            message: '这个网关不发布 /models 目录，已保留当前目录，可手工增删模型',
            models: cfg.models,
          })
        }
        const known = new Map(cfg.models.map((m) => [m.id, m]))
        const merged = found.models.map((m) => {
          const saved = known.get(m.id)
          return {
            id: m.id,
            name: saved?.name ?? m.name,
            contextWindow: saved?.contextWindow ?? m.contextWindow,
            maxOutput: saved?.maxOutput ?? m.maxOutput,
            contextBudget: saved?.contextBudget ?? 0,
            multimodal: saved?.multimodal ?? m.multimodal,
            enabled: saved?.enabled ?? true,
          }
        })
        sendJson(res, 200, {
          supported: true,
          models: merged,
          added: merged.filter((m) => !known.has(m.id)).length,
        })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })

    /** 测某个账号（不传 accountId 则用当前选中）。 */
    /**
     * 探测哪些模型**此刻真的能调**。
     *
     * 为什么需要它：官方没有任何接口能只返回"本账号已开通的模型"。`/models` 是
     * 平台全量目录，`/api/v3` 下也没有开通状态端点。唯一的判据是**发一次真实请求**：
     *
     * - `404 InvalidEndpointOrModel.NotFound` → 未开通 / 不存在（实测两者错误码相同，
     *   所以只能对"官方目录里存在的 id"下结论）
     * - `403 AccountOverdueError` → 模型**可达**，是账号欠费（可达即已开通）
     * - `200` → 可用
     * - `429` → 可达，被限流
     *
     * 每个模型只发 `max_tokens: 1`，用量压到最低（实测单次 prompt 约 37 token）。
     * 只在用户点按钮时执行，不在后台偷偷跑——它会真实花钱。
     */
    route(`${VOLC_ROUTE_PREFIX}/probe`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        const body = await readJsonBody(req)
        refreshConfig()
        const picked = await resolveApiKeyFor()
        if (picked === undefined) {
          return sendJson(res, 200, { ok: false, code: 'MISSING_CREDENTIAL', message: '账号池里没有可用的 API Key' })
        }
        // 默认探测「官方目录里的全部对话模型」，不是只探配置里那 18 个——
        // 那样只会自我循环地证明"我列出来的确实能用"。
        const candidates = Array.isArray(body?.models) && body.models.length > 0
          ? body.models
          : OFFICIAL_MODELS.map((m) => m.id)

        const root = cfg.baseURL.replace(/\/+$/u, '')
        const results = []
        for (const modelId of candidates) {
          const started = Date.now()
          let verdict
          let detail = ''
          try {
            const response = await fetch(`${root}/chat/completions`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${picked.key}` },
              body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
                stream: false,
              }),
              signal: AbortSignal.timeout(45_000),
            })
            const text = await response.text()
            let code = ''
            try {
              code = JSON.parse(text)?.error?.code ?? ''
            } catch {
              /* 非 JSON 响应按未知处理 */
            }
            if (response.ok) verdict = 'available'
            else if (response.status === 404) verdict = 'not-entitled'
            else if (response.status === 403 && /Overdue/i.test(code)) verdict = 'entitled-overdue'
            else if (response.status === 403 || response.status === 401) verdict = 'auth-failed'
            else if (response.status === 429) verdict = 'rate-limited'
            else verdict = 'unknown'
            detail = code || `HTTP ${response.status}`
          } catch (error) {
            verdict = 'unknown'
            detail = error instanceof Error ? error.message.slice(0, 120) : String(error)
          }
          results.push({ id: modelId, verdict, detail, ms: Date.now() - started })
        }

        const summary = results.reduce((acc, r) => {
          acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
          return acc
        }, {})
        probeCache = { results, summary, checkedAt: Date.now(), accountId: picked.accountId }
        sendJson(res, 200, { ok: true, accountId: picked.accountId, results, summary, checkedAt: Date.now() })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })

    /** 用 AK/SK 真读每个模型的推理用量（管理面 SignatureV4）。 */
    route(`${VOLC_ROUTE_PREFIX}/usage`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        refreshConfig()
        const credentials = ctx.get('credentials')
        const read = async (ref) => {
          if (ref === '') return undefined
          if (credentials !== undefined) {
            const hit = await credentials.resolve(ref)
            return hit !== undefined && hit.value.length > 0 ? hit.value : undefined
          }
          const fromEnv = process.env[ref]
          return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : undefined
        }
        const accessKey = await read(cfg.accessKeyRef)
        const secretKey = await read(cfg.secretKeyRef)
        if (accessKey === undefined || secretKey === undefined) {
          return sendJson(res, 200, {
            ok: false,
            code: 'NO_MANAGE_CREDENTIAL',
            message: 'ARK API Key 读不到用量（管理面只认 Access Key）。在「账号」栏填入 AK/SK 后可读取。',
          })
        }
        const body = await readJsonBody(req).catch(() => ({}))
        const days = Number(body?.days ?? 30)
        const usage = await fetchInferenceUsage({
          accessKey,
          secretKey,
          days: Number.isFinite(days) && days > 0 && days <= 90 ? days : 30,
        })
        sendJson(res, 200, usage)
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${VOLC_ROUTE_PREFIX}/test`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        const body = await readJsonBody(req)
        refreshConfig()
        const account =
          typeof body?.accountId === 'string' ? cfg.accounts.find((a) => a.id === body.accountId) : undefined
        const picked = account === undefined ? await resolveApiKeyFor() : { key: await readKey(account), label: account.label || account.ref, accountId: account.id }
        if (picked === undefined || picked.key === undefined || picked.key === '') {
          return sendJson(res, 200, { ok: false, code: 'MISSING_CREDENTIAL', message: '这个账号还没有设置 API Key' })
        }
        const model =
          typeof body?.model === 'string' && body.model !== ''
            ? body.model
            : cfg.models.find((m) => m.enabled !== false)?.id
        if (model === undefined) return sendJson(res, 200, { ok: false, code: 'NO_MODEL', message: '目录里还没有模型' })

        const started = Date.now()
        const response = await fetch(`${cfg.baseURL.replace(/\/+$/u, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${picked.key}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
          }),
        })
        const elapsedMs = Date.now() - started
        const text = await response.text()
        if (response.ok) {
          return sendJson(res, 200, { ok: true, model, accountId: picked.accountId, elapsedMs, message: '可用' })
        }
        let detail = text
        try {
          const parsed = JSON.parse(text)
          detail = parsed?.error?.message ?? parsed?.message ?? text
        } catch {
          /* 上游偶尔返回纯文本 */
        }
        // 确定性鉴权失败：让下一次选号跳过这个账号。
        markAccountFailure(picked.accountId, response.status)
        sendJson(res, 200, {
          ok: false,
          model,
          accountId: picked.accountId,
          status: response.status,
          elapsedMs,
          message: String(detail).slice(0, 400),
        })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })

    /** 走真正的 `llm.stream` 派发一次。 */
    route(`${VOLC_ROUTE_PREFIX}/dispatch`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!requireLoopback(req, res)) return
      try {
        const body = await readJsonBody(req)
        refreshConfig()
        const model =
          typeof body?.model === 'string' && body.model !== ''
            ? body.model
            : cfg.models.find((m) => m.enabled !== false)?.id
        if (model === undefined) return sendJson(res, 200, { ok: false, code: 'NO_MODEL', message: '目录里还没有模型' })

        const started = Date.now()
        const chunks = []
        let finish
        let usage
        for await (const chunk of ctx.llm.stream({
          provider: VOLC_PROVIDER,
          model,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: READY' }] }],
          maxTokens: 64,
        })) {
          chunks.push(chunk.type)
          if (chunk.type === 'usage') usage = chunk.usage
          if (chunk.type === 'finish') finish = chunk.reason
          if (chunks.length > 400) break
        }
        sendJson(res, 200, {
          ok: finish?.kind === 'stop' || finish?.kind === 'tool-calls',
          provider: VOLC_PROVIDER,
          model,
          elapsedMs: Date.now() - started,
          chunkCount: chunks.length,
          chunkTypes: [...new Set(chunks)],
          finish,
          usage,
        })
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          code: 'THREW',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })

  ctx.inject(['settings'], (sctx) => {
    ctx.effect(() => sctx.settings.configure({ auto: true }, ctx.fiber), 'dsh-connect-volcengine: settings page')
  })
}

export const name = 'dsh-connect-volcengine'
