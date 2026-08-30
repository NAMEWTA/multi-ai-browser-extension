# Multi AI Workspace 技术架构

> 状态：当前唯一技术基线
> 版本：6.0
> 更新日期：2026-08-31

## 1. 架构结论

项目使用 WXT、React、TypeScript 和 Manifest V3。扩展页只负责编排和展示容器；真实 AI 官网在 iframe 或普通标签页中运行；Provider Content Script 在对应网页上下文内操作原生 DOM；Service Worker 校验身份、维护 frame 绑定并编排两阶段发送。

```text
Workspace extension page
  ├─ React UI + Zustand workspace state
  ├─ Dexie Session / Turn / Exchange history
  └─ provider iframe containers
             │ runtime messages
MV3 Service Worker
  ├─ frame / fallback-tab registry
  ├─ precheck / stage barriers + concurrent commit
  ├─ response event forwarding
  └─ session DNR iframe policy
             │ Port or frame message
Provider Content Script
  ├─ readiness and zero-mutation precheck
  ├─ stage, rollback and one-shot submit
  ├─ exact location.href reporting
  └─ visible assistant-response capture
```

工作台父页面不能直接访问跨域 iframe DOM。所有网页操作只能在匹配官网 origin 的 Content Script 中执行。

## 2. 消息协议

所有跨边界消息使用 Zod 验证，并校验 `panelId`、Provider、sender tab、frameId 和已登记 origin。

| 消息                         | 方向                | 作用                         |
| ---------------------------- | ------------------- | ---------------------------- |
| `FRAME_HELLO`                | Provider -> Worker  | 注册或恢复面板绑定           |
| `FRAME_STATUS`               | Provider -> Worker  | 上报加载、登录和就绪状态     |
| `WORKSPACE_SUBMIT`           | Workspace -> Worker | 冻结一轮发送及全部目标       |
| `PRECHECK_PROMPT`            | Worker -> Provider  | 无副作用预检并取得回复基线   |
| `STAGE_PROMPT`               | Worker -> Provider  | 写入、回读并等待可用发送控件 |
| `ROLLBACK_PROMPT`            | Worker -> Provider  | 清除仍属于本轮的暂存内容     |
| `COMMIT_PROMPT`              | Worker -> Provider  | 点击一次并开始回复采集       |
| `PROVIDER_RESPONSE_UPDATE`   | Provider -> Worker  | 上报等待、流式文本或终态     |
| `WORKSPACE_RESPONSE_UPDATE`  | Worker -> Workspace | 转发回复更新并写入历史       |
| `PROVIDER_URL_UPDATE`        | Provider -> Worker  | 原样上报当前完整 href        |
| `WORKSPACE_PANEL_URL_UPDATE` | Worker -> Workspace | 转发已验证的官方完整 URL     |
| `OPEN_PANEL_TAB`             | Workspace -> Worker | 使用普通标签页降级           |

协议中不存在草稿同步命令。输入事件不会跨越工作台边界。

## 3. 三阶段发送

### 3.1 冻结

点击发送时工作台生成不可变的 `sessionId` 和临时 `turnId`，冻结经过 trim 的 prompt 与目标快照。此时不创建 Turn/Exchange。

### 3.2 Precheck barrier

Worker 并发向全部目标发送 `PRECHECK_PROMPT`。Provider 必须完成：

1. URL、登录和 composer 就绪检查。
2. composer 为空检查，禁止覆盖官网中的用户草稿。
3. 上一条回复不处于生成状态。
4. 记录当前可见 assistant response 的数量和最后文本，作为本轮基线。

Precheck 不聚焦、不写入、不查找发送按钮、不点击。空 composer 状态下，官网按钮可能 disabled 或根本未渲染。如果任一结果不是 `prechecked/duplicate`，Worker 清理其他预检状态并直接返回。

### 3.3 Stage barrier 与 rollback

全部预检通过后，Worker 并发发送 `STAGE_PROMPT`。每个 Provider 原生写入 prompt、回读校验，并等待相邻的唯一可用发送控件，但不点击。

任一目标暂存失败时，失败 Provider 先自清理，Worker 再向全部已暂存目标发送 `ROLLBACK_PROMPT`。回滚只在 composer 当前值仍严格等于本轮 prompt 时清空，避免删除用户后续编辑。该批次不创建历史轮次。

