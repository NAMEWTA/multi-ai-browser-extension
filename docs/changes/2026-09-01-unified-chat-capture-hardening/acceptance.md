# 统一对话与回复采集加固验收

日期：2026-09-01

## 1. 验收原则

- 本矩阵只覆盖本次计划实施的功能，不把后续采集架构或 API 接入列为完成条件。
- DOM 采集测试使用脱敏 fixture 或已获授权环境。
- 任一合规否决项命中即验收失败。

## 2. 可执行验收矩阵

| ID        | 场景                   | 操作                                               | 预期结果                                                             | 验证方式              |
| --------- | ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| UI-01     | 打开多轮统一对话       | 打开包含多轮、多 AI 回答的详情                     | 所有 AI 回答均折叠；内容定位最后一轮；最后一轮导航项为当前项         | Component/E2E         |
| UI-02     | 最后一轮保持折叠       | 首次打开详情并观察最后一轮                         | 最后一轮没有因定位或激活而展开                                       | Component/E2E         |
| UI-03     | 手动展开和收起         | 点击任意 AI 回答标题两次                           | 仅目标回答展开后再收起，其他回答状态不受影响                         | Component test        |
| UI-04     | Markdown 展示          | 展示标题、列表、引用、表格、链接、行内代码和代码块 | 结构清晰，长内容不撑破容器，旧纯文本记录仍可读                       | Component test + 截图 |
| UI-05     | Markdown 安全          | 渲染 raw HTML、事件属性和危险协议链接              | 不执行脚本或事件，危险链接不生效                                     | 安全单测              |
| NAV-01    | 问题导航定位           | 点击中间一轮的用户问题                             | 内容定位到对应轮次，当前项唯一，回答仍保持原折叠状态                 | E2E                   |
| NAV-02    | 窄屏导航               | 在窄屏打开详情并使用问题导航                       | 导航不遮挡正文，可定位任意轮次                                       | 响应式 E2E            |
| PROMPT-01 | Prompt selector 空状态 | 在没有提示词时打开选择器                           | 空状态位于正确弹层层级，不被输入框或其他控件遮挡                     | Component/E2E         |
| PROMPT-02 | 空状态点击穿透         | 点击空状态主体及维护入口                           | 主体点击不触发下方输入框/发送控件；维护入口正常响应                  | Component/E2E         |
| PROMPT-03 | 空状态键盘访问         | 使用 Tab 和 Enter 操作维护入口                     | 焦点可见，入口可触发，不跳到下层控件                                 | 键盘测试              |
| CAP-01    | Baseline entries 建立  | 在提交前提供多个已有回答节点                       | 基线按稳定顺序保存条目，而不是只保存数量或末条文本                   | 单元测试              |
| CAP-02    | 同数量内容更新         | 保持节点数量不变并更新目标回答内容                 | 能根据 baseline entries 识别候选变化并采到新内容                     | Fixture test          |
| CAP-03    | 新稳定 Turn            | 在基线后追加一个匹配 stable turn 的回答            | 只采集新增候选，不回收提交前已有回答                                 | Fixture test          |
| CAP-04    | Content 定位           | stable turn 内同时存在正文和工具控件               | 仅按 content 规则读取回答正文                                        | Fixture test          |
| CAP-05    | Exclude 规则           | 回答容器内加入应排除节点或隐藏副本                 | 排除内容不进入最终采集文本                                           | Fixture test          |
| CAP-06    | Generating 状态        | 分别提供生成中和生成结束 fixture                   | generating 规则能正确区分两种状态                                    | Fixture test          |
| CAP-07    | 先回答后 blocked       | 同一 fixture 同时含有效候选回答和 blocked 标记     | 优先返回已采集回答，不被 blocked 结果覆盖                            | 单元/Fixture test     |
| CAP-08    | 仅 blocked             | fixture 没有有效候选回答但命中 `findBlocked`       | 返回现有 blocked 状态，且不尝试自动处理挑战                          | 单元/Fixture test     |
| CAP-09    | 普通 timeout 回归      | fixture 既无新回答也不 blocked                     | 保持现有 timeout 行为，不误报成功或 blocked                          | 单元测试              |
| REG-01    | 现有站点回归           | 运行 provider 和 base DOM strategy 相关测试        | 原有支持站点的提交与采集测试继续通过                                 | Test suite            |
| REG-02    | 构建检查               | 运行类型检查和扩展构建                             | 命令成功，无新增类型或打包错误                                       | CI/本地命令           |
| COMP-01   | 合规代码审查           | 检查本次依赖、权限和实现                           | 不存在验证码识别/代答、滑块模拟、指纹伪装、Cookie 复用或私有接口逆向 | 代码审查              |

## 3. 不属于本次验收

- 新的 `CapturedResponse` 或 reasoning/answer 数据库模型。
- capture lease、双 observer、完整状态机、细粒度诊断码。
- 千问官方 API。它是后续建议，不是本次交付项。
- 全站点真实账号自动化压测。

## 4. 回归命令

以仓库实际脚本名称为准，至少执行：

```text
targeted provider tests
targeted workspace component/E2E tests
typecheck
extension build
```

无法自动化的视觉项应记录视口、浏览器版本和截图。

## 5. 合规否决项

出现以下任一情况即验收失败，不得发布：

- 自动识别、代答或绕过验证码/滑块。
- 使用随机鼠标轨迹、随机延迟、伪造事件可信度或设备指纹规避检测。
- 遇到验证码或风险页后继续自动点击、拖动、输入或循环重试。
- 导出、共享或复用站点 Cookie 以绕过正常登录或风险控制。
- 未经授权 hook 页面私有网络协议或调用非公开接口。

依据：

- [通义千问服务协议](https://terms.alicdn.com/legal-agreement/terms/c_end_product_protocol/20231011201348415/20231011201348415.html)
- [通义千问隐私政策](https://terms.alicdn.com/legal-agreement/terms/privacy_policy_full/20231011201849846/20231011201849846.html)
- [阿里云 CAPTCHA 产品概览](https://help.aliyun.com/en/captcha/captcha1-0/product-overview/what-is-captcha)
- [阿里云 CAPTCHA 2.0 客户端 FAQ](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/captcha-2-0-client-access-faq)
