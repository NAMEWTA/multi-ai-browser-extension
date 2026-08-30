# Multi AI Workspace 技术架构

> 状态：当前唯一技术基线
> 版本：4.0
> 更新日期：2026-08-30

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
  ├─ strict prepare barrier + concurrent commit
  ├─ response event forwarding
  └─ session DNR iframe policy
             │ Port or frame message
Provider Content Script
  ├─ readiness and zero-mutation preflight
  ├─ native composer write/readback/submit
  ├─ official new-conversation action
  └─ visible assistant-response capture
```

工作台父页面不能直接访问跨域 iframe DOM。所有网页操作只能在匹配官网 origin 的 Content Script 中执行。

## 2. 消息协议

所有跨边界消息使用 Zod 验证，并校验 `panelId`、Provider、sender tab、frameId 和已登记 origin。

| 消息                        | 方向                | 作用                       |
| --------------------------- | ------------------- | -------------------------- |
| `FRAME_HELLO`               | Provider -> Worker  | 注册或恢复面板绑定         |
| `FRAME_STATUS`              | Provider -> Worker  | 上报加载、登录和就绪状态   |
| `WORKSPACE_SUBMIT`          | Workspace -> Worker | 冻结一轮发送及全部目标     |
| `PREPARE_PROMPT`            | Worker -> Provider  | 无副作用预检并取得回复基线 |
| `COMMIT_PROMPT`             | Worker -> Provider  | 写入、回读、点击并开始采集 |
| `PROVIDER_RESPONSE_UPDATE`  | Provider -> Worker  | 上报等待、流式文本或终态   |
| `WORKSPACE_RESPONSE_UPDATE` | Worker -> Workspace | 转发回复更新并写入历史     |
| `WORKSPACE_NEW_SESSION`     | Workspace -> Worker | 请求全部已打开面板新建会话 |
| `START_NEW_CONVERSATION`    | Worker -> Provider  | 点击并确认官网新对话       |
| `OPEN_PANEL_TAB`            | Workspace -> Worker | 使用普通标签页降级         |

协议中不存在草稿同步命令。输入事件不会跨越工作台边界。

## 3. 两阶段发送

### 3.1 冻结

点击发送时工作台生成不可变的 `sessionId` 和 `turnId`，冻结经过 trim 的 prompt 与目标快照，并先创建本地 Turn/Exchange 记录。

### 3.2 Prepare barrier

Worker 并发向全部目标发送 `PREPARE_PROMPT`。Provider 必须完成：

1. URL、登录和 composer 就绪检查。
2. composer 为空检查，禁止覆盖官网中的用户草稿。
3. 上一条回复不处于生成状态。
4. 可见发送控件存在；允许空输入时原生 disabled。
5. 记录当前可见 assistant response 的数量和最后文本，作为本轮基线。

Prepare 不聚焦、不写入、不点击。如果任一结果不是 `prepared/duplicate`，Worker 把其他成功预检结果转换为 `aborted` 并直接返回，整个批次零点击。

### 3.3 Concurrent commit

全部通过后，Worker 并发发送 `COMMIT_PROMPT`。每个 Provider 串行执行：

```text
write native composer
  -> dispatch native input/change events
  -> read back normalized text
  -> locate enabled semantic send control near composer
  -> click once
  -> confirm composer/page/control state changed
  -> launch response capture outside command queue