### 3.4 Concurrent commit

全部通过后，Worker 并发发送 `COMMIT_PROMPT`。每个 Provider 串行执行：

```text
use staged composer and submit control
  -> revalidate enabled semantic control
  -> click once
  -> confirm composer/page/control state changed
  -> immediately report current full location.href
  -> launch response capture outside command queue
```

Provider 使用 phase record 与 `TaskLedger` 对 `turnId` 去重，要求状态严格按 prechecked -> staged -> submitted 推进。

Precheck 选定的 composer 会绑定在本轮 phase record 中，Stage、Commit 和 Rollback 必须继续使用同一个 DOM 元素。元素断开或被官网替换时安全失败，不允许重新查询后切换到另一个候选。

浏览器无法回滚已发生的跨站点击。因此“原子性”严格保证到 commit barrier；commit 内的运行时单站失败记录为部分提交，而不是虚构全局回滚。

至少一个目标返回 `submitted/duplicate` 后，工作台才调用 `recordSuccessfulTurn`，在单个 Dexie 事务内创建 Turn、Exchange、逐站结果并合并早到回复。全失败不落库。

## 4. Provider 合同

```ts
interface ProviderStrategy {
  probe(ctx: FrameContext): Promise<ProbeResult>;
  waitUntilReady(ctx: FrameContext): Promise<void>;
  prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline>;
  stagePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  rollbackPrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  submit(ctx: FrameContext): Promise<void>;
  captureResponse(ctx, baseline, onUpdate): Promise<ResponseCaptureUpdate>;
  startNewConversation(ctx: FrameContext): Promise<void>;
  diagnoseComposerCandidates?(ctx): readonly ComposerCandidateDiagnostic[];
}
```

### 4.1 Plugin + Registry

每个站点由 `definition + selectors + strategy` 组成，通过 Registry 自动发现。核心发送器、数据库和 UI 不包含站点 `switch`。

### 4.2 Template Method

`BaseDomStrategy` 固化预检、暂存、条件回滚、提交确认和回复稳定判定。站点策略仅覆写特殊编辑器或复用控件行为。

Kimi Lexical 使用浏览器原生编辑命令并回读，不直接伪造 React/Lexical 内部状态。DeepSeek 的圆形控件会在“发送/停止”之间复用，因此在 Stage 写入后校验控件语义，避免空输入状态误判或点击停止。

千问使用独立语义候选排名：排除搜索框、隐藏、只读、disabled 和不可编辑候选，优先当前主 composer、聊天语义和相邻 submit。占位节点与零宽标记在草稿判断时归一为空；诊断仅保存结构、得分、长度和拒绝原因，不保存正文。

### 4.3 Selector 顺序

优先级为稳定 test id、ARIA role/name、语义 data attribute、结构关系、最后才是易变 class。所有候选必须可见；实际 submit 还必须 enabled。无法唯一确认时返回结构化错误。

## 5. 回复采集

提交前保存 `ResponseBaseline { count, lastText }`。提交后 Content Script 轮询/观察可见 assistant response：

- 新节点出现或最后文本相对基线变化后进入 `streaming`。
- 文本每次变化上报最新纯文本。
- 生成/停止控件消失且文本稳定 1.8 秒后标记 `completed`。
- 达到站点回复超时后，有文本记为 `partial`，无文本记为 `timeout`。
- 没有配置回复 selector 的站点记为 `unsupported`。

采集只使用 DOM 可见文本，不读取 Cookie、localStorage、IndexedDB、Fetch/XHR 或内部 API。单条回复协议上限 2 MB。

## 6. Session 与官网 URL 持久化

Provider 直接读取 `window.location.href`，不识别、不拼接任何会话路径。Worker 只验证 URL 为 HTTPS、sender frame 绑定正确且 origin 属于对应 Provider，随后原样转发 Workspace。

Session 快照保存 `layoutMode` 以及按顺序排列的 `{panelId, providerId, url, selected, widthRatio}`。切换任务前强制保存当前快照，再激活目标 Session 并以其完整 URL 和新 iframe 实例恢复。

“新任务”不会在旧 iframe 中点击官网按钮，因为这会破坏旧任务上下文。它克隆当前站点组合、布局、选择和比例，但生成全新 panel ID，并把 URL 重置为各官网基础 URL。首次发送后正式会话 URL 覆盖该快照。

