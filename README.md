# dsh-connect-volcengine

把**火山方舟（Volcengine Ark）**的模型接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

一把 ARK API Key，豆包 / DeepSeek / GLM / Kimi 全部进模型选择器。多账号可轮换，模型可用性用真实请求探测，用量可用 AK/SK 真读。

> 与 `dsh-connect-workbuddy` 的关系：那边是双供应商 + 积分体系，用 tab 隔开互相独立的事；本插件只有**一个**供应商，所以改成单列阅读流（健康条 → 账号 → 模型 → 能力 → 诊断），把"能不能用"压在最上面，一屏看到全部关键状态。

---

## 功能

| | |
|---|---|
| **单 provider** | 路由 `volcengine`，显示名「火山方舟 · Ark」 |
| **多账号池** | 每把 Key 一个账号；勾选参与轮换；失败自动换号（仅鉴权失败，请求本身不合法不换） |
| **账号池开关** | 开启后按池内顺序回退；关闭则只用选中账号 |
| **模型探测** | 逐个发 `max_tokens: 1` 真实请求，按返回码判定开通状态 |
| **只保留可用** | 把探测结果一键写进目录（按名称排序） |
| **逐模型上下文预算** | 原生 / 128K / 256K / 512K / 1M，只影响宿主何时压缩 |
| **图片输入** | 逐模型开关，默认来自官方文档的视觉能力表 |
| **搜索与筛选** | 按名称**或用途**搜索；按「全部 / 已启用 / 可看图 / 探测可用」筛选 |
| **逐模型说明** | 每个模型自带「适合 / 注意」两句话，折叠一行显示，点开看完整 |
| **自主生图** | `volcengine_draw_image`，默认关闭；开启即注册，关闭即撤销 |
| **用量读取** | AK/SK + SignatureV4 → `GetInferenceUsage`，按模型列 input/output/total/请求数 |
| **诊断** | provider、上游域名、注册状态、宿主下发数、生图工具、选择器顺序 |

---

## 安装

```bash
git clone https://github.com/ElioFanyu/dsh-connect-volcengine.git
```

然后在 DSH 的 Plugin Manager 里以该目录安装，或直接写进 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-connect-volcengine
  name: dsh-connect-volcengine
```

---

## 配置

全部落在 profile 的 `cordis.patch.yml`；卡片会替你写，手改也认。

```yaml
- id: dsh-connect-volcengine
  name: dsh-connect-volcengine
  config:
    enabled: true
    baseURL: https://ark.cn-beijing.volces.com/api/v3
    accounts:
      - id: default
        label: 主账号
        ref: ARK_API_KEY
        enabled: true
    activeAccountId: default
    poolEnabled: false
    models: []
    imageToolEnabled: false
    imageModel: doubao-seedream-3-0-t2i-250415
    accessKeyRef: ''      # 可选，读用量用
    secretKeyRef: ''
