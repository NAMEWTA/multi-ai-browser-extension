# v0.0.2 原生 Copy 终态持久化

日期：2026-09-01

## 目标

将统一会话的回复正文采集改为单一、可验证的链路：

```text
发送前记录 Provider Copy 目标基线
  -> 官网生成回复
  -> Provider 确认本轮助手消息已终态稳定
  -> 点击该消息自己的原生 Copy 按钮一次
  -> 在页面 MAIN world 捕获官网写入的完整内容
  -> 校验来源、归属和完整性
  -> 只持久化最终结果
  -> 会话详情、末轮复制和完整导出读取已持久化正文
```

不再把 DOM 流式片段写入统一会话，也不再在原生 Copy 失败后把可见 DOM 片段标记为部分成功。DOM 仅用于定位、终态判定和完整性校验，不是回复正文来源。

## 范围

- 默认打开并选中 DeepSeek、豆包、通义千问。
- DeepSeek、豆包、Kimi、通义千问继续使用 Provider 内原生 Copy 适配器。
- ChatGPT、Claude、Coze、MiniMax 新增各自的 `native-copy.ts` 和脱敏 DOM 测试。
- 原生剪贴板桥收集同一次点击产生的候选写入，短暂静默后选择信息最完整的 payload。
- 统一会话只接收 waiting 和 terminal 两类持久化更新。
- 正文更新必须声明 `captureSource: "native-copy"` 和 `nativeMimeType`。
- 发布正式版 `v0.0.2`，不是 prerelease。

## 非目标

- 不批量点击历史消息的 Copy 按钮。
- 不滚动或展开官网历史记录。
- 不读取 Cookie、Token、官网私有 API 或用户原剪贴板。
- 不承诺在没有已登录真实账号时完成八站在线 smoke。
- 不修改统一会话 Markdown/复制/导出的业务格式；它们继续消费数据库正文。

## 文档

- [research.md](./research.md)：GitHub 调研和实现结论。
- [design.md](./design.md)：架构、状态机、不变量和失败语义。
- [implementation-plan.md](./implementation-plan.md)：分阶段实施计划。
- [acceptance.md](./acceptance.md)：自动化与真实站点验收矩阵。
- [execution.md](./execution.md)：执行记录和发布证据。
