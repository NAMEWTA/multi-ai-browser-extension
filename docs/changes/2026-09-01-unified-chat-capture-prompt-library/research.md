# 调研记录

## 1. 仓库现状

### 1.1 统一对话

- `src/entrypoints/workspace/workspace-app.tsx:1314` 的 `SessionHistoryDetail` 一次渲染全部轮次和全部 Provider 回答。
- `src/entrypoints/workspace/workspace-app.tsx:1388` 使用 `<p>{exchange.responseText}</p>`，没有折叠状态、Markdown 解析或问题导航。
- `src/entrypoints/workspace/workspace.css:1101` 将弹窗限制为 `min(920px, 96vw)` 的单列布局，没有给右侧导航或窄屏降级预留结构。
- `src/db/session-service.ts:357` 返回的 `SessionDetail` 已按轮次和 Provider 顺序排序，`turn.id`、`sequence`、`prompt` 足以建立导航，不需要持久化 UI 展开状态。

### 1.2 Markdown 已在采集时丢失

- `src/core/providers/base-dom-strategy.ts:236` 的 `responseBaseline()` 只取回答元素的 `innerText/textContent`。
- `src/core/providers/contracts.ts:62` 的 `ResponseCaptureUpdate` 只有 `text`。
- `src/db/database.ts:47` 的 `ProviderExchangeRecord` 只有 `responseText`。
- `src/core/transcript/markdown-transcript.ts:173` 虽然生成 Markdown 文档外壳，但回答正文只是原样插入 `responseText`。

因此，仅引入 Markdown React 组件只能渲染偶然残留在纯文本中的 Markdown 标记，无法恢复官网已经渲染成 HTML 的语义结构。

### 1.3 千问超时的直接代码原因

当前通用采集循环位于 `src/core/providers/base-dom-strategy.ts:143`：

- 每 250 ms 全量重新查询一次回答列表，最长 180 秒。
- 新回答只通过 `count` 或最后一条文本变化判断。
- 结束只依赖 stop 控件消失和 1.8 秒文本静默。
- 选择器没有命中时，循环结束后只能返回 `timeout` 和“等待 AI 回复超时”。

`src/providers/qwen/selectors.ts:28` 当前仅配置：

```text
.assistant-response
[data-role='assistant'] .markdown-body
[data-role='assistant']
[class*='answer-content']
```

这些选择器未命中时，即使页面已经显示回答，采集器也始终看到 `count = 0`。这是示例中 `submitted + timeout + 未采集到回复内容` 的充分解释。

一个 2026-07 标记为已验证的第三方 Qwen adapter 使用了 `response-message-content.phase-answer`、`chat-response-message` 和 `stop-button` 等线索。它的目标域和本项目不完全相同，因此只能作为真实登录页检查时的候选，不能直接当成千问官网契约。

国内 `www.qianwen.com` 当前公开页面声明前端版本 `4.4.2`；对应的阿里 CDN bundle 可以确认另一组 DOM 语义：

```text
.chat-round[data-chat][data-chat-pos]          轮次
[data-chat-answers-wrap].chat-answers-card-wrap 回答容器
.answer-text.md-text-card                      正文卡
.qk-markdown                                   Markdown 渲染根
.answer-receiving-card                         等待/接收状态
```

这些线索同样与仓库现有四条回复 selector 没有交集。高置信结论是 selector/profile 失配；国内站与国际站必须分别维护 profile，不能用一组泛化 selector 互相兜底。

### 1.4 严重滚动更像聚焦副作用

`src/core/providers/submitters/button-submitter.ts:13` 在点击发送按钮前执行无参数 `element.focus()`。浏览器默认会把被聚焦元素滚入视口；代码没有使用 `preventScroll`。

仓库里没有业务代码调用 `scrollIntoView()`，Kimi 的独立策略反而已经在 `src/providers/kimi/strategy.ts:28` 使用 `focus({ preventScroll: true })`。因此“模块剧烈滑动”的首要假设应是通用发送按钮的聚焦副作用，而不是反机器人检测。两者不能在没有验证码、429、风险提示或服务端拒绝证据时混为一谈。

另一个独立问题是卡顿：`src/runtime/provider-status.ts:54` 观察整个 document 的子节点和属性变化，每次 mutation 都重新 probe。千问 probe 会枚举宽泛的 textarea/contenteditable 候选，并为每个候选重新全页查找发送按钮和计算树距离。流式输出会放大为高频全 DOM 扫描。它可能造成界面卡顿，但不会直接修改 `scrollTop`，不应被描述为“滑动验证”。

### 1.5 并发和 blocked 状态缺口

- commit 后的 capture 通过 `void captureResponse(...)` 脱离命令队列执行，没有 per-panel capture lease 或 AbortController。上一次采集未终止时可以开始下一轮，存在把新回答写进旧 Turn 的风险。
- SPA reload、pagehide 或新会话会让在途 capture 丢失，当前没有保证写入 terminal 状态。
- `ProbeStatus` 虽然有 `blocked`，但 `ProviderSelectors` 没有 blocked/CAPTCHA 契约，`BaseDomStrategy.probe()` 也不会检测验证码、滑块或风险遮罩。
- 当前 response diagnostic 只记 `stage/operation`，无法区分 selector miss、无 mutation、生成未结束或采集被页面替换中断。

### 1.6 现有测试缺口

