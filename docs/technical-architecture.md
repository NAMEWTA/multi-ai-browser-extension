# Multi AI Workspace 技术架构

> 状态：当前唯一技术基线  
> 版本：3.0  
> 更新日期：2026-08-30

## 1. 架构结论

采用 WXT + React + TypeScript + Manifest V3。扩展页负责工作台 UI，第三方网页在独立 iframe 中运行；注入到各站点 frame 的 Content Script 负责定位和操作原生 DOM；Service Worker 负责工作台、frame 和普通标签页之间的可信路由。

```text
Workspace extension page
  ├─ UI state / settings / send history
  ├─ Provider iframe windows
  └─ runtime commands
           │
MV3 Service Worker
  ├─ tab and frame registry
  ├─ task routing and deduplication
  ├─ host permission and DNR rules
  └─ fallback tab bindings
           │
Provider Content Scripts
  ├─ probe page state
  ├─ locate native composer
  ├─ write and verify text
  └─ submit once and report result
```

## 2. 浏览器事实与约束

### 2.1 跨域 DOM

工作台父页面不能直接读取跨域 iframe DOM。Provider Content Script 必须注入匹配的 frame，并通过 `chrome.runtime` Port 或严格校验的窗口消息接收命令。

### 2.2 iframe 限制

AI 网站可能返回 `X-Frame-Options` 或 CSP `frame-ancestors`。Chrome DNR 可以修改响应头，但这只是浏览器扩展能力，不代表网站承诺兼容。规则必须：

- 只针对用户已启用的精确站点。
- 只作用于工作台 tab 的 `sub_frame` 请求。
- 使用 session rules，工作台关闭后清理。
- 不删除与嵌入无关的安全响应头。
- 失败时转入普通标签页，不呈现空白伪成功状态。

### 2.3 Cookie 与站点存储

扩展不使用 `chrome.cookies` 读取或复制 Cookie。Chrome 官方说明：当顶层页面是 `chrome-extension://` 且扩展拥有被嵌站点的 host permission 时，被嵌站点可获得其顶层存储分区；第三方 Cookie 也不会仅因扩展顶层页面而被阻断。仍需逐站验证重定向、SSO、组织账号和分区 Cookie 行为。

### 2.4 MV3 生命周期

Service Worker 会被随时回收。frame 绑定不能只存在内存中：

- 使用 `chrome.storage.session` 保存运行快照。
- Content Script 建立长连接并定期发送 heartbeat。
- 恢复时通过 tab/frame URL 和 Provider origin 重新发现。
- 所有命令携带 `taskId`，Provider frame 持有有界幂等账本。

## 3. 模块边界

```text
src/
  core/
    messaging/          版本化命令与事件协议
    orchestration/      Provider 侧任务幂等
    permissions/        session DNR frame 策略
    providers/          稳定合同、注册表和 DOM 工具
  providers/<id>/       站点定义、selector、策略和测试 fixture
  runtime/              Port、frame 状态和恢复
  db/                   仅发送快照和逐站结果
  entrypoints/
    background.ts       MV3 Service Worker
    provider-bridge.*   内置站点 Content Script
    workspace/          全页工作台
```

依赖只能由外向内：UI 和 Provider 插件依赖核心合同，核心编排不依赖具体站点。新增 Provider 不得修改广播器或历史服务中的 `switch`。

## 4. 核心合同

```ts
interface ProviderDefinition {
  id: ProviderId;
  name: string;
  defaultUrl: string;
  matches: readonly string[];
  embedMode: "preferred" | "experimental" | "tab-only";
}

interface ProviderStrategy {
  probe(context: FrameContext): Promise<ProbeResult>;
  waitUntilReady(context: FrameContext): Promise<void>;
  writePrompt(context: FrameContext, prompt: PromptPayload): Promise<void>;
  submit(context: FrameContext): Promise<void>;
}
```

`writePrompt` 和 `submit` 分离，因为全局输入同步与最终发送是两个不同动作。工作台每次输入变化只发 `SYNC_PROMPT`；只有显式点击发送或按下 Enter 才发 `SUBMIT_PROMPT`。

## 5. 命令与状态模型

### 5.1 命令

- `WORKSPACE_READY`：建立工作台 tab 和 iframe 规则。
- `FRAME_HELLO`：frame 声明 Provider、URL 和能力。
- `SYNC_PROMPT`：写入并回读验证，不发送。
- `SUBMIT_PROMPT`：提交当前已同步文字，一次性命令。
- `OPEN_PANEL_TAB`：进入普通标签页降级。
- `FRAME_STATUS`：上报加载、登录、就绪和错误。