```

Provider 使用 `TaskLedger` 对 `turnId` 去重。Prepare 与 Commit 使用独立 operation key，避免相同 `turnId` 的两个阶段互相抢占 pending response。

浏览器无法回滚已发生的跨站点击。因此“原子性”严格保证到 commit barrier；commit 内的运行时单站失败记录为部分提交，而不是虚构全局回滚。

## 4. Provider 合同

```ts
interface ProviderStrategy {
  probe(ctx: FrameContext): Promise<ProbeResult>;
  waitUntilReady(ctx: FrameContext): Promise<void>;
  prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline>;
  writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  submit(ctx: FrameContext): Promise<void>;
  captureResponse(ctx, baseline, onUpdate): Promise<ResponseCaptureUpdate>;
  startNewConversation(ctx: FrameContext): Promise<void>;
}
```

### 4.1 Plugin + Registry

每个站点由 `definition + selectors + strategy` 组成，通过 Registry 自动发现。核心发送器、数据库和 UI 不包含站点 `switch`。

### 4.2 Template Method

`BaseDomStrategy` 固化预检、原生写入、提交确认、回复稳定判定和新会话确认。站点策略仅覆写特殊编辑器或复用控件行为。

Kimi Lexical 使用浏览器原生编辑命令并回读，不直接伪造 React/Lexical 内部状态。DeepSeek 的圆形控件会在“发送/停止”之间复用：Prepare 在空 composer 时记录控件指纹，Commit 写入后只有指纹发生变化才允许点击。

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

## 6. 新建会话

“新任务”不是清空工作台输入框的别名。Worker 向所有已打开面板发送 `START_NEW_CONVERSATION`。Provider 通过语义 selector 或可访问名称定位官方按钮，点击后确认 URL 变化、旧回复减少或空会话 composer 稳定。

工作台随后归档当前 active Session 并创建新 Session。失败面板显示错误并从发送目标中取消，避免新旧官网上下文混入同一轮。

## 7. 数据模型

```ts
SessionRecord {
  id; title; createdAt; updatedAt;
  status: "active" | "archived" | "imported";
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

Dexie 使用数据库 `multi-ai-workspace-v3` 的 schema version 2。旧 `sendRecords` 表保留用于单次迁移；迁移完成标记写入 `metadata`，后续新功能不再写旧表。

Turn 终态由 Exchange 聚合：全部已提交站点完成为 `completed`；存在有效回复和失败/超时为 `partial`；无有效回复为 `failed`。

## 8. JSONL 交换格式

文件扩展名 `.maiw.jsonl`，UTF-8，每行独立 JSON：

```json
{"type":"manifest","format":"multi-ai-workspace-history","version":1,"exportedAt":"...","counts":{"sessions":1,"turns":2,"exchanges":4}}
{"type":"session","data":{}}
{"type":"turn","data":{}}
{"type":"exchange","data":{}}
```

导入上限 50 MB。解析器要求首行 manifest、唯一 manifest、清单数量一致、实体 ID 唯一、引用完整、Provider ID 受支持。全部校验通过后才在单个 Dexie 事务中写入；Session、Turn、Exchange ID 全部重映射。

## 9. 生命周期、权限与隐私

- `storage`：工作台设置、Dexie 历史和有界 runtime snapshot。
- `tabs`：工作台聚焦和普通标签页降级。
- `webNavigation`：发现/恢复 frame。
- `declarativeNetRequestWithHostAccess`：只在工作台 tab 的精确 provider subframe 上处理嵌入响应头。
- `host_permissions`：只包含预配置站点，不申请 `<all_urls>`。

不申请 `cookies` 权限。Content Script 不能直接写 `storage.session` 诊断；它只发送严格校验、无正文的诊断事件，由 Worker 验证 frame 绑定后写入每面板最多 80 条的环形记录。

## 10. 布局稳定性

- iframe 始终按容器原生 CSS 像素渲染，禁止 `transform: scale()`。
- 平铺使用站点轨道与 8px 分隔轨道交错的 CSS Grid，拖动只修改相邻比例。
- 自适应按容器整数宽度选择列数；`ResizeObserver` 不反写被观察尺寸。
- 切换布局、拖动、最大化均不卸载 iframe。拖动期间暂时禁止 iframe pointer events。

## 11. 验证分层

| 层级             | 重点                                                        |
| ---------------- | ----------------------------------------------------------- |
| 单元             | Zod 协议、DOM adapter、幂等、Session 聚合、迁移、JSONL      |
| Provider fixture | Prepare 零副作用、原生写入、唯一提交、回复完成、新对话      |
| 扩展 E2E         | 草稿隔离、严格 barrier、同 Session 多轮、回复落库、布局稳定 |
| 真实 smoke       | 最终 URL、登录态、真实 selector、一次发送和降级             |

Mock E2E 证明扩展编排，不证明真实官网长期兼容。真实 smoke 必须使用专用账号、非敏感提示词并控制频率。
