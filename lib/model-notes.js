/**
 * 每个模型的「适合干什么」说明。
 *
 * 为什么单独一个文件：这些文字是**人写的经验**，不是从任何接口读到的字段。上游
 * `/models` 只给 id，官方文档给的是规格（窗口、输出上限），都不告诉人"拿它干
 * 什么活"。把它跟 `OFFICIAL_MODELS`（可核对的规格）分开放，是为了让"这份文案
 * 是主观的"这件事在代码结构上一目了然——规格错了是 bug，文案不合适是编辑问题。
 *
 * 三条约定：
 *
 * - `fit`    适合什么，一到两件事，具体到场景，不写"能力强"这种空话；
 * - `caveat` 什么地方会翻车，必须写，空着等于把用户往坑里带；
 * - `short`  给模型选择器用的一句话（那些下拉框很窄，超过 ~16 字就会被截）；
 * - `family` 系列，供卡片分组或排序时参考。
 *
 * 键是 Ark 的模型 id。快照型号（带日期后缀）落它对应的主型号文案，但要在
 * `caveat` 里说明"版本固定"，因为它和滚动更新的主型号行为会分叉。
 */
export const MODEL_NOTES = Object.freeze({
  // ── DeepSeek ──
  'deepseek-v4-flash-ga-260731': {
    family: 'DeepSeek',
    short: '高频低成本对话',
    fit: '高频、低成本的通用对话、基础文本任务、延迟敏感的简单 Agent 流程。',
    caveat: '简单任务够用，高难度任务与 Pro 有差距；幻觉率偏高，事实准确性要求高的场景需人工把关。',
  },
  'deepseek-v4-pro-ga-260813': {
    family: 'DeepSeek',
    short: '复杂推理 / 高难 Agent',
    fit: '复杂逻辑推理、数学与 STEM 高难度任务、高难度 Agent 工作流、Agentic Coding。',
    caveat: '成本高于 Flash；适合「难任务」，不适合无脑高频调用。',
  },
  'deepseek-v4-pro-260425': {
    family: 'DeepSeek',
    short: 'V4-Pro 日期快照',
    fit: 'V4-Pro 的固定日期快照，能力定位同 V4-Pro：复杂推理、高难度 Agent 与 Agentic Coding。',
    caveat: '该 id 不在官方模型总表里，规格未知；2026-10 探测时本账号返回 404（未开通），用之前先点一次探测。',
  },
  'deepseek-v4-1-flash-261017': {
    family: 'DeepSeek',
    short: '日常写码 / 问答',
    fit: '日常写代码、问答、中等复杂度工程任务；追求「够用且便宜」的高频调用。',
    caveat: '长编码会话综合表现不错、成本低；不确定答案时仍需人工审核。',
  },
  'deepseek-v4-1-flash-economy-261017': {
    family: 'DeepSeek',
    short: '极致低价批量',
    fit: '对价格极度敏感、可接受轻微质量折损的高频批量调用。',
    caveat: '更偏「量大管饱」，不适合精益求精的高质量交付。',
  },

  // ── 豆包 Seed 2.0 ──
  'doubao-seed-2-0-code-preview-260215': {
    family: 'Doubao Seed 2.0',
    short: '企业级编码 / TRAE',
    fit: '企业级多语言编码、前端开发、仓库级代码理解；接入 AI 编程工具链（如 TRAE）使用。',
    caveat: '强在编程专项，不适合当通用办公/对话模型替代品；preview 快照，行为可能变。',
  },
  'doubao-seed-2-0-lite-260428': {
    family: 'Doubao Seed 2.0',
    short: '大规模多模态批处理',
    fit: '大规模、批量化多模态推理；视频 + 图像 + 音频 + 文本联合分析；GUI 自动化操作。',
    caveat: '企业级多模态部署的性价比选择；纯文本深度推理不是主攻方向。',
  },
  'doubao-seed-2-0-mini-260428': {
    family: 'Doubao Seed 2.0',
    short: '高并发轻量任务',
    fit: '高并发智能客服、批量内容处理、格式化信息提取；低时延、成本敏感的轻量任务。',
    caveat: '输出质量定位「够用」，不适合高复杂度推理或高质量创作。',
  },
  'doubao-seed-2-0-pro-260215': {
    family: 'Doubao Seed 2.0',
    short: '2.0 旗舰通用',
    fit: '2.0 代的旗舰通用模型：复杂一点的对话、内容生成与需要稳定质量的常规任务。',
    caveat: '同代被 2.1 系列全面覆盖，新项目建议先从 2.1 系列里挑。',
  },

  // ── 豆包 Seed 2.1 ──
  'doubao-seed-2-1-pro-260915': {
    family: 'Doubao Seed 2.1',
    short: '复杂工程 / 深度办公',
    fit: '复杂工程交付、长链路 Agent 任务；看图写代码（设计稿/录屏→前端代码）；金融投研、办公自动化等长报告场景。',
    caveat: '代码「产品感」强，但「系统级工程」能力仍弱于 GLM-5.2 等专项工程模型。',
  },
  'doubao-seed-2-1-pro-260628': {
    family: 'Doubao Seed 2.1',
    short: '2.1 Pro 固定快照',
    fit: 'Seed 2.1 Pro 的特定日期快照；复杂工程交付、长链路 Agent、看图写代码、深度办公 Agent。',
    caveat: '版本固定，适合需要可复现结果的评估或生产场景；要跟随最新改进请用 260915。',
  },
  'doubao-seed-2-1-lite-260915': {
    family: 'Doubao Seed 2.1',
    short: '轻量问答 / 文档处理',
    fit: '轻量问答、文档处理、成本敏感的批量任务；对复杂度和时延要求不高的场景。',
    caveat: '复杂输出质量会明显下降，不适合承担高难度工程或深度推理。',
  },
  'doubao-seed-2-1-turbo-260628': {
    family: 'Doubao Seed 2.1',
    short: 'Pro 效果的规模化生产',
    fit: 'Pro 的规模化生产版本；需要稳定承接大量线上调用的 Coding、Agent 与多模态任务；成本与吞吐优先的批量部署。',
    caveat: '适合标准化流程大规模落地；探索性、超高复杂度任务仍建议用 Pro。',
  },

  // ── 豆包 Seed 专用 ──
  'doubao-seed-character-260628': {
    family: 'Doubao Seed 专用',
    short: '角色扮演 / 陪伴',
    fit: '角色扮演、虚拟陪伴、剧情演绎；几十轮以上的稳定人设对话。',
    caveat: '专用模型，通用任务不建议使用。',
  },
  'doubao-seed-evolving': {
    family: 'Doubao Seed 专用',
    short: '数字员工跑腿',
    fit: '仓库级代码巡检与修复、长链路工具调用自动化、跨软件复合办公任务；需要「数字员工替你跑腿」的场景。',
    caveat: '版本周级持续进化，结果可能波动；最终交付质量仍需人工验收，视觉与工程闭环尚不完美。',
  },
  'doubao-seed-translation-250915': {
    family: 'Doubao Seed 专用',
    short: '批量多语言翻译',
    fit: '大批量、低成本的多语言翻译任务，支持 28 种语言。',
    caveat: '专用翻译模型，不承担通用推理或创作任务；窗口只有 4K，长文档要自己切。',
  },

  // ── GLM ──
  'glm-5-2-260617': {
    family: 'GLM',
    short: '项目级工程接管',
    fit: '项目级工程接管；跨文件长程重构；生产级规范压力测试；移动端真机调试闭环；微信小程序从 Web 迁移。',
    caveat: '主要是文本模型，多模态需外部配合；部分场景速度偏慢，可能用默认设定覆盖用户指令。',
  },
  'glm-5-3-flash-260828': {
    family: 'GLM',
    short: 'Office 成品交付',
    fit: 'Office 与专业文档成品交付（PPTX/PDF/DOCX/XLSX）；金融研究、专业文档处理；前端/游戏/Blender 3D 场景与 GUI 协同；简单 Agent 与信息整理。',
    caveat: '定位是 Flash，极端复杂推理仍应交给 GLM-5.2 或更高档位。',
  },

  // ── Kimi ──
  'kimi-k3-1-pro-261024': {
    family: 'Kimi',
    short: '一次读透长文档',
    fit: '深度长文档分析；大型工程重构；需要「一次读透、想深」的高价值一次性任务；图文视频输入场景。',
    caveat: '慢且贵；纯文本高频调用性价比不高。',
  },
})

/**
 * 取一个模型的说明。
 *
 * 精确 id 优先。找不到就返回 `undefined`——宁可不显示，也不要贴一段可能不属于
 * 这个模型的说明：模型 id 里带日期，猜错一位就是另一个快照的行为。
 */
export function noteFor(id) {
  if (typeof id !== 'string' || id === '') return undefined
  return MODEL_NOTES[id]
}
