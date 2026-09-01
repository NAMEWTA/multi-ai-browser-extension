# 原生 Copy 回复采集调研

日期：2026-09-01

## 1. 结论摘要

站点原生 Copy 值得作为逐轮终态正文的高可信数据源，但不适合成为实时采集主链路。成熟实现的共同点是：在页面主世界临时拦截剪贴板 API，点击当前消息自己的 Copy 按钮，等待站点写入，捕获后无条件恢复；长会话完整导出则优先使用结构化会话 API，因为虚拟列表中的历史消息可能根本不在 DOM。

据此，本 change 采用以下边界：

- DOM 负责实时预览和超时 checkpoint。
- 原生 Copy 只确认当前轮终态内容。
- 虚拟历史与站点 API 是独立问题，不因加入原生 Copy 而宣称解决。
- Readability、Turndown 和 DOM clone 只处理已经取得的 DOM，不能恢复缺失节点。

## 2. 直接相关的开源实现

### 2.1 ai.md：页面主世界截获站点 Copy

[ai.md](https://github.com/koobzaar/ai.md) 的关键实现位于 [page/exporter.js](https://github.com/koobzaar/ai.md/blob/f5f5cef40fc9955482cfed552132031f024bdfb8/page/exporter.js) 和 [content/content.js](https://github.com/koobzaar/ai.md/blob/f5f5cef40fc9955482cfed552132031f024bdfb8/content/content.js)。

其 Claude/Gemini 流程是：

1. isolated content script 将 exporter 注入页面上下文。
2. 临时替换 `navigator.clipboard.writeText`；Gemini 同时替换 `navigator.clipboard.write`。
3. 点击每条消息对应的站点 Copy 按钮。
4. 等待捕获数组出现新值，失败时按条重试。
5. 在 `finally` 中恢复原始方法。
6. 捕获不到时才退回 DOM-to-Markdown。

可直接借鉴：

- 必须覆盖 `writeText` 与 `write` 两条路径。
- `ClipboardItem` 应按 MIME 读取，不能假设只有 `text/plain`。
- 实施采用 `document_start` 默认透传 wrapper；真正的拦截窗口必须有界、single-flight，并在所有结束路径解除 armed 状态。
- provider 应定位消息自己的 Copy 按钮，而不是从页面全局按钮列表猜测轮次。

不能照搬：

- ai.md 会为批量导出逐条点击历史按钮；本项目的正常发送流程只允许捕获刚生成的当前轮。
- 其滚动加载策略依赖最终 DOM 仍保留旧消息，遇到真正虚拟化时仍可能漏历史。
- 页面可能把 clipboard 方法缓存为 bound reference，或把属性设为不可写，此时运行时 patch 无法保证生效。

### 2.2 ChatDump：虚拟列表要求 API-first

[ChatDump](https://github.com/mauriziofonte/chat-dump-bookmarklet) 在 [ChatDump.js](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/a5d80c653690a42eba6c1b69bb93a6e53d3910ba/src/ChatDump.js) 中先运行 provider 的 remote extractor，10 秒无结果才回退到 `document.body.cloneNode(true)`。

- [ChatGPTParser.js](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/a5d80c653690a42eba6c1b69bb93a6e53d3910ba/src/Parsers/ChatGPTParser.js) 从 `current_node` 沿 `parent` 还原活跃分支。
- [ClaudeParser.js](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/a5d80c653690a42eba6c1b69bb93a6e53d3910ba/src/Parsers/ClaudeParser.js) 明确说明页面只保留最近一部分消息。
- [GeminiParser.js](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/a5d80c653690a42eba6c1b69bb93a6e53d3910ba/src/Parsers/GeminiParser.js) 使用 cursor 分页并按父指针选择真正继续的 regenerated response。

这证明原生 Copy 与 API 解决的是不同范围：

- 当前轮仍挂载且有 Copy 按钮时，原生 Copy 可以得到高质量终态正文。
- 旧轮已经从 DOM 卸载时，没有按钮可以点击；必须依赖此前的逐轮持久化或另行评审的 API adapter。

本 change 不引入私有 API。若未来加入 provider API，必须单独完成用户授权、凭据不落盘、schema drift、401/429、服务条款和许可证评审。

### 2.3 DeepSeek API 项目：说明 API 是独立能力

[decant-core DeepSeek adapter](https://github.com/Covai-Labs/decant-core/blob/124396464672bceca57f41f504e2f6e9dba36e76/ai/deepseek.js) 读取 `history_messages` 并从 `current_message_id` 沿 `parent_id` 恢复分支。[Chat2Note DeepSeek parser](https://github.com/shiquda/chat2note/blob/8d2a8aa1a367fca26f348565fde9f862f371e1fe/src/content-scripts/parsers/deepseek.ts) 还展示了 `chat_messages[].fragments[]` 中 `REQUEST`、`RESPONSE`、`THINK` 的拆分。

这些实现对“完整历史”有价值，但会读取登录 token 并调用未公开网页接口，与本项目当前 DOM-only 权限边界不同。它们只作为边界证据，不进入本 change。

### 2.4 AI Exporter：API 重试和 clipboard 降级

[AI Exporter](https://github.com/sisodiabhumca/ai-exporter) 的 [clipboard.js](https://github.com/sisodiabhumca/ai-exporter/blob/a1f1090c47da9f3ed938bcef1e8729796afc5a4d/extension/lib/clipboard.js) 先调用 `navigator.clipboard.writeText`，失败后用 textarea 与 `execCommand('copy')`。其 [api-deepseek.js](https://github.com/sisodiabhumca/ai-exporter/blob/a1f1090c47da9f3ed938bcef1e8729796afc5a4d/extension/lib/api-deepseek.js) 对 429 做有界退避。

对本 change 的启示是：最终“复制导出到用户剪贴板”仍需保留现有 fallback；但捕获站点原生 Copy 时不能先让真实写入发生再尝试恢复旧剪贴板，因为 clipboard read 权限和用户授权并不稳定。更安全的方式是在 patch 中截获并抑制系统写入。

### 2.5 OpenCLI：provider 适配必须独立维护并允许 selector 漂移

[OpenCLI 的豆包 browser adapter](https://github.com/partme-ai/opencli/blob/main/docs/adapters/browser/doubao.md) 把 `status`、`send`、`read`、`ask` 和历史能力作为站点专属 adapter 维护，并明确 `ask` 依赖 DOM polling。其当前实现与公开适配资料还提供了豆包新版消息容器线索，例如 `union_message`、`message-block-container` 和 `md-box-root`。

本项目据此不把豆包、Kimi、DeepSeek 或通义千问的消息/按钮 selector 放入 core；每个站点独立枚举 assistant turn、排除代码 Copy，并可单独回滚。DOM polling 只作为一种信号，不能在官网专属 Copy 已出现后继续无限等待。

## 3. DOM、Shadow DOM 与 iframe 边界

[Defuddle](https://github.com/kepano/defuddle/blob/197db78742ad0fb91100c2b478f5350ee9d8702c/src/defuddle.ts) 先克隆 document，再把 open Shadow DOM 展平；isolated world 不能直接读取时，需要 MAIN-world 脚本预先桥接内容。[SingleFile](https://github.com/gildas-lormeau/SingleFile) 则在 [manifest.json](https://github.com/gildas-lormeau/SingleFile/blob/517fb7c5cf2096d89933b747e862d8ecf616a9f9/manifest.json) 中以 `all_frames`、`document_start`、`match_about_blank` 和 MAIN world hook 覆盖 frame；[single-file-hooks-frames.js](https://github.com/gildas-lormeau/SingleFile/blob/517fb7c5cf2096d89933b747e862d8ecf616a9f9/lib/single-file-hooks-frames.js) 还会包装 `attachShadow` 保存 closed root 引用。

本项目已经在所有 provider frames 运行 isolated bridge，因此原生 Copy 请求必须停留在拥有目标按钮的同一 frame。顶层 workspace 不应跨 frame 直接查询按钮。若 Copy 按钮位于 closed Shadow DOM，只有在站点创建 root 前注入 hook 才能可靠访问；本 change 首期不为单个 Copy 功能引入完整 closed-shadow 捕获系统，缺失时回退 DOM partial。

## 4. Readability、Turndown 与选区复制

[Mozilla Readability](https://github.com/mozilla/readability) 官方建议把 `document.cloneNode(true)` 传给 parser，因为解析会修改 DOM。[Turndown](https://github.com/mixmark-io/turndown) 接受 DOM Node，并支持自定义 rule、GFM、代码 fence 和 keep/remove。[MarkDownload](https://github.com/deathau/markdownload/blob/7e8cc1a2156a5b413db133677641c3f8a23cd39d/src/contentScript/contentScript.js) 使用 `Range.cloneContents()` 获取用户选区。

这些组件适合处理已有 HTML 或选区，但都无法：

- 恢复虚拟列表中不存在的消息。
- 判断当前 assistant turn 是否结束。
- 选择正确的站点 Copy 按钮。
- 捕获站点在 Copy handler 内重新构造的 Markdown。

因此，Turndown 继续服务 DOM fallback；原生 Copy 成功时不再把站点 Markdown 反向解析成 HTML 后重新转换。

## 5. 风险结论

### 可接受风险

- selector drift 导致某 provider 暂时找不到 Copy 按钮：回退 DOM，不影响发送。
- 页面禁止替换 clipboard 方法：记录能力失败并回退。
- 站点只输出 `text/plain`：保留纯文本终态，同时继续保存 DOM Markdown 作为非权威格式候选。

### 必须阻止的风险

- patch 未恢复，影响用户后续复制。
- 捕获窗口内把用户手动复制误认为当前轮结果。
- 为了找到按钮滚动整页或点击全部历史按钮。
- Copy 失败后仍把只有标题的结果标为 completed。
- provider selector、按钮点击和站点规范化逻辑进入通用 core。
- 为解决虚拟历史而顺带读取 token 或调用私有 API。

## 6. 最终判断

原生 Copy 是“当前轮终态正文权威通道”，不是“全会话抓取器”。它必须依赖现有状态机先证明轮次归属和终态，再用站点自己的序列化结果替换该轮最终 payload。所有超出这一范围的历史恢复、API 导出、closed Shadow DOM 和批量滚动能力必须单独设计与授权。
