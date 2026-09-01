# 统一对话与回复采集加固调研

日期：2026-09-01

## 1. 结论摘要

本次变更采用以下方向：

1. 统一对话详情使用可折叠的回答面板。进入详情时所有 AI 回答均保持折叠，仅定位到最后一轮并把它标记为右侧导航当前项。
2. 回答正文按 Markdown 渲染，但必须经过安全边界控制，不直接执行采集到的 HTML。
3. 本次回复采集加固采用 baseline entries 保存基线条目，并在站点配置中补充 stable turn、content、exclude、generating 和 `findBlocked` 定位能力。
4. 每轮采集先尝试读取有效回答，再判断 blocked，避免页面中的阻塞提示抢先遮蔽已经存在的回答。
5. 推理与最终答案分离、双 observer、完整状态模型等属于调研得到的后续方向，不属于本次完成定义。
6. 千问网页版存在明确的服务协议和风控边界。本项目不实现验证码绕过、自动挑战处理、指纹伪装或其他规避检测能力；官方 API 仅作为后续集成建议。

## 2. 长对话导航

### 2.1 模式选择

[Ant Design Anchor](https://ant.design/components/anchor/) 明确用于展示页内锚点并在内容区域之间跳转，支持固定定位、指定滚动容器、偏移量、嵌套条目和当前锚点计算。它与“按用户问题导航到对应轮次”的需求最接近。

[Material Design Navigation Rail](https://m2.material.io/components/navigation-rail) 面向平板和桌面端的少量顶级目的地，不适合小屏、单任务或大量次级条目。因此，问题列表不应被实现成产品主导航，而应是当前会话的页内目录。

[Carbon UI shell left panel](https://carbondesignsystem.com/components/UI-shell-left-panel/usage/) 同样把 Side Nav 定义为产品层级的次级导航；会话问题导航应保持在详情页上下文内，不进入全局 UI Shell。

[Radix Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu) 是网站导航和子菜单 primitive。简单页内跳转优先使用原生 `nav`、有序列表和锚点，不引入 `menu`/`menubar` 语义。

### 2.2 推荐实现

- 桌面端使用右侧 sticky `aside`，内部为 `nav aria-label="问题导航"`。
- 导航项按轮次稳定排序，显示轮次号和最多两行的问题摘要；完整问题保留在可访问名称或提示中。
- 导航目标使用稳定的轮次 ID，不使用数组下标作为持久身份。
- 首次打开详情时所有 AI 回答保持折叠；内容区域定位最后一轮，导航中的最后一项为当前项，但不得因此展开回答。
- 当前项使用 `aria-current="location"`，并使用形状、字重等非纯颜色提示。
- 窄屏隐藏右侧栏，改为紧凑的可展开问题目录。
- 导航条目很多时可以只虚拟化导航列表；正文虚拟化会影响锚点测量、浏览器查找和无障碍浏览，不纳入本次默认方案。

[W3C Navigation Landmark 示例](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html) 要求多个导航区域具有可区分的标签。[W3C ARIA26](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA26) 和 [MDN aria-current](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current) 支持用 `aria-current` 表达当前项目；页内位置使用 `location` 值。

Scrollspy 使用一个 [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)，其 `root` 指向实际的详情滚动容器，并通过 `rootMargin` 扣除 sticky header。点击项目时使用 [`scrollIntoView`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView) 和 `scroll-margin-top`。若跳转后需要聚焦标题，应使用 `focus({ preventScroll: true })`，避免浏览器因聚焦发生第二次滚动；聚焦的默认滚动行为见 [HTML 标准](https://html.spec.whatwg.org/multipage/interaction.html)。

## 3. Markdown 展示边界

回答展示应优先使用保存的 Markdown；旧记录只有纯文本时，按纯文本 Markdown 输入渲染。渲染层必须满足：

- 不启用未经清洗的原始 HTML。
- 链接协议使用白名单，外链采用安全的打开策略。
- 远程图片默认禁用或降级为链接，避免第三方跟踪请求。
- 代码块、表格、列表、引用、标题和行内代码具有稳定样式。
- 超长代码、长单词和表格不撑破回答容器。

[react-markdown](https://github.com/remarkjs/react-markdown) 的默认组件模型适合把 Markdown 转为 React 元素；需要处理 HTML 时，应先使用 [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) 建立明确 schema。采集侧若需要从语义 HTML 生成 Markdown，可评估 [Turndown](https://github.com/mixmark-io/turndown) 或 unified AST 管线，但必须补充站点清洗规则和输入长度上限。

## 4. Prompt selector 空状态层叠

提示词选择器在没有模板时仍然是一个独立的弹出层。空状态不能退回到对话输入框的层叠上下文，也不能让点击事件穿透到下方输入框、发送按钮或其他控件。

本次修复遵循以下边界：

- 空状态与非空列表共用同一个弹层容器、定位规则和 `z-index`。
- 弹层本身接收 pointer events；仅纯装饰元素可以使用 `pointer-events: none`。
- 点击空状态区域不会聚焦、输入或触发下方对话控件。
- 空状态文案和维护提示词的入口保持可点击、可键盘访问。
- 本项只修复已有 prompt selector 的层叠和点击穿透，不扩展提示词 CRUD 或数据模型。

## 5. SPA 流式回复采集

### 5.1 平台事实

[Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) 运行在 isolated world：扩展可以读取页面 DOM，但不能把页面内部 JavaScript 状态当作稳定接口。Chrome 的 [SPA MutationObserver 教程](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab) 建议观察动态页面，同时只监控相关区域以控制性能。

[MutationObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe) 区分 `childList` 和 `characterData`。流式框架可能直接更新 Text node，因此只监听子节点增删会漏采，当前回答观察器必须覆盖 `characterData: true`。

SPA 重渲染可能整体替换回答节点。读取缓存节点前应检查 [`Node.isConnected`](https://developer.mozilla.org/en-US/docs/Web/API/Node/isConnected)，失联后根据轮次上下文重新寻址。路由变化还可以参考 [`webNavigation.onHistoryStateUpdated`](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) 触发重绑。

### 5.2 本次实现边界

本次不重写采集架构，只对现有 DOM 策略和站点配置做可验证的小步加固：

1. 基线由简单数量/末条文本升级为有顺序的 baseline entries，使同数量节点更新和新条目识别有稳定参照。
2. 采集轮询先从当前条目中提取有效回答；只有没有可采回答时，再执行 `findBlocked`。这保证 blocked 提示与有效回答同时存在时优先保留回答。
3. 站点配置补充或修正 stable turn、content、exclude、generating 和 blocked 定位规则，减少工具栏、推理容器、隐藏副本或加载态被误当作最终正文。
4. 使用脱敏 DOM fixture 覆盖上述选择器组合和判定顺序。

以下 Adapter 扩展、双层 observer、完整状态机和新持久化模型是调研形成的后续方案，不计入本次实施或验收。

### 5.3 后续 Adapter 契约方向

每个站点维护版本化 Adapter，至少声明：

- 会话根节点和消息列表。
- 用户轮、助手轮及二者的相对关系。
- 最终答案区域和可选的推理区域。
- 生成中、生成完成、停止按钮等状态信号。
- 登录、验证码、429 和风险提示等阻塞信号。

定位规则的优先级为：显式 `data-*` 或站点稳定契约、ARIA role/label、用户轮相对结构、保守的站点专属回退。避免 hashed class、`nth-child`、完整文本匹配和深层 CSS/XPath 链。[Playwright Locator](https://playwright.dev/docs/locators) 对用户可见属性和显式测试契约的优先建议可作为选择器稳定性原则。

聊天消息若具有 [`role="log"`](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23) 或 [`aria-busy`](https://www.w3.org/TR/wai-aria-1.2/) 等语义，可以作为定位或生成状态的证据，但不能假设所有站点均正确实现。

### 5.4 后续观察和归属方向

后续若进行采集内核重构，可采用双层观察：

1. Root observer 在尽可能窄的祖先上检测会话根替换和路由后的重挂载。
2. Active-turn observer 仅观察当前助手轮，使用 `childList + characterData + subtree`；属性监听限于 Adapter 确认过的状态属性。

发送前记录已有助手轮身份、用户问题指纹和提交时间；发送后选择“匹配用户轮之后新增的助手轮”。不得用全局最后一个助手节点作为唯一归属依据，否则并发生成、重试和旧 capture 尚未结束时会串写轮次。

Mutation callback 只负责标记 dirty，并在 microtask 或短 debounce 后读取一次规范化根节点。维护最后快照与哈希：

- 新快照以前一版为前缀时，可记录增量。
- Markdown hydration 或框架重写使其不再为前缀时，以新快照全量替换，不盲目追加。
- 每次得到非空快照都持久化为 partial，防止超时后丢失已生成内容。

### 5.5 后续状态机与完成判定

推荐状态机：

```text
submitted -> waiting_turn -> streaming -> final
                                  |       -> error
                                  -> partial
```

完成判定按可信度融合：站点完成标记、停止按钮消失或发送按钮恢复、`aria-busy=false`、加载指示器消失。仅在存在非空内容且生成 UI 已消失时，才允许把 1 至 2 秒无变化窗口作为兜底。绝对超时只负责终止等待：若已有内容，结果必须是 `partial` 并保留正文；没有内容时才是空 timeout。

可见性只用于排除隐藏副本、工具栏或重复响应，不作为回答完成条件。回复即使在 viewport 外仍然有效；不得为了采集持续滚动整页。虚拟列表中的旧消息应在生成时就完成持久化。

### 5.6 后续推理与最终答案

千问官方流式文档把 `delta.reasoning_content` 与 `delta.content` 分开累计，并在最终内容出现后切换阶段：[Qwen 流式输出](https://help.aliyun.com/en/model-studio/stream)。[Qwen 深度思考](https://help.aliyun.com/en/model-studio/deep-thinking) 和 [Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses) 同样区分推理与最终内容。

内部结果应建模为：

```text
reasoningText?: string
answerText: string
markdown?: string
phase: waiting | reasoning | answering | final | partial | error
```

Adapter 分别定位 thinking 和 answer 区域。最终答案区域出现后，不得把推理文本拼进最终答案。无法可靠区分时，保留最终可见答案并将 `reasoningText` 留空，不根据 DOM 顺序猜测。

## 6. 千问与验证码合规边界

[通义千问服务协议](https://terms.alicdn.com/legal-agreement/terms/c_end_product_protocol/20231011201348415/20231011201348415.html) 对未经授权的第三方插件、自动化操作、自动网页分析和绕过保护措施存在明确限制。因此：

- 本项目不实现验证码或滑块绕过。
- 不模拟真人鼠标轨迹或随机交互来规避检测。
- 不隐藏 WebDriver，不伪造 Canvas、WebGL、UA 或其他设备指纹。
- 不使用 CDP 构造“可信”输入，不导出或复用 Cookie。
- 不在出现验证码、风险页、登录阻塞或 429 后循环重试。
- 不逆向或调用网页的非公开私有接口。

[千问隐私政策](https://terms.alicdn.com/legal-agreement/terms/privacy_policy_full/20231011201849846/20231011201849846.html) 表明风险判断可能组合设备、日志、网络和 Cookie 等信息，因此不能在缺乏证据时断言“滚动本身触发验证码”。[阿里云 CAPTCHA 产品概览](https://help.aliyun.com/en/captcha/captcha1-0/product-overview/what-is-captcha) 也说明风险识别包含行为、设备和网络等多维信号。[CAPTCHA 客户端 FAQ](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/captcha-2-0-client-access-faq) 明确不建议用模拟点击触发验证，因为某些场景会将其识别为自动化工具。

合规处理方式是：检测到挑战后停止该站点任务，不自动处理挑战或继续循环操作，并等待用户在网页中自行处理。后续可以评估 [阿里云百炼官方 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)；其 [OpenAI-compatible Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) 支持 `stream=true`。API 接入不是本次实施或验收范围。

未找到千问官方发布的网页 DOM selector 契约。网页 DOM 应视为可能随版本变化的实现细节；在没有明确授权时，不对千问网页 Adapter 作规避风控式加固。

## 7. 不采用的方案

- 一个跨所有 AI 网站的万能 CSS selector。
- 用全局“最后一个回答”归属当前请求。
- 每 250 ms 全页扫描所有消息节点。
- 只靠固定静默时间判断完成。
- 超时后丢弃已采集的非空内容。
- 把推理过程和最终答案合并为一段。
- 注入页面主世界以 hook `fetch`/WebSocket，或使用 `chrome.debugger` 读取私有流量。
- 自动操作验证码或实现任何反检测、绕过能力。