```

`ref` / `accessKeyRef` / `secretKeyRef` 都是**凭据引用名**，不是密钥本身：卡片把密钥写进宿主凭据库，配置文件里只留名字，分享配置不会泄漏凭据。

`models: []` 表示用内置种子（本账号已开通的那批）。

---

## 两个关键事实（都经过实测）

### 1. 未开通的模型真的调不了

| 状态 | HTTP | 错误码 |
|---|---|---|
| 已开通 | 403 / 200 | `AccountOverdueError` / 正常 |
| 未开通 | **404** | `InvalidEndpointOrModel.NotFound` |
| ID 写错 | **404** | 同上（**无法区分**） |

所以探测只对**官方目录里存在的 id** 下结论；404 一律按"未开通/不可用"处理。

### 2. ARK Key 读不到用量

方舟的[查询推理用量](https://ark.volcengine.com/region:cn-beijing/docs/get-inference-usage-api.md)明确写着「**本接口仅支持 Access Key 鉴权**」，`/api/v3` 下也没有余额端点。想读用量只能给一对 AK/SK（签名走 SignatureV4，服务名 `ark`）。不给的话卡片只显示控制台直链，不编数字。

---

## 每个模型的「适合干什么」

目录里每个模型都有一段人工整理的说明，存在 [`lib/model-notes.js`](lib/model-notes.js)：

- **适合**：具体到场景，不写"能力强"这种空话；
- **注意**：什么地方会翻车——这一段必须有，空着等于把人往坑里带。

卡片里默认压成一行（只显示「适合」那句话），点一下展开「适合 / 注意」两段。

宿主另外把 `short` 挂到 `LlmModelInfo.description` 上（模型目录线协议有这个字段，`/models` 路由也会透出 `description`）。但**本版 Web GUI 的模型菜单只渲染名字**，不渲染 description——所以别指望在下拉里读到说明，完整内容在设置卡片里看。

这份文案是**编辑内容，不是上游字段**。Ark 的 `/models` 只给 id，官方文档只给规格，"拿它干什么活"没有任何接口能告诉你。所以它跟 `OFFICIAL_MODELS`（可核对的规格）分开存放——规格错了是 bug，文案不合适只是编辑问题。

搜索框同时匹配说明文字：想找"翻译"或"角色扮演"，记得住的往往是用途而不是 `doubao-seed-translation-250915` 这种 id。

---

## 模型规格来自哪里

`contextWindow` / `maxOutput` 取自[官方模型列表](https://ark.volcengine.com/region:cn-beijing/docs/model-list.md)（2026-10-26 版），是**权威值**，不是探测值。

注意这两个是**不同的量**：

- `contextWindow`：能塞多少输入（1M / 256K / …）
- `maxOutput`：单次最多吐多少（256K / 128K / …）

混用会让压缩时机和长度校验全错。早期版本曾把 `max_tokens` 闸门（262144）当上下文窗口填，导致 10 个 1M 模型被压成 256K——那是错的。

---

## 上下文预算是什么

卡片里每行的「预算」下拉是**软约束**：只决定 DSH 何时开始压缩对话，**不改变上游真实容量**。

- `原生`（0）：按模型真实窗口
- `128K / 256K / 512K / 1M`：提前压缩，给长会话留余量

上游拒绝（`context_window` 超限）时应把预算调小。

---

## 探测会花钱

每个模型一次 `max_tokens: 1`，实测单次 prompt 约 37 token。18 个模型全探一次约 700 token。

**只在点按钮时执行**，插件不会在后台偷偷跑。

---

## 本地探测路由

仅 loopback 可达，POST 校验同源：

| 路由 | 作用 |
|---|---|
| `GET .../status` | 卡片数据源 |
| `GET .../models` | 宿主**实际下发**的模型清单 |
| `POST .../refresh` | 上游目录（草稿，不写配置） |
| `POST .../probe` | 逐模型探测可用性 |
| `POST .../usage` | AK/SK 读用量 |
| `POST .../save` | 写设置 / 写凭据 |
| `POST .../test` | 单账号连通性 |
| `POST .../dispatch` | 走真正的 `llm.stream` 派发一次 |

`/dispatch` 与 `/test` 是两件事：`/test` 直接 fetch 上游，验证凭据与网关；模型选择器点下去走的是 adapter → `llm.stream`。任何一环写错，`/test` 都照样 ok 而会话里失败——这个探测就是为那个缺口存在的。

---

## 已知限制

- **欠费时探测只能判"已开通"，判不了"有余额"**：所有可达模型都返回 `AccountOverdueError`，掩盖了正常调用。
- **`doubao-seed-evolving` 不在自动开通范围**（官方说明），需在控制台手动开通。
- **图片能力按官方文档标注**，未逐模型实测；宣告 1M 输出的模型，实际输出仍受上游流控影响。
- **AK/SK 权限远大于 ARK Key**，只在需要用量时填写。
- **已开通清单不是写死的**：内置的种子只是首次运行的初始值，真实状态以「探测」结果为准。
- **模型说明是按 id 精确匹配的**：说明表键是 Ark 的模型 id；自己改了 id（例如填别名）那一行就不显示说明。宁可空着，也不贴一段可能属于别的模型的说明——id 里带日期，猜错一位就是另一个快照的行为。

---

## 许可证

MIT