所有跨边界消息使用 Zod 校验。发送命令同时校验 `panelId`、`providerId`、`taskId`、sender tab、frameId 和 origin。

### 5.2 面板状态

```text
loading -> ready -> syncing -> ready -> submitting -> submitted -> ready
    |         |        |          |           |
    v         v        v          v           v
needs-login  blocked  sync-error  submit-error  unavailable
```

状态转换由事件驱动，不用多个互相矛盾的布尔值表达。面板错误不改变其他面板状态。

### 5.3 同步节流

- 输入变化以 120ms trailing debounce 广播。
- 每个面板只保留最新 `revision`，丢弃过期写入。
- IME composition 期间不广播，`compositionend` 后立即同步。
- 同步写入不得调用 Provider 输入框的 `focus()`；全局输入期间焦点必须始终留在工作台输入框。
- Provider 收到发送命令后再次写入并回读最终文本，再触发该网页的一次原生提交。
- 用户可在面板内手动修改；下一次全局输入会明确覆盖当前启用面板的输入内容。

## 6. Provider 设计模式

### 6.1 Plugin + Registry

每个站点是独立插件。Registry 按 URL 匹配插件并提供 UI 元数据，核心不维护站点分支。

### 6.2 Template Method

`BaseDomStrategy` 固化稳定流程：探测页面、等待就绪、查找可见输入框、聚焦、通过原生 setter 写入、派发输入事件、回读验证、查找可用发送按钮、点击、验证提交。

### 6.3 Strategy + Composition

输入机制组合为 `TextareaWriter`、`ContentEditableWriter`、`ProseMirrorWriter`；提交机制组合为 `ButtonSubmitter`、`KeyboardSubmitter`。平台只声明 selector 和必要覆写，避免复制整个流程。

### 6.4 Adapter

Provider Strategy 把不断变化的网站 DOM 适配为稳定的 `sync`/`submit` 合同。selector 按稳定性排序：`data-testid`、ARIA role/name、语义属性、结构关系，易变 class 仅作末级候选。

### 6.5 Circuit Breaker

同一 Provider 连续失败达到阈值后暂停自动提交并提示刷新或降级，防止页面改版时误操作。用户手动刷新后重新 probe。

## 7. 数据模型

MVP 不保存回答正文，只保存发送快照：

```ts
interface SendRecord {
  id: string;
  taskId: string;
  prompt: string;
  createdAt: string;
  targets: Array<{
    panelId: string;
    providerId: ProviderId;
    providerName: string;
    status: "submitted" | "failed" | "unavailable";
    message?: string;
  }>;
}
```

点击历史只打开只读详情抽屉。不得把历史条目解释为可恢复会话，也不存储 iframe 当前 URL 作为恢复承诺。

## 8. 权限与隐私

- `storage`：保存设置、面板选择、发送历史和 session 快照。
- `tabs`：打开/聚焦工作台与标签页降级。
- `webNavigation`：发现和恢复 frame。
- `declarativeNetRequestWithHostAccess`：仅在工作台 tab 内处理嵌入响应头。
- `host_permissions`：只列 7 个预配置站点的精确域名，不申请可选全站权限。

不申请 `cookies`，不申请 `<all_urls>` 必选权限，不上传提示词、历史或网页内容。Chrome Web Store 仍要求披露本地处理的表单内容、网页内容和浏览活动。

## 9. 测试策略

| 层级        | 验证内容                                             |
| ----------- | ---------------------------------------------------- |
| 单元测试    | 协议、幂等、并发隔离、DOM writer、selector、历史迁移 |
| DOM fixture | 每个 Provider 的输入、回读、发送与错误状态           |
| 扩展 E2E    | 分栏、同步但不发送、统一发送、单站追问、历史、恢复   |
| 视觉测试    | 1280/1440/1920/2560 宽度、1/2/3/6 面板、侧栏开关     |
| 真实 smoke  | 登录态、最终 URL、输入同步、一次发送、降级结果       |

Mock E2E 只能证明扩展编排正确，不能证明真实站点可用。真实发送测试必须使用专用测试账号、无敏感提示词并控制频率。

## 10. 参考依据

- Chrome Content Scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome Declarative Net Request: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- Chrome Storage and Cookies: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Chrome Web Store User Data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Coze iframe 限制说明: https://docs.coze.cn/guides_FAQ