- 千问单元测试主要覆盖 composer 候选排名，没有真实回答 DOM fixture。
- live smoke 只验证千问 composer 可发现和草稿隔离，没有提交后回答采集验收。
- 统一对话 E2E 直接断言正文可见，改为默认折叠后必须更新。
- 没有滚动前后位置、回答根节点重挂、流式 `characterData`、thinking 到 answer 阶段切换的测试。
- 现有 19 个 Base/Qwen 相关测试通过，只说明既有 mock 逻辑自洽；Qwen 测试完全没有真实回复结构、生成阶段或滚动用例，不能覆盖本次故障。

## 2. 稳定采集的成熟做法

没有一个可以长期免维护地抓取所有 AI 官网的通用库。AI 官网是独立 SPA，DOM、虚拟列表和生成状态都没有共同契约。成熟方案是小型通用内核加每站 adapter：

1. 站点 adapter 明确 composer、submit、conversation root、assistant turn、answer content、generating、blocked 等定位规则。
2. 定位优先稳定的 `data-*`、可访问名称、`role=log/feed/article`、消息作者语义；结构和 class 只作为后备。
3. 页面级观察器只发现 SPA 根节点替换；回答级观察器只监听最窄的当前 assistant turn，并开启 `childList + characterData + subtree`。
4. 观察回调只标记 dirty，经过 debounce 后读取，避免每次 token 变化都全页查询。
5. 完成状态融合 stop 控件、`aria-busy=false`、生成标记消失和文本静默；静默窗口只能作 fallback。
6. 达到绝对超时时保留最后一次有效快照并标记 `partial`，不能用空 timeout 覆盖已有正文。
7. 每次读取前检查 `isConnected`；SPA 替换节点后重新定位和绑定 observer。
8. 不依靠滚动加载历史。回复生成期间即时采集和持久化，虚拟列表卸载后仍可查看。
9. 每个面板只允许一个 active capture；新会话、导航、pagehide 或明确取消时 abort 旧任务并写入 terminal 状态。

### 内容格式

推荐从已确认的 answer content 根节点开始：

```text
clone DOM
  -> 移除 script/style/button/工具条/隐藏节点
  -> 生成 plainText
  -> HTML AST 转 Markdown
  -> 发送增量快照
  -> IndexedDB 同时保存 plainText 和 markdown
```

展示侧使用 `react-markdown + remark-gfm`。不启用 `rehype-raw`，链接采用安全协议白名单，远程图片默认降级为链接或禁用，避免跟踪像素。

HTML 转 Markdown 的候选有两类：

- Turndown：API 简单、可直接接 DOM node、易写站点规则，但需评估当前安全 issue、GFM 插件维护状态和大文本同步转换性能。
- unified 的 `rehype-parse -> rehype-remark -> remark-stringify`：依赖更多，但 AST 边界清晰、TypeScript/ESM 兼容和安全说明更完整。

本方案默认先对两条管线做同一组真实 DOM fixture spike；若体积和性能可接受，优先 unified AST 管线。无论采用哪条路线，都不能省略站点级清洗规则和输入大小上限。

## 3. 为什么不抓 Fetch/WebSocket

- Chrome content script 处于隔离世界，但和页面共享 DOM，适合在用户可见边界读取内容。
- `webRequest` 不能作为通用响应正文流读取器，也不拦截 WebSocket 消息正文。
- 注入 MAIN world、hook `fetch`/WebSocket 或使用 `chrome.debugger` 会明显增加权限、耦合和协议风险，也破坏当前“只操作可见 DOM、不读取私有接口”的产品边界。
- closed shadow root 普通脚本不可访问；遇到这种页面应明确标记不支持，而不是扩大权限绕过。

## 4. 自动化与千问服务协议

“减少不必要页面扰动”和“规避自动化检测”是两件事：

- 可以做：`focus({preventScroll:true})`、避免重复输入/点击、每面板仅一个在途任务、识别 429/验证码/风险提示后停止、尊重 `Retry-After`。
- 不做：隐藏 webdriver、修改 Canvas/WebGL/UA 指纹、随机鼠标轨迹、伪造可信输入、绕过验证码/滑块、导出 Cookie、挑战后循环重试。

DOM `dispatchEvent()` 和 `HTMLElement.click()` 产生的事件可通过只读 `Event.isTrusted` 与真实用户事件区分。项目不应把这个事实用于规避检测设计。

千问现行用户服务协议明确限制未经授权的第三方插件、自动化操作及通过自动化/网页分析工具接入或采集内容。因此，千问网页 adapter 的技术改进只有在获得明确授权后才应启用。合规替代是阿里云百炼官方 API；它提供 OpenAI 兼容接口、DashScope SDK 和正式流式响应。

## 5. 主要来源

- [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome SPA 与 MutationObserver 示例](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab)
- [MDN MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- [MDN focus() 与 preventScroll](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus)
- [MDN Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)
- [WAI-ARIA log role](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23)
- [WAI-ARIA 1.2 aria-busy](https://www.w3.org/TR/wai-aria-1.2/)
- [Playwright locator 建议](https://playwright.dev/docs/locators)
- [react-markdown 安全说明](https://github.com/remarkjs/react-markdown)
- [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)
- [rehype-remark](https://github.com/rehypejs/rehype-remark)
- [Turndown](https://github.com/mixmark-io/turndown)
- [千问用户服务协议](https://terms.alicdn.com/legal-agreement/terms/c_end_product_protocol/20231011201348415/20231011201348415.html)
- [阿里云百炼首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)
- [阿里云百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [第三方 Qwen adapter 选择器线索](https://raw.githubusercontent.com/Naim-Bijapure/ai-council/master/config/selectors/qwen.json)
- [千问国内站 4.4.2 前端 bundle](https://g.alicdn.com/code/npm/@ali/qianwen-web/4.4.2/web/js/async/7193.js)