## 7. 数据模型

```ts
SessionRecord {
  id; title; createdAt; contentUpdatedAt; lastOpenedAt; pinnedAt?;
  source: "local" | "imported";
  workspace: SessionWorkspaceSnapshot;
}

TurnRecord {
  id; sessionId; sequence; prompt; createdAt;
  status: "preparing" | "aborted" | "waiting" | "completed" | "partial" | "failed";
}

ProviderExchangeRecord {
  id; sessionId; turnId; panelId; providerId; providerName; targetIndex;
  submitStatus;
  responseStatus;
  responseText?; submittedAt?; completedAt?; message?;
}
```

Dexie 使用全新数据库 `multi-ai-workspace-v4` 的单一当前 schema。活动 Session ID 独立保存于 metadata；会话列表只按显式 `pinnedAt` 和稳定 `createdAt` 排序，打开、发送、回复及工作区保存均不改变列表位置。

开发阶段不维护旧数据库迁移链，也不存在“先创建 Turn、再补提交结果”的旧写入 API。唯一发送落库入口是 `recordSuccessfulTurn`，至少一个站点确认提交后才在单一事务中创建 Turn 与 Exchange。

Turn 终态由 Exchange 聚合：全部已提交站点完成为 `completed`；存在有效回复和失败/超时为 `partial`；无有效回复为 `failed`。

## 8. JSONL 交换格式

文件扩展名 `.maiw.jsonl`，UTF-8，每行独立 JSON：

```json
{"type":"manifest","format":"multi-ai-workspace-history","version":3,"exportedAt":"...","counts":{"sessions":1,"turns":2,"exchanges":4}}
{"type":"session","data":{}}
{"type":"turn","data":{}}
{"type":"exchange","data":{}}
```

导入上限 50 MB。解析器只接受当前 v3，要求首行 manifest、唯一 manifest、清单数量一致、实体 ID 唯一、引用完整、Provider ID 受支持。快照 URL 必须属于对应官方 HTTPS origin。全部校验通过后才在单个 Dexie 事务中写入；Session、Turn、Exchange 和 Panel ID 全部重映射。

## 9. Markdown 转录

转录器是纯领域服务，只读取持久化的 `SessionDetail`，不跨域抓取父页面中的 iframe。支持完整 Session、当前打开 Provider、最新一轮、单 Provider 完整会话和单 Provider 最新问答五种范围，输出确定性的标题层级与安全文件名。剪贴板和下载只是 Workspace 的 I/O adapter。

## 10. 生命周期、权限与隐私

- `storage`：工作台设置、Dexie 历史和有界 runtime snapshot。
- `tabs`：工作台聚焦和普通标签页降级。
- `webNavigation`：发现/恢复 frame。
- `declarativeNetRequestWithHostAccess`：只在工作台 tab 的精确 provider subframe 上处理嵌入响应头。
- `host_permissions`：只包含预配置站点，不申请 `<all_urls>`。

不申请 `cookies` 权限。Content Script 不能直接写 `storage.session` 诊断；它只发送严格校验、无正文的诊断事件，由 Worker 验证 frame 绑定后写入每面板最多 80 条的环形记录。

## 11. 布局稳定性

- iframe 始终按容器原生 CSS 像素渲染，禁止 `transform: scale()`。
- 平铺使用站点轨道与 8px 分隔轨道交错的 CSS Grid，拖动只修改相邻比例。
- 自适应按容器整数宽度选择列数；`ResizeObserver` 不反写被观察尺寸。
- 切换布局、拖动、最大化均不卸载 iframe。拖动期间暂时禁止 iframe pointer events。

## 12. 验证分层

| 层级             | 重点                                                       |
| ---------------- | ---------------------------------------------------------- |
| 单元             | Zod 协议、DOM adapter、幂等、Session 排序、转录、JSONL     |
| Provider fixture | Precheck 零副作用、Stage 回滚、唯一提交、回复完成          |
| 扩展 E2E         | 动态按钮、Stage 回滚、失败零 Turn、完整 URL 往返、布局稳定 |
| 真实 smoke       | 最终 URL、登录态、真实 selector、一次发送和降级            |

Mock E2E 证明扩展编排，不证明真实官网长期兼容。真实 smoke 必须使用专用账号、非敏感提示词并控制频率。
