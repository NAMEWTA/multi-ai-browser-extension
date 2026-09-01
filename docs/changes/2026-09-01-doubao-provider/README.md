# 豆包 Provider 接入

## 目标

将豆包官方网页 `https://www.doubao.com/chat/` 作为第八个预配置站点接入工作台。豆包默认关闭，用户可在“管理站点”中启用；启用后参与统一发送、回复采集、会话恢复和新任务操作。

## 实现

- 注册 `doubao` provider ID、官方域名匹配和 Manifest host permission。
- 使用官网当前 TipTap/ProseMirror 编辑器的语义属性定位输入框，并通过浏览器编辑事务写入，保持网页内部编辑器状态同步。
- 优先使用固定发送按钮 ID `flow-end-msg-send`，并校验 `aria-disabled` 与 `data-disabled`。
- 适配豆包侧栏中由可点击 `div` 承载的“新对话”入口。
- 回复采集优先识别带消息 ID 的 Markdown 回答块，并保留纯文本和 Markdown 两种快照。
- 检测登录入口、验证码/验证容器及生成中停止按钮，不执行验证码绕过或反检测操作。

## 调研依据

2026-09-01 使用真实 Chromium 加载官方聊天页，确认：

- 页面入口为 [豆包网页版](https://www.doubao.com/chat/)；
- 输入面使用 `contenteditable="true"`、`role="textbox"` 的 TipTap/ProseMirror；
- 写入后固定发送按钮 `#flow-end-msg-send` 从禁用切换为可用；
- 未登录页面同时显示登录按钮和可用输入框，因此状态探测必须优先判断输入框；
- “新对话”由带 `cursor-pointer` 的非按钮侧栏节点承载。

产品身份和 AI 对话能力由豆包官方的[功能介绍](https://www.doubao.com/legal/feature_intro)与[算法及模型备案说明](https://www.doubao.com/legal/instructions)确认。网页 DOM 不是公开稳定接口，因此选择器采用语义属性优先、多层兜底，并由 provider contract、策略单元测试和扩展 E2E 覆盖。

## 验收

- 站点管理器显示 8 个预配置站点并可打开豆包。
- 豆包面板使用 `https://www.doubao.com/chat/`，能够完成输入暂存、提交和新对话动作。
- Mock 回复能够采集为文本与 Markdown，生成结束后落入统一会话。
- 生产构建包含豆包 host permission 与 content script match。
