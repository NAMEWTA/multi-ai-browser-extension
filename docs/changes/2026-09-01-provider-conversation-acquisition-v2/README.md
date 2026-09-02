# Provider Conversation Acquisition V2

状态：实现完成，自动化验证进行中，真实站点 smoke 待登录态执行

日期：2026-09-01

## 目标

彻底替换“从当前页面任意可见文本猜回复”的采集假设。每个 provider 现在共享同一个采集协议，但在自己的 `src/providers/<provider>/` 目录维护站点解析与定位规则。

优先级固定为：

1. 已验证的同源会话接口快照；
2. 当前新回复所属的官网原生 Copy；
3. Copy 所属回复容器或已确认终态的当前轮 DOM。

不同来源之间禁止拼接。某一来源无法证明完整时，整个候选被拒绝并进入下一策略，不能把标题、状态文字或上一轮回复补进当前结果。

## 已实现

- Canonical `ConversationSnapshot`、消息/内容块、完整性证据和诊断契约。
- 策略优先级引擎与质量闸门，拒绝空正文、标题复读、状态文字、未耗尽游标和断裂分支。
- `document_start + MAIN world` 的同源请求观察桥，只允许明确 provider endpoint，不向 isolated world 暴露请求头和敏感查询参数。
- DeepSeek、豆包、千问、Kimi、ChatGPT、Claude 的会话 API parser/runtime adapter。
- Coze、MiniMax 以及 API 不可用时统一使用当前轮原生 Copy，再回退当前回复作用域 DOM。
- 发送前网络时间边界，拒绝旧 observation，防止重复问题拿到上一轮回答。
- 完整会话快照按稳定 provider message ID 原子持久化；当前轮选中消息单独标记。
- 会话删除同步清理 acquisition 快照；历史导入兼容全部 V2 capture source。

## 明确限制

- `CustomEvent` 是页面主世界与扩展 isolated world 的通信通道，不是保密或认证边界。随机 token 只用于请求关联。
- 私有请求头只保留在 MAIN world 闭包中用于同源 replay；不会写数据库、日志或事件 descriptor。
- Provider 接口变化或无法证明完整时会回退 Copy/DOM，而不是把未知快照标记为完整。
- 自动化 fixture 不等于真实账号 smoke；发布前仍需在当前官网版本逐站验证。

## 文档

- [research.md](./research.md)：开源实现证据与技术结论。
- [design.md](./design.md)：架构、不变量、安全边界和 provider 矩阵。
- [implementation-result.md](./implementation-result.md)：代码落点与验证结果。
- [acceptance.md](./acceptance.md)：真实站点与回归验收清单。
