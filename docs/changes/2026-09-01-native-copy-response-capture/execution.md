# Copy-first v2 执行记录

日期：2026-09-01

## 已解决的故障

1. 原生 Copy 过去只能在正文 DOM snapshot 已成功后执行，因此正文 selector 漂移时无法自救。
2. Kimi 历史回复中的算力提示等临时文字消失后，旧稳定消息可能被误判为当前轮，导致下一轮重复上一轮回答。
3. 豆包已经显示完整回复和 Copy 按钮时，DOM 终态信号仍可能缺失，状态持续显示“等待回复”。
4. 原生 Copy 的 250ms 双观察检查会被 DOM 的 6-12 秒静默检查覆盖，导致按钮已就绪仍延迟或等待。

## 实现结果

- `ResponseBaseline` 保存提交前的正文节点身份、稳定 turn key 和原生 Copy 目标。
- `NativeCopyAdapter` 可实现 `listTargets`、`selectTarget`、`isTerminalTarget` 与有限重试策略。
- core 只接受 baseline 后的新目标；同一稳定 ID 的历史节点即使文字变化也不会成为当前回复。
- 虚拟列表复用节点时，稳定 ID 已变化可视为新回复；无稳定 ID 的节点仍按节点身份保守排除。
- Copy 目标连续两次稳定、无生成中信号后直接捕获；不要求正文 selector 命中。
- 捕获最多重试三次，抑制真实系统剪贴板写入，并把站点 Markdown 作为终态正文。
- Copy 已证明终态但捕获失败时，有 DOM 正文返回 `partial`，无正文返回 `failed`，不再保持 `waiting`。
- prompt 从 provider bridge 传到 adapter，仅用于多个新目标之间的就近归属，不记录到诊断。

## Provider 落地

| Provider | 目标身份                | Copy 归属                                 | 终态信号                     |
| -------- | ----------------------- | ----------------------------------------- | ---------------------------- |
| DeepSeek | virtual/message ID      | assistant turn 内动作区，排除 code        | Copy 可用且无 Stop/busy      |
| Kimi     | message ID              | 当前 assistant article，排除 code         | Copy 可用且无 loading/Stop   |
| 豆包     | message/local ID        | `union_message` 等当前消息容器，排除 code | Copy 可用且无 break/Stop     |
| 通义千问 | `data-chat` / answer ID | answer feedback toolbar，排除 code        | Copy 可用且无 receiving/Stop |

所有 selector 和站点特殊逻辑均位于 `src/providers/<provider>/`。

## 自动化验收

- Copy-first 在没有正文 selector 命中的情况下仍可完成。
- 基线历史回复文字变化不会产生 streaming 或 terminal 正文。
- 豆包新版 `union_message` / `message-block-container` / `md-box-root` fixture 可完成原生复制。
- Kimi 当前 prompt 邻近目标优先，旧回复横幅变化不会触发旧按钮。
- DeepSeek、通义千问均按当前 assistant turn 定位 Copy，并排除代码块 Copy。
- `pnpm check` 通过：TypeScript、ESLint、Prettier 均无错误。
- 全量测试通过：33 个测试文件、179 个用例。
- 覆盖率任务通过：语句 86.60%、分支 75.09%、函数 91.75%、行 89.69%。
- 生产构建通过；Playwright E2E 20 个用例全部通过。

## 待办边界

真实登录站点的 selector、hover 后按钮挂载方式和 clipboard MIME 仍需在用户浏览器中灰度验证。未挂载的虚拟历史不在本 change 的承诺范围内；本项目依靠每轮完成时持久化，且不读取 Cookie/token、不调用站点私有会话 API、不滚动批量点击历史 Copy。
