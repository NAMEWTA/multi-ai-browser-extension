# 统一对话与回复采集加固实施计划

日期：2026-09-01

## 1. 目标

本次变更按现有架构完成三组有限改进：

1. 让统一对话中的 AI 回答默认折叠、支持 Markdown 展示，并可按用户问题快速定位。
2. 修复 prompt selector 空状态的层叠和点击穿透。
3. 加固现有 DOM 采集基线和站点选择器，减少千问等站点已出现回答却最终 timeout 的情况。

本次不是采集内核重写，也不新增验证码绕过、反检测或千问 API 接入。

## 2. 本次范围

### 2.1 统一对话详情

- 每个 AI 回答都是可独立展开/收起的面板。
- 每次打开详情时，所有 AI 回答初始均为折叠状态。
- 打开详情后仅滚动或定位到最后一轮，并在问题导航中激活最后一轮；不得自动展开该轮回答。
- 回答正文使用安全的 Markdown 渲染，旧纯文本记录继续可读。
- 桌面端提供右侧用户问题导航；窄屏提供不遮挡正文的降级入口。
- 点击问题导航只改变定位和当前项，不隐式展开回答。

### 2.2 Prompt selector 空状态

- 空状态复用现有选择器弹层的定位和层级。
- 修复空状态落到对话框下层、被其他元素遮挡或点击穿透的问题。
- 空状态中的维护入口保持可点击和可键盘操作。
- 不在本次新增提示词数据模型或扩展 CRUD 范围。

### 2.3 DOM 采集加固

- 将 response baseline 从脆弱的数量/末条比较调整为有顺序的 baseline entries。
- 使用 baseline entries 区分提交前已有回答和提交后新增或更新的候选回答。
- 在每轮等待中先采集候选回答内容，再判断页面是否 blocked；有效回答不能被同时存在的 blocked 文案抢先覆盖。
- 为目标站点补充或修正 stable turn、content、exclude、generating 和 `findBlocked` 规则。
- 使用脱敏 DOM fixture 覆盖正常回答、生成中、排除节点和 blocked 页面。
- 保持现有持久化记录和对外状态契约，不在本次引入新的 capture 数据模型。

### 2.4 合规边界

- 检测到验证码、滑块或风险提示时，不自动操作挑战。
- 不实现随机真人轨迹、事件可信度伪造、WebDriver/设备指纹隐藏、Cookie 复用或私有接口逆向。
- 千问官方 API 作为后续建议，不在本次实现和验收范围。

## 3. 明确不做

- `CapturedResponse`、reasoning/answer 新持久化字段或数据库迁移。
- capture lease、AbortController 并发模型或完整采集状态机重构。
- root observer + active-turn observer 双观察器架构。
- 新的细粒度诊断码体系。
- 站点 feature flag 或发布平台改造。
- 千问或其他模型的官方 API 接入。
- hook `fetch`、SSE、WebSocket，使用 `chrome.debugger`，或逆向网页私有协议。
- 验证码识别、滑块模拟或任何规避反机器人检测的能力。

## 4. 实施步骤

### 阶段一：统一对话 UI

1. 为 AI 回答标题增加折叠控制和可访问状态。
2. 初始化时把所有回答设为折叠，只计算最后一轮的定位和导航当前态。
3. 接入现有选定的 Markdown 渲染链路，禁用未清洗 raw HTML，并处理代码、表格、列表、引用和链接。
4. 建立基于稳定 Turn ID 的问题导航；桌面使用右侧栏，窄屏使用紧凑入口。
5. 补充展开、导航和 Markdown 的组件/E2E 测试。

### 阶段二：Prompt selector 空状态

1. 复现无提示词时弹层被遮挡或事件穿透的场景。
2. 统一空状态与普通列表的弹层容器、层叠上下文和 pointer-event 行为。
3. 验证鼠标、键盘和不同视口下的空状态交互。

### 阶段三：现有采集策略加固

1. 在现有 baseline 结构中记录有序 entries，并以其识别提交后的候选回答。
2. 调整轮询判定顺序：先读取候选回答，再调用 `findBlocked`。
3. 按站点补充 stable turn、content、exclude、generating 和 blocked 规则，不引入通用大重构。
4. 为目标站点创建脱敏 fixture，覆盖同数量内容更新、新增回答、应排除节点、生成状态和 blocked 状态。
5. 运行相关单元测试、类型检查和构建。

## 5. 验证与回退

- 验收以 [acceptance.md](./acceptance.md) 的本次可执行矩阵为准。
- 选择器失效时保留现有 timeout/error 行为，不扩大到全页高频扫描。
- 新 baseline entries 只服务现有采集判断，不改变数据库 schema。
- UI 回退不影响历史对话数据；旧纯文本回答仍可显示。

## 6. 完成定义

以下条件全部满足才算完成：

- 所有 AI 回答首次打开均折叠，最后一轮只被定位和激活。
- Markdown 和问题导航通过本次 UI 验收。
- Prompt selector 空状态不被遮挡且不发生点击穿透。
- baseline entries、先采回答后判断 blocked、站点 stable turn/content/exclude/generating/`findBlocked` 均有 fixture 测试并通过。
- 类型检查、相关测试和构建通过。
- 代码中没有新增验证码绕过、自动挑战操作或反检测规避能力。
