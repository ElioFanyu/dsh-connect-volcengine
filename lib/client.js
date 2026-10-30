/**
 * dsh-connect-volcengine 浏览器半边：插件配置卡片。
 *
 * 设计取向（与 dsh-connect-workbuddy 不同）：那边要同时管两个供应商 + 账号池 +
 * 积分，所以用 tab 把互不相干的事隔开。这里**只有一个供应商**，真正的日常动作是
 * 三件小事——看一眼通不通、挑模型、偶尔加把 Key。在这种情况下 tab 反而是负担：
 * 每次都得点开才知道另一栏有什么。
 *
 * 所以这张卡片是一条自上而下的「阅读流」：
 *
 *   健康条 → 账号 → 模型 → 能力 → 诊断
 *
 * - 顶部健康条把「能不能用」压缩成三个状态点，不点开任何东西就能判断；
 * - 账号与模型各自成段，段内用卡片/行，靠留白与左侧色条分层，而不是靠边框堆叠；
 * - 模型段带搜索与筛选，因为列表可能很长（实测官方目录 138 个）；
 * - 诊断段收在最后，它只在出问题时才有用，不该占视觉重心。
 *
 * 只依赖槽位、主题 token 与 locale——不导入任何 Harness Client 包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-connect-volcengine',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const ROUTE = '/plugins/dsh-connect-volcengine'

    const ZH = {
      'hero.title': '火山方舟',
      'hero.subtitle': 'Doubao · DeepSeek · GLM · Kimi，一把 Key 全部接入',
      'hero.running': '运行中',
      'hero.stopped': '已停用',
      'hero.accounts': '{n} 个账号',
      'hero.noAccount': '未配置账号',
      'hero.models': '{n} 个模型',
      'hero.overdue': '账户欠费',
      'hero.overdueHint': '上游返回 AccountOverdueError，充值后自动恢复',

      'sec.accounts': '账号',
      'sec.accountsHint': '每把 Key 一个账号。开启账号池后可自动换号。',
      'sec.models': '模型',
      'sec.modelsHint': '只列出可用的。点「探测」用真实请求确认哪些能用。',
      'sec.caps': '能力',
      'sec.capsHint': '这些开关即时生效，没有保存按钮。',
      'sec.diag': '诊断',
      'sec.diagHint': '只读事实，方便贴进问题反馈。',

      'pool.label': '账号池',
      'pool.hint': '失败时换下一个可用账号重试。关掉则只用选中的那个。',
      'pool.add': '添加账号',
      'pool.addTitle': '添加一个账号',
      'pool.label2': '备注名',
      'pool.labelPlaceholder': '主账号 / 备用（可留空）',
      'pool.key': 'API Key',
      'pool.keyPlaceholder': 'ARK-…',
      'pool.submit': '添加',
      'pool.cancel': '取消',
      'pool.active': '使用中',
      'pool.use': '切换',
      'pool.test': '测试',
      'pool.testing': '…',
      'pool.remove': '移除',
      'pool.missing': '缺 Key',
      'pool.empty': '还没有账号。添加一把方舟 API Key 就能开始。',
      'pool.keyLink': '去控制台创建 Key',
      'pool.tail': '…{tail}',
      'pool.selected': '{n} / {total} 参与',

      'models.search': '搜索模型名…',
      'models.fAll': '全部',
      'models.fOn': '已启用',
      'models.fVision': '可看图',
      'models.fUsable': '探测可用',
      'models.empty': '没有匹配的模型。',
      'models.noneYet': '还没有模型。点「从上游刷新」拉取目录。',
      'models.refresh': '从上游刷新',
      'models.refreshing': '刷新中…',
      'models.probe': '探测可用性',
      'models.probing': '探测中…',
      'models.apply': '只保留可用',
      'models.save': '保存',
      'models.saving': '保存中…',
      'models.discard': '放弃',
      'models.dirty': '有未保存修改',
      'models.saved': '已保存',
      'models.ctx': '上下文',
      'models.out': '输出',
      'models.budget': '预算',
      'models.native': '原生',
      'models.vision': '看图',
      'models.probeHint': '每个模型发一次 max_tokens=1 的真实请求（约几十 token）。不点就不花钱。',
      'models.fit': '适合',
      'models.caveat': '注意',
      'models.more': '展开',
      'models.less': '收起',
      'models.probedAt': '探测于 {time}',
      'models.summary': '{ok} 可用 · {no} 未开通 · {other} 其他',

      'v.available': '可用',
      'v.notEntitled': '未开通',
      'v.overdue': '欠费',
      'v.authFailed': 'Key 失效',
      'v.rateLimited': '限流',
      'v.unknown': '未知',

      'caps.provider': '注册这个供应商',
      'caps.providerHint': '关掉后模型从选择器撤下，账号与目录保留。',
      'caps.image': '允许模型自主生图',
      'caps.imageHint': '注册 volcengine_draw_image。每张图真实计费，没有逐次确认。',
      'caps.imageModel': '生图模型',

      'usage.title': '用量',
      'usage.hint': 'ARK Key 读不到用量。填一对 AK/SK 才能读每个模型的真实 token 消耗。',
      'usage.ak': 'Access Key',
      'usage.sk': 'Secret Key',
      'usage.save': '保存',
      'usage.clear': '清除',
      'usage.ok': '已配置',
      'usage.missing': '未配置',
      'usage.read': '读取用量',
      'usage.reading': '读取中…',
      'usage.noData': '这段时间没有用量记录。',
      'usage.security': 'AK/SK 权限远大于 API Key，会存进宿主凭据库。',
      'usage.model': '模型',
      'usage.in': '输入',
      'usage.out': '输出',
      'usage.total': '合计',
      'usage.req': '请求',

      'diag.provider': 'Provider',
      'diag.endpoint': '上游',
      'diag.orders': '选择器顺序',
      'diag.registered': '注册状态',
      'diag.on': '已注册',
      'diag.off': '已撤下',
      'diag.models': '宿主下发',
      'diag.draw': '生图工具',
      'diag.drawOn': '已注册',
      'diag.drawOff': '未注册',

      'state.loading': '读取中…',
      'state.error': '出错了',
      'state.summary': '火山方舟接入：账号、模型、能力与诊断。',
      'console.usage': '用量统计',
      'console.keys': 'API Key 管理',
    }

    const EN = {
      'hero.title': 'Volcengine Ark',
      'hero.subtitle': 'Doubao · DeepSeek · GLM · Kimi behind one key',
      'hero.running': 'Running',
      'hero.stopped': 'Disabled',
      'hero.accounts': '{n} accounts',
      'hero.noAccount': 'No account',
      'hero.models': '{n} models',
      'hero.overdue': 'Account overdue',
      'hero.overdueHint': 'Upstream returns AccountOverdueError; recovers after top-up',

      'sec.accounts': 'Accounts',
      'sec.accountsHint': 'One account per key. Enable the pool to rotate automatically.',
      'sec.models': 'Models',
      'sec.modelsHint': 'Only usable ones are listed. Probe with real requests to confirm.',
      'sec.caps': 'Capabilities',
      'sec.capsHint': 'These apply instantly — no save button.',
      'sec.diag': 'Diagnostics',
      'sec.diagHint': 'Read-only facts, ready to paste into a report.',

      'pool.label': 'Account pool',
      'pool.hint': 'On failure, retry with the next usable account. Off: only the selected one.',
      'pool.add': 'Add account',
      'pool.addTitle': 'Add an account',
      'pool.label2': 'Label',
      'pool.labelPlaceholder': 'primary / backup (optional)',
      'pool.key': 'API key',
      'pool.keyPlaceholder': 'ARK-…',
      'pool.submit': 'Add',
      'pool.cancel': 'Cancel',
      'pool.active': 'In use',
      'pool.use': 'Switch',
      'pool.test': 'Test',
      'pool.testing': '…',
      'pool.remove': 'Remove',
      'pool.missing': 'No key',
      'pool.empty': 'No accounts yet. Add an Ark API key to start.',
      'pool.keyLink': 'Create a key',
      'pool.tail': '…{tail}',
      'pool.selected': '{n} / {total} in pool',

      'models.search': 'Search models…',
      'models.fAll': 'All',
      'models.fOn': 'Enabled',
      'models.fVision': 'Vision',
      'models.fUsable': 'Probed usable',
      'models.empty': 'No matching models.',
      'models.noneYet': 'No models yet. Refresh from upstream.',
      'models.refresh': 'Refresh',
      'models.refreshing': 'Refreshing…',
      'models.probe': 'Probe usability',
      'models.probing': 'Probing…',
      'models.apply': 'Keep usable',
      'models.save': 'Save',
      'models.saving': 'Saving…',
      'models.discard': 'Discard',
      'models.dirty': 'Unsaved changes',
      'models.saved': 'Saved',
      'models.ctx': 'context',
      'models.out': 'output',
      'models.budget': 'budget',
      'models.native': 'native',
      'models.vision': 'vision',
      'models.probeHint': 'Sends one max_tokens=1 request per model (a few dozen tokens). Nothing runs unless you click.',
      'models.fit': 'Best for',
      'models.caveat': 'Watch out',
      'models.more': 'More',
      'models.less': 'Less',
      'models.probedAt': 'probed {time}',
      'models.summary': '{ok} usable · {no} not activated · {other} other',

      'v.available': 'usable',
      'v.notEntitled': 'not activated',
      'v.overdue': 'overdue',
      'v.authFailed': 'key rejected',
      'v.rateLimited': 'rate limited',
      'v.unknown': 'unknown',

      'caps.provider': 'Register this provider',
      'caps.providerHint': 'Off withdraws its models from the selector; accounts and catalog stay.',
      'caps.image': 'Allow the model to draw images',
      'caps.imageHint': 'Registers volcengine_draw_image. Each image is really billed, with no per-call confirmation.',
      'caps.imageModel': 'Image model',

      'usage.title': 'Usage',
      'usage.hint': 'An ARK key cannot read usage. Add an AK/SK pair to read real per-model token spend.',
      'usage.ak': 'Access Key',
      'usage.sk': 'Secret Key',
      'usage.save': 'Save',
      'usage.clear': 'Clear',
      'usage.ok': 'Configured',
      'usage.missing': 'Not configured',
      'usage.read': 'Read usage',
      'usage.reading': 'Reading…',
      'usage.noData': 'No usage in this range.',
      'usage.security': 'AK/SK are far more powerful than an API key and are stored in the host credential store.',
      'usage.model': 'Model',
      'usage.in': 'in',
      'usage.out': 'out',
      'usage.total': 'total',
      'usage.req': 'req',

      'diag.provider': 'Provider',
      'diag.endpoint': 'Upstream',
      'diag.orders': 'Selector order',
      'diag.registered': 'Registration',
      'diag.on': 'registered',
      'diag.off': 'withdrawn',
      'diag.models': 'Advertised',
      'diag.draw': 'Image tool',
      'diag.drawOn': 'registered',
      'diag.drawOff': 'not registered',

      'state.loading': 'Loading…',
      'state.error': 'Failed',
      'state.summary': 'Volcengine Ark access: accounts, models, capabilities and diagnostics.',
      'console.usage': 'Usage',
      'console.keys': 'API keys',
    }

    // ── 视觉 ──────────────────────────────────────────────────────────
    // 只用主题 token；品牌色仅用于点缀（左侧色条、状态点），保证深浅色都成立。
    const S = {
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 14,
        background: 'var(--dsw-alias-bg-layer-1)',
        margin: '12px 0',
        overflow: 'hidden',
      },
      /** 健康条：浅色渐变，把「能不能用」压在最上面。 */
      hero: {
        padding: '18px 20px',
        background:
          'linear-gradient(135deg, var(--dsw-alias-bg-layer-2) 0%, var(--dsw-alias-bg-layer-1) 100%)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      heroTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
      heroTitle: { fontSize: 16, fontWeight: 650, color: 'var(--dsw-alias-label-primary)', letterSpacing: 0.2 },
      heroSub: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 },
      chips: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
      chip: (tone) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        fontWeight: 500,
        padding: '4px 11px',
        borderRadius: 999,
        background:
          tone === 'ok'
            ? 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 14%, transparent)'
            : tone === 'warn'
              ? 'color-mix(in oklab, var(--dsw-alias-state-warn-primary) 16%, transparent)'
              : 'var(--dsw-alias-bg-layer-2)',
        color:
          tone === 'ok'
            ? 'var(--dsw-alias-state-success-primary)'
            : tone === 'warn'
              ? 'var(--dsw-alias-state-warn-primary)'
              : 'var(--dsw-alias-label-secondary)',
        border: '1px solid transparent',
      }),
      dot: (tone) => ({
        width: 6,
        height: 6,
        borderRadius: '50%',
        background:
          tone === 'ok'
            ? 'var(--dsw-alias-state-success-primary)'
            : tone === 'warn'
              ? 'var(--dsw-alias-state-warn-primary)'
              : 'var(--dsw-alias-state-idle-primary)',
      }),
      body: { padding: '0 20px 20px' },
      /** 每段左侧一根细色条，靠它分层而不是靠堆边框。 */
      section: {
        paddingTop: 18,
        marginTop: 18,
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      secHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
      secTitle: { fontSize: 13, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' },
      secHint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, lineHeight: 1.6 },
      hint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },

      btn: (kind) => ({
        appearance: 'none',
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 13px',
        borderRadius: 8,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'opacity .15s',
        opacity: 1,
        border:
          kind === 'primary'
            ? '1px solid transparent'
            : kind === 'ghost'
              ? '1px solid transparent'
              : '1px solid var(--dsw-alias-border-l1)',
        background:
          kind === 'primary'
            ? 'var(--dsw-alias-label-primary)'
            : kind === 'ghost'
              ? 'transparent'
              : 'var(--dsw-alias-bg-layer-2)',
        color:
          kind === 'primary' ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
      }),
      btnDisabled: { opacity: 0.45, cursor: 'default' },

      input: {
        fontSize: 12.5,
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

      /** 账号卡：一行一卡，左侧色条表示是否在用。 */
      acctRow: (active) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        marginBottom: 8,
        background: active
          ? 'color-mix(in oklab, var(--dsw-alias-brand-primary) 7%, var(--dsw-alias-bg-layer-2))'
          : 'var(--dsw-alias-bg-layer-2)',
        borderLeft: `3px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'transparent'}`,
      }),
      acctName: { fontSize: 13, fontWeight: 550, color: 'var(--dsw-alias-label-primary)' },
      acctMeta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },

      /** 模型行：勾选 + 名称 + 右侧规格/控制。 */
      modelRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      modelName: { fontSize: 12.8, color: 'var(--dsw-alias-label-primary)' },
      modelMeta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },
      modelRight: { display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' },

      /**
       * 「适合干什么」：默认压成一行，点一下展开「适合 / 注意」两段。
       *
       * 为什么默认折叠：18 个模型每个都摊开两句话，列表会变成一篇能读很久的散文，
       * 反而找不到模型。压成一行时每行正好一句话，扫一眼就能横向比较。
       *
       * 折叠态用 flex 而不是 `text-overflow`：省略号只加在文字那一格上，箭头是
       * 固定宽度的一格。否则长句会把箭头一起截掉，用户就看不出这行可以点。
       */
      noteWrap: (open) => ({
        marginTop: 5,
        cursor: 'pointer',
        fontSize: 11.2,
        lineHeight: 1.55,
        color: 'var(--dsw-alias-label-secondary)',
        ...(open ? {} : { display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }),
      }),
      noteText: (open) => (open ? {} : { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
      noteChev: { flex: '0 0 auto', fontSize: 9.5, opacity: 0.55 },
      noteLabel: (tone) => ({
        display: 'inline-block',
        marginRight: 6,
        fontSize: 10,
        fontWeight: 600,
        color:
          tone === 'warn'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-label-secondary)',
        opacity: tone === 'warn' ? 1 : 0.85,
      }),

      /** 分段控件：比 tab 轻，也更适合只有 3~4 个选项的筛选。 */
      seg: {
        display: 'inline-flex',
        padding: 2,
        borderRadius: 9,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        gap: 2,
      },
      segItem: (on) => ({
        appearance: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11.5,
        fontWeight: on ? 600 : 400,
        padding: '4px 10px',
        borderRadius: 7,
        background: on ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
        color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
      }),

      badge: (tone) => ({
        display: 'inline-block',
        fontSize: 10.5,
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 6,
        background:
          tone === 'ok'
            ? 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 14%, transparent)'
            : tone === 'warn'
              ? 'color-mix(in oklab, var(--dsw-alias-state-warn-primary) 16%, transparent)'
              : 'var(--dsw-alias-bg-layer-2)',
        color:
          tone === 'ok'
            ? 'var(--dsw-alias-state-success-primary)'
            : tone === 'warn'
              ? 'var(--dsw-alias-state-warn-primary)'
              : 'var(--dsw-alias-label-secondary)',
      }),
      select: {
        fontSize: 11,
        padding: '3px 6px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
      },

      notice: {
        fontSize: 11.5,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 9,
        padding: '10px 12px',
        marginTop: 10,
        lineHeight: 1.6,
      },
      err: { fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary)', marginTop: 10 },

      diagRow: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '9px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11.8,
      },
      diagKey: { color: 'var(--dsw-alias-label-secondary)' },
      diagVal: { color: 'var(--dsw-alias-label-primary)', textAlign: 'right', wordBreak: 'break-all' },

      tbl: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 },
      th: { textAlign: 'left', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', padding: '6px 8px' },
      td: {
        padding: '6px 8px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      link: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none', fontSize: 11.5 },
    }

    function sortModels(list) {
      return [...list].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), 'zh', { numeric: true }),
      )
    }

    async function callJson(path, init) {
      const response = await fetch(`${ROUTE}${path}`, {
        ...(init === undefined ? {} : init),
        headers: { 'content-type': 'application/json', ...((init && init.headers) || {}) },
      })
      const text = await response.text()
      let body
      try {
        body = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`${path} → ${text.slice(0, 140)}`)
      }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    function ArkCard(props) {
      const injected = props && typeof props.t === 'function' ? props.t : undefined
      const t = useCallback(
        (key, vars) => {
          let text
          if (injected !== undefined) {
            const hit = injected(key)
            if (typeof hit === 'string' && hit !== '' && hit !== key) text = hit
          }
          if (text === undefined) text = ZH[key] === undefined ? key : ZH[key]
          if (vars !== undefined) {
            for (const [k, v] of Object.entries(vars)) text = String(text).replaceAll(`{${k}}`, String(v))
          }
          return text
        },
        [injected],
      )
      const view = props && props.view

      const [status, setStatus] = useState(undefined)
      const [error, setError] = useState(undefined)
      const [note, setNote] = useState(undefined)
      const [busy, setBusy] = useState(undefined)
      const [draft, setDraft] = useState(undefined)
      const [advertised, setAdvertised] = useState(undefined)

      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      // 说明默认折叠；展开状态按 id 记，刷新列表不会把用户展开的那几条合上。
      const [openNotes, setOpenNotes] = useState({})
      const [localNotes, setLocalNotes] = useState({})
      const [adding, setAdding] = useState(false)
      const [newLabel, setNewLabel] = useState('')
      const [newKey, setNewKey] = useState('')
      const [testing, setTesting] = useState({})
      const [probing, setProbing] = useState(false)
      const [usage, setUsage] = useState(undefined)
      const [usageBusy, setUsageBusy] = useState(false)
      const [ak, setAk] = useState('')
      const [sk, setSk] = useState('')

      const mounted = useRef(true)
      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const load = useCallback(async () => {
        try {
          const body = await callJson('/status')
          if (!mounted.current) return
          setStatus(body)
          setError(undefined)
        } catch (cause) {
          if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [])

      useEffect(() => {
        if (view !== 'summary') void load()
      }, [load, view])

      useEffect(() => {
        if (view === 'summary' || status === undefined) return
        let alive = true
        callJson('/models')
          .then((body) => alive && setAdvertised(body))
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [status, view])

      if (view === 'summary') return h('div', { style: S.hint }, t('state.summary'))

      const models = useMemo(() => (draft !== undefined ? draft : status ? status.models : []), [draft, status])
      const enabledCount = models.filter((m) => m.enabled !== false).length
      const dirty = draft !== undefined

      const probeOf = (id) => {
        const p = status && status.probe
        if (p === undefined) return undefined
        return p.results.find((r) => r.id === id)
      }

      /** 宿主下发的「适合干什么」；刷新拿到的新模型那次会补进 localNotes。 */
      const notes = { ...((status && status.notes) || {}), ...localNotes }
      const noteOf = (id) => notes[id]

      const usableCount = status && status.probe
        ? status.probe.results.filter(
            (r) => r.verdict === 'available' || r.verdict === 'entitled-overdue' || r.verdict === 'rate-limited',
          ).length
        : 0

      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return models.filter((model) => {
          // 搜索也匹配说明文字：想找"翻译"或"角色扮演"时，记得住的往往是用途而不是 id。
          if (q !== '') {
            const note = notes[model.id]
            const haystack = `${model.name} ${note === undefined ? '' : `${note.fit} ${note.short}`}`.toLowerCase()
            if (!haystack.includes(q)) return false
          }
          if (filter === 'on') return model.enabled !== false
          if (filter === 'vision') return model.multimodal === true
          if (filter === 'usable') {
            const p = probeOf(model.id)
            return p !== undefined && (p.verdict === 'available' || p.verdict === 'entitled-overdue')
          }
          return true
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [models, query, filter, status, localNotes])

      const save = async (payload, key) => {
        setBusy(key)
        setNote(undefined)
        try {
          await callJson('/save', { method: 'POST', body: JSON.stringify(payload) })
          await load()
          return true
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          return false
        } finally {
          setBusy(undefined)
        }
      }

      const onRefresh = async () => {
        setBusy('refresh')
        setNote(undefined)
        try {
          const body = await callJson('/refresh', { method: 'POST', body: '{}' })
          if (!body.supported) setNote(body.message)
          else {
            setDraft(sortModels(body.models))
            if (body.notes !== undefined) setLocalNotes((p) => ({ ...p, ...body.notes }))
            setNote(body.added > 0 ? `新增 ${body.added} 个，勾选后保存` : '目录已最新')
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(undefined)
        }
      }

      const onProbe = async () => {
        setProbing(true)
        setNote(undefined)
        try {
          const body = await callJson('/probe', { method: 'POST', body: '{}' })
          if (!body.ok) setNote(body.message ?? t('state.error'))
          else {
            await load()
            setNote(
              t('models.summary', {
                ok: body.summary.available ?? 0,
                no: body.summary['not-entitled'] ?? 0,
                other:
                  (body.summary['entitled-overdue'] ?? 0) +
                  (body.summary.unknown ?? 0) +
                  (body.summary['auth-failed'] ?? 0),
              }),
            )
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setProbing(false)
        }
      }

      const onApplyProbe = async () => {
        if (status === undefined || status.probe === undefined) return
        const known = new Map(models.map((m) => [m.id, m]))
        const keep = status.probe.results
          .filter((r) => r.verdict === 'available' || r.verdict === 'entitled-overdue' || r.verdict === 'rate-limited')
          .map(
            (r) =>
              known.get(r.id) ?? {
                id: r.id,
                name: r.id,
                contextWindow: 0,
                maxOutput: 32_768,
                contextBudget: 0,
                multimodal: false,
                enabled: true,
              },
          )
        // 草稿按名称排：否则保存后后端重排，顺序会"跳"一下。
        setDraft(sortModels(keep))
        setNote(`选出 ${keep.length} 个可用模型，点保存写入`)
      }

      const onSaveModels = async () => {
        if (!(await save({ models }, 'save'))) return
        setDraft(undefined)
        setNote(t('models.saved'))
      }

      const onAddAccount = async () => {
        if (newKey.trim() === '') return
        if (await save({ addAccount: { apiKey: newKey.trim(), label: newLabel.trim() } }, 'add')) {
          setNewKey('')
          setNewLabel('')
          setAdding(false)
          setNote('已添加账号')
        }
      }

      const onTest = async (id) => {
        setTesting((p) => ({ ...p, [id]: true }))
        try {
          const body = await callJson('/test', { method: 'POST', body: JSON.stringify({ accountId: id }) })
          setNote(body.ok ? `可用（${body.elapsedMs} ms）` : `不可用：${body.message}`)
          await load()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setTesting((p) => ({ ...p, [id]: false }))
        }
      }

      const onSaveCreds = async () => {
        if (ak.trim() === '' || sk.trim() === '') return
        if (await save({ manageCredentials: { accessKey: ak.trim(), secretKey: sk.trim() } }, 'creds')) {
          setAk('')
          setSk('')
          setNote('AK/SK 已保存')
        }
      }

      const onReadUsage = async () => {
        setUsageBusy(true)
        try {
          const body = await callJson('/usage', { method: 'POST', body: '{}' })
          if (!body.ok) {
            setNote(body.message ?? body.error ?? '读取失败')
            setUsage(undefined)
          } else {
            setUsage(body)
            setNote(undefined)
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setUsageBusy(false)
        }
      }

      // ── 健康条 ──
      const hero = (() => {
        const overdue = status && status.probe
          ? status.probe.results.some((r) => r.verdict === 'entitled-overdue')
          : false
        const running = status !== undefined && status.registered
        return h(
          'div',
          { style: S.hero },
          h(
            'div',
            { style: S.heroTop },
            h(
              'div',
              null,
              h('div', { style: S.heroTitle }, t('hero.title')),
              h('div', { style: S.heroSub }, t('hero.subtitle')),
            ),
            status !== undefined
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  h('a', { style: S.link, href: status.consoleUsageUrl, target: '_blank', rel: 'noreferrer noopener' }, t('console.usage')),
                  h('span', { style: { ...S.hint, opacity: 0.5 } }, '·'),
                  h('a', { style: S.link, href: status.consoleApiKeyUrl, target: '_blank', rel: 'noreferrer noopener' }, t('console.keys')),
                )
              : null,
          ),
          status === undefined
            ? null
            : h(
                'div',
                { style: S.chips },
                h(
                  'span',
                  { style: S.chip(running ? 'ok' : 'muted') },
                  h('span', { style: S.dot(running ? 'ok' : 'muted') }),
                  running ? t('hero.running') : t('hero.stopped'),
                ),
                h(
                  'span',
                  { style: S.chip(status.availableAccounts > 0 ? 'ok' : 'warn') },
                  h('span', { style: S.dot(status.availableAccounts > 0 ? 'ok' : 'warn') }),
                  status.accounts.length === 0
                    ? t('hero.noAccount')
                    : t('hero.accounts', { n: status.availableAccounts }),
                ),
                h('span', { style: S.chip('muted') }, t('hero.models', { n: enabledCount })),
                overdue
                  ? h(
                      'span',
                      { style: S.chip('warn'), title: t('hero.overdueHint') },
                      h('span', { style: S.dot('warn') }),
                      t('hero.overdue'),
                    )
                  : null,
              ),
        )
      })()

      if (status === undefined) {
        return h(
          'div',
          { style: S.card },
          hero,
          h('div', { style: S.body }, h('div', { style: S.notice }, error === undefined ? t('state.loading') : `${t('state.error')}：${error}`)),
        )
      }

      // ── 账号段 ──
      const accounts = status.accounts ?? []
      const acctSection = h(
        'div',
        { style: S.section, marginTop: 0, paddingTop: 0, borderTop: 'none' },
        h(
          'div',
          { style: S.secHead },
          h(
            'div',
            null,
            h('div', { style: S.secTitle }, t('sec.accounts')),
            h('div', { style: S.secHint }, t('sec.accountsHint')),
          ),
          h(
            'div',
            { style: S.row },
            h(
              'label',
              { style: { ...S.row, gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: status.poolEnabled,
                onChange: () => void save({ poolEnabled: !status.poolEnabled }, 'pool'),
              }),
              h('span', { style: S.hint }, t('pool.label')),
            ),
            h(
              'button',
              { type: 'button', style: S.btn('secondary'), onClick: () => setAdding((v) => !v) },
              t('pool.add'),
            ),
          ),
        ),
        h('div', { style: { ...S.hint, marginBottom: 10 } }, t('pool.hint')),

        accounts.length === 0
          ? h('div', { style: S.notice }, t('pool.empty'))
          : accounts.map((account) =>
              h(
                'div',
                { key: account.id, style: S.acctRow(account.active) },
                h('input', {
                  type: 'checkbox',
                  checked: account.enabled,
                  onChange: () =>
                    void save(
                      { accounts: accounts.map((a) => (a.id === account.id ? { ...a, enabled: !a.enabled } : a)) },
                      'toggle',
                    ),
                  'aria-label': `${account.label} enabled`,
                }),
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  h(
                    'div',
                    { style: S.acctName },
                    account.label,
                    account.active ? h('span', { style: { ...S.badge('ok'), marginLeft: 8 } }, t('pool.active')) : null,
                    account.configured ? null : h('span', { style: { ...S.badge('warn'), marginLeft: 8 } }, t('pool.missing')),
                  ),
                  h(
                    'div',
                    { style: S.acctMeta },
                    account.configured ? t('pool.tail', { tail: account.tail }) : account.ref,
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6 } },
                  account.active
                    ? null
                    : h(
                        'button',
                        { type: 'button', style: S.btn('ghost'), onClick: () => void save({ activeAccountId: account.id }, 'active') },
                        t('pool.use'),
                      ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: S.btn('secondary'),
                      disabled: testing[account.id] === true || !account.configured,
                      onClick: () => void onTest(account.id),
                    },
                    testing[account.id] === true ? t('pool.testing') : t('pool.test'),
                  ),
                  h(
                    'button',
                    { type: 'button', style: S.btn('ghost'), onClick: () => void save({ removeAccountId: account.id }, 'remove') },
                    t('pool.remove'),
                  ),
                ),
              ),
            ),

        adding
          ? h(
              'div',
              { style: { ...S.notice, marginTop: 10 } },
              h('div', { style: { ...S.secTitle, marginBottom: 10 } }, t('pool.addTitle')),
              h('div', { style: { marginBottom: 8 } },
                h('div', { style: S.hint }, t('pool.label2')),
                h('input', {
                  style: S.input,
                  value: newLabel,
                  placeholder: t('pool.labelPlaceholder'),
                  onChange: (e) => setNewLabel(e.target.value),
                }),
              ),
              h('div', { style: { marginBottom: 10 } },
                h('div', { style: S.hint }, t('pool.key')),
                h('input', {
                  style: S.input,
                  type: 'password',
                  autoComplete: 'off',
                  value: newKey,
                  placeholder: t('pool.keyPlaceholder'),
                  onChange: (e) => setNewKey(e.target.value),
                }),
              ),
              h(
                'div',
                { style: S.row },
                h(
                  'button',
                  { type: 'button', style: S.btn('primary'), disabled: newKey.trim() === '' || busy !== undefined, onClick: () => void onAddAccount() },
                  busy === 'add' ? t('models.saving') : t('pool.submit'),
                ),
                h(
                  'button',
                  { type: 'button', style: S.btn('ghost'), onClick: () => { setAdding(false); setNewKey(''); setNewLabel('') } },
                  t('pool.cancel'),
                ),
                h('a', { style: S.link, href: status.consoleApiKeyUrl, target: '_blank', rel: 'noreferrer noopener' }, t('pool.keyLink')),
              ),
            )
          : null,
      )

      // ── 用量（管理面凭据）──
      const usageSection = h(
        'div',
        null,
        h(
          'div',
          { style: { ...S.secHead, marginTop: 16 } },
          h(
            'div',
            null,
            h('div', { style: S.secTitle }, t('usage.title')),
            h('div', { style: S.secHint }, t('usage.hint')),
          ),
          h('span', { style: S.badge(status.manageCredential.configured ? 'ok' : 'muted') }, status.manageCredential.configured ? t('usage.ok') : t('usage.missing')),
        ),
        h(
          'div',
          { style: S.row },
          h('input', {
            style: { ...S.input, flex: '1 1 200px' },
            type: 'password',
            autoComplete: 'off',
            placeholder: t('usage.ak'),
            value: ak,
            onChange: (e) => setAk(e.target.value),
          }),
          h('input', {
            style: { ...S.input, flex: '1 1 200px' },
            type: 'password',
            autoComplete: 'off',
            placeholder: t('usage.sk'),
            value: sk,
            onChange: (e) => setSk(e.target.value),
          }),
          h(
            'button',
            { type: 'button', style: S.btn('secondary'), disabled: ak.trim() === '' || sk.trim() === '' || busy !== undefined, onClick: () => void onSaveCreds() },
            busy === 'creds' ? t('models.saving') : t('usage.save'),
          ),
          status.manageCredential.configured
            ? h('button', { type: 'button', style: S.btn('ghost'), onClick: () => void save({ clearManageCredentials: true }, 'creds') }, t('usage.clear'))
            : null,
          status.manageCredential.configured
            ? h('button', { type: 'button', style: S.btn('secondary'), disabled: usageBusy, onClick: () => void onReadUsage() }, usageBusy ? t('usage.reading') : t('usage.read'))
            : null,
        ),
        h('div', { style: { ...S.hint, marginTop: 6 } }, t('usage.security')),
        usage === undefined
          ? null
          : Object.keys(usage.models ?? {}).length === 0
            ? h('div', { style: S.notice }, t('usage.noData'))
            : h(
                'table',
                { style: S.tbl },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { style: S.th }, t('usage.model')),
                    h('th', { style: { ...S.th, textAlign: 'right' } }, t('usage.in')),
                    h('th', { style: { ...S.th, textAlign: 'right' } }, t('usage.out')),
                    h('th', { style: { ...S.th, textAlign: 'right' } }, t('usage.total')),
                    h('th', { style: { ...S.th, textAlign: 'right' } }, t('usage.req')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  Object.entries(usage.models)
                    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                    .map(([model, u]) =>
                      h(
                        'tr',
                        { key: model },
                        h('td', { style: S.td }, model),
                        h('td', { style: { ...S.td, textAlign: 'right' } }, u.inputTokens.toLocaleString()),
                        h('td', { style: { ...S.td, textAlign: 'right' } }, u.outputTokens.toLocaleString()),
                        h('td', { style: { ...S.td, textAlign: 'right' } }, u.totalTokens.toLocaleString()),
                        h('td', { style: { ...S.td, textAlign: 'right' } }, String(u.requests)),
                      ),
                    ),
                ),
              ),
      )

      // ── 模型段 ──
      const fmtWin = (v) => {
        if (!v || v <= 0) return '?'
        if (v >= 1_000_000) return `${(v / 1_048_576).toFixed(1).replace(/\.0$/, '')}M`
        return `${Math.round(v / 1024)}K`
      }

      const verdictText = (v) =>
        v === 'available'
          ? t('v.available')
          : v === 'not-entitled'
            ? t('v.notEntitled')
            : v === 'entitled-overdue'
              ? t('v.overdue')
              : v === 'rate-limited'
                ? t('v.rateLimited')
                : v === 'auth-failed'
                  ? t('v.authFailed')
                  : t('v.unknown')
      const verdictTone = (v) => (v === 'available' ? 'ok' : v === 'not-entitled' ? 'warn' : 'muted')

      const budgetChoices = status.contextChoices ?? [0]

      const modelSection = h(
        'div',
        { style: S.section },
        h(
          'div',
          { style: S.secHead },
          h(
            'div',
            null,
            h('div', { style: S.secTitle }, t('sec.models')),
            h('div', { style: S.secHint }, t('sec.modelsHint')),
          ),
          h(
            'div',
            { style: S.row },
            h('button', { type: 'button', style: S.btn('secondary'), disabled: busy !== undefined, onClick: () => void onRefresh() }, busy === 'refresh' ? t('models.refreshing') : t('models.refresh')),
            h('button', { type: 'button', style: S.btn('secondary'), disabled: probing, onClick: () => void onProbe() }, probing ? t('models.probing') : t('models.probe')),
            status.probe === undefined ? null : h('button', { type: 'button', style: S.btn('secondary'), onClick: () => void onApplyProbe() }, t('models.apply')),
          ),
        ),

        h(
          'div',
          { style: { ...S.row, marginBottom: 10 } },
          h('input', {
            style: { ...S.input, flex: '1 1 180px' },
            value: query,
            placeholder: t('models.search'),
            onChange: (e) => setQuery(e.target.value),
          }),
          h(
            'div',
            { style: S.seg },
            [
              ['all', t('models.fAll')],
              ['on', t('models.fOn')],
              ['vision', t('models.fVision')],
              ['usable', `${t('models.fUsable')}${status.probe === undefined ? '' : ` ${usableCount}`}`],
            ].map(([id, label]) =>
              h('button', { key: id, type: 'button', style: S.segItem(filter === id), onClick: () => setFilter(id) }, label),
            ),
          ),
        ),

        h(
          'div',
          { style: S.hint },
          t('models.probeHint'),
          status.probe === undefined ? null : `　${t('models.probedAt', { time: new Date(status.probe.checkedAt).toLocaleTimeString() })}`,
        ),

        models.length === 0
          ? h('div', { style: S.notice }, t('models.noneYet'))
          : filtered.length === 0
            ? h('div', { style: S.notice }, t('models.empty'))
            : h(
                'div',
                { style: { marginTop: 8 } },
                filtered.map((model) =>
                  h(
                    'div',
                    { key: model.id, style: S.modelRow },
                    h('input', {
                      type: 'checkbox',
                      checked: model.enabled !== false,
                      onChange: () =>
                        setDraft(models.map((m) => (m.id === model.id ? { ...m, enabled: m.enabled === false } : m))),
                      'aria-label': `${model.name} enabled`,
                    }),
                    h(
                      'div',
                      { style: { minWidth: 0, flex: '1 1 auto' } },
                      h('div', { style: S.modelName }, model.name),
                      h(
                        'div',
                        { style: S.modelMeta },
                        `${fmtWin(model.contextWindow)} ${t('models.ctx')} · ${fmtWin(model.maxOutput)} ${t('models.out')}`,
                        (() => {
                          const p = probeOf(model.id)
                          if (p === undefined) return null
                          return h('span', { style: { ...S.badge(verdictTone(p.verdict)), marginLeft: 8 } }, verdictText(p.verdict))
                        })(),
                      ),
                      (() => {
                        const note = noteOf(model.id)
                        if (note === undefined) return null
                        const open = openNotes[model.id] === true
                        return h(
                          'div',
                          {
                            style: S.noteWrap(open),
                            title: open ? '' : `${note.fit}  ${note.caveat}`,
                            onClick: () => setOpenNotes((p) => ({ ...p, [model.id]: !open })),
                          },
                          open
                            ? [
                                h(
                                  'div',
                                  { key: 'fit' },
                                  h('span', { style: S.noteLabel('muted') }, t('models.fit')),
                                  note.fit,
                                  h('span', { key: 'chev', style: S.noteChev }, '▴'),
                                ),
                                h(
                                  'div',
                                  { key: 'caveat', style: { marginTop: 3 } },
                                  h('span', { style: S.noteLabel('warn') }, t('models.caveat')),
                                  note.caveat,
                                ),
                              ]
                            : h(
                                'span',
                                { style: S.noteText(false) },
                                note.fit,
                                h('span', { key: 'chev', style: S.noteChev }, '▾'),
                              ),
                        )
                      })(),
                    ),
                    h(
                      'div',
                      { style: S.modelRight },
                      h(
                        'label',
                        { style: { ...S.row, gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' } },
                        h('input', {
                          type: 'checkbox',
                          checked: model.multimodal === true,
                          onChange: () =>
                            setDraft(models.map((m) => (m.id === model.id ? { ...m, multimodal: m.multimodal !== true } : m))),
                        }),
                        t('models.vision'),
                      ),
                      h(
                        'span',
                        { style: { ...S.row, gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                        t('models.budget'),
                        h(
                          'select',
                          {
                            style: S.select,
                            value: String(model.contextBudget ?? 0),
                            onChange: (e) =>
                              setDraft(models.map((m) => (m.id === model.id ? { ...m, contextBudget: Number(e.target.value) } : m))),
                          },
                          budgetChoices.map((c) =>
                            h('option', { key: c, value: String(c) }, c === 0 ? t('models.native') : fmtWin(c)),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),

        h(
          'div',
          { style: { ...S.row, marginTop: 14 } },
          h('button', { type: 'button', style: dirty && busy === undefined ? S.btn('primary') : { ...S.btn('primary'), ...S.btnDisabled }, disabled: busy !== undefined || !dirty, onClick: () => void onSaveModels() }, busy === 'save' ? t('models.saving') : t('models.save')),
          dirty ? h('button', { type: 'button', style: S.btn('ghost'), onClick: () => setDraft(undefined) }, t('models.discard')) : null,
          dirty ? h('span', { style: S.hint }, t('models.dirty')) : null,
        ),
      )

      // ── 能力段 ──
      const capsSection = h(
        'div',
        { style: S.section },
        h('div', { style: S.secHead }, h('div', { style: S.secTitle }, t('sec.caps'))),
        h('div', { style: S.secHint }, t('sec.capsHint')),

        h(
          'label',
          { style: { ...S.row, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: status.imageToolEnabled,
            style: { marginTop: 2 },
            onChange: () => void save({ imageToolEnabled: !status.imageToolEnabled }, 'image'),
          }),
          h(
            'div',
            null,
            h('div', { style: S.modelName }, t('caps.image')),
            h('div', { style: S.secHint }, t('caps.imageHint')),
            h('div', { style: { ...S.hint, marginTop: 2 } }, `${t('caps.imageModel')}：`, h('code', null, status.imageModel)),
          ),
        ),

        h(
          'label',
          { style: { ...S.row, marginTop: 14, alignItems: 'flex-start', cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: status.enabled,
            style: { marginTop: 2 },
            onChange: () => void save({ enabled: !status.enabled }, 'provider'),
          }),
          h(
            'div',
            null,
            h('div', { style: S.modelName }, t('caps.provider')),
            h('div', { style: S.secHint }, t('caps.providerHint')),
          ),
        ),
      )

      // ── 诊断段 ──
      const diagRow = (label, value) =>
        h('div', { key: label, style: S.diagRow }, h('span', { style: S.diagKey }, label), h('span', { style: S.diagVal }, value))

      const diagSection = h(
        'div',
        { style: S.section },
        h('div', { style: S.secHead }, h('div', { style: S.secTitle }, t('sec.diag')), h('div', { style: S.secHint }, t('sec.diagHint'))),
        diagRow(t('diag.provider'), status.provider),
        diagRow(t('diag.endpoint'), status.baseURL),
        diagRow(t('diag.registered'), status.registered ? t('diag.on') : t('diag.off')),
        diagRow(t('diag.models'), advertised === undefined ? '…' : advertised.error !== undefined ? advertised.error : String(advertised.count)),
        diagRow(t('diag.draw'), status.drawTool.registered ? t('diag.drawOn') : t('diag.drawOff')),
        diagRow(t('diag.orders'), (status.providerOrder ?? []).join(' → ')),
      )

      return h(
        'div',
        { style: S.card },
        hero,
        h(
          'div',
          { style: S.body },
          h('div', { style: { paddingTop: 18 } }, acctSection, usageSection),
          modelSection,
          capsSection,
          diagSection,
          note === undefined ? null : h('div', { style: S.notice }, note),
          error === undefined ? null : h('div', { style: S.err }, `${t('state.error')}：${error}`),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          const namespace = 'settings.volcengine'
          ctx.effect(() => ctx.locale.register(namespace, { zh: ZH, en: EN }), 'dsh-connect-volcengine: card copy')
          let translate
          try {
            translate = ctx.locale.bind(namespace)
          } catch {
            translate = undefined
          }
          const bind = (key) => (translate === undefined ? ZH[key] : translate(key))
          const register = (slotName, key) => {
            try {
              return ctx.slots.inject(slotName, () =>
                ctx.slots.register({ name: slotName, key, priority: 30, inject: () => ({ t: bind }) }, ArkCard),
              )
            } catch (cause) {
              console.error(`[dsh-connect-volcengine] slot "${slotName}" failed:`, cause)
              return undefined
            }
          }
          ctx.effect(() => register('plugins.bundle.config', 'dsh-connect-volcengine'), 'volcengine: bundle card')
          ctx.effect(
            () => register('plugins.row.config', 'dsh-connect-volcengine#dsh-connect-volcengine'),
            'volcengine: row card',
          )
        } catch (cause) {
          console.error('[dsh-connect-volcengine] client failed to load:', cause)
        }
      },
    }
  },
})
