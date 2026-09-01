# 实施计划

日期：2026-09-01

## 阶段 A：契约和运行时

1. 为 `NativeCopyCapturePolicy` 增加终态稳定窗口。
2. 将 MAIN bridge 从“首笔写入立即完成”改为“同一点击候选聚合后完成”。
3. 增加多笔写入、最长 payload、清理和超时测试。
4. 收紧响应消息 schema：携带正文时必须是 terminal + `native-copy` + MIME。

## 阶段 B：采集状态机

1. 将 `BaseDomStrategy.captureResponse` 改成 Copy-only 终态状态机。
2. 移除 DOM streaming 正文回调、DOM completed/partial fallback。
3. `finalizeResponse` 只允许捕获已确认终态的 native target。
4. Provider bridge 只上报 waiting 和 final。
5. 更新 reducer 测试，证明 terminal 正文不会被旧 revision 覆盖。

## 阶段 C：Provider 适配

1. 修正豆包虚拟列表 turn 根、action bar 和生成状态。
2. 复核 DeepSeek、Kimi、通义千问的 prompt 关联、代码 Copy 排除与稳定窗口。
3. 为 ChatGPT 新增 conversation-turn + `copy-turn-action-button` 适配。
4. 为 Claude 新增 assistant/action group 适配。
5. 为 Coze 新增 message assistant/action toolbar 适配。
6. 为 MiniMax 新增 assistant turn/action toolbar 适配。
7. 八个 Provider 都用脱敏 fixture 验证：本轮、历史轮、用户 Copy、代码 Copy、隐藏副本和 disabled 状态。

## 阶段 D：默认工作区与数据消费

1. 默认面板改为 DeepSeek、豆包、通义千问并全部选中。
2. 实现旧默认布局的一次性 v3 -> v4 迁移，自定义布局不变。
3. 验证会话详情、末轮复制、完整复制和 Markdown 导出只使用数据库正文。

## 阶段 E：验证与发布

1. 运行目标单测和 Provider contract 测试。
2. 运行 `pnpm check`。
3. 运行 `pnpm test:coverage` 并满足阈值。
4. 运行 `pnpm build` 和 `pnpm e2e`。
5. 将 package/WXT 版本升级到 `0.0.2`。
6. 生成 Chrome zip、SHA256SUMS 和安装脚本。
7. 提交并推送 main，创建稳定版 `v0.0.2` GitHub Release。
