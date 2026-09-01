# AI 回复采集完整性实施计划

日期：2026-09-01

## 1. 实施原则

- 先用失败 fixture 固化当前现象，再改采集内核。
- 首期只解决“当前新生成回复”的完整性，不顺带实现全历史滚动导出或私有 API。
- 核心与 provider selector 分开提交，便于定位回归。
- 每个阶段都保持 partial 正文可恢复，任何错误不得清空已保存内容。

## 2. Phase 0：复现与证据

目标：让 `# 你好` 截断在自动化测试中稳定失败。

新增脱敏 fixture，不使用只有一个 div 的理想化 HTML：

- DeepSeek assistant turn 先挂载 heading-only block。
- 同 key 临时 root 保留，同时出现更高 tier final container。
- final container 包含标题、5 段正文、3 项列表、emoji、代码和工具栏。
- reasoning/search/status 与 final answer 同时存在。
- stop 控件短暂消失后恢复。
- whole turn root 被同 key 新节点替换。

涉及文件：

- `src/core/providers/response-content.test.ts`
- `src/core/providers/base-dom-strategy.test.ts`
- `src/providers/deepseek/strategy.test.ts`
- 新增 `tests/fixtures/providers/deepseek/*.html`

测试首先证明当前实现会只取标题或提前 completed，再进入后续阶段。

## 3. Phase 1：Canonical candidate engine

目标：建立 turn identity、selector tier、正文聚合和 candidate promotion。

工作项：

1. 在 provider contracts 中加入 `ResponseCapturePlan/SelectorTier`，保留旧 selectors 的受控兼容层，迁移完成后删除扁平路径。
2. 把 `readResponseContent` 拆为：turn discovery、candidate construction、clone cleanup、Markdown serialization。
3. 同一 selector tier 使用 union；不同 tier 严格按优先级。
4. 同一 final container 内聚合全部非嵌套正文 block，按 DOM 顺序输出。
5. 引入结构化 candidate 比较，禁止 status-only candidate 成为有效回答。
6. 把 `selectedKey` 拆成 `selectedTurnKey + selectedCandidateId`，支持同 turn 晋升和 root replacement 重绑定。

主要文件：

- `src/core/providers/contracts.ts`
- `src/core/providers/response-content.ts`
- `src/core/providers/base-dom-strategy.ts`
- 各 `src/providers/*/selectors.ts`
- 各 `src/providers/*/strategy.ts`

Phase 1 完成条件：静态 fixture 中始终选择完整 final container，不重复 thinking/block，不把“已停止”当正文。

## 4. Phase 2：终态感知状态机

目标：删除 quiet-only completed 路径。

工作项：

1. 将 capture 内部状态显式化为 awaiting-turn/streaming/settling/terminal。
2. 分别记录 `generatingSeen`、generation transition、final container seen、composer recovered、snapshot stability。
3. observer attribute filter 由 adapter 声明，覆盖必要的 `aria-busy/data-state/turn-key`。
4. Mutation callback 只标 dirty；合并后读取一次 canonical snapshot。
5. terminal 前执行 final drain、双 rAF、短 settle 和两次相同快照确认。
6. 人工停止、abort、timeout、navigation 均返回带最佳正文的 partial。
7. 从未见 generating 且终态证据不足时，不允许 completed。

主要文件：

- `src/core/providers/base-dom-strategy.ts`
- `src/core/providers/contracts.ts`
- `src/entrypoints/provider-bridge.content.ts`

Phase 2 完成条件：stop 暂时消失、模型长停顿、空壳后填充、thinking -> final 等 fixture 均不提前结束。

## 5. Phase 3：Revisioned pipeline

目标：跨 frame、buffer 和 IndexedDB 的最终结果单调前进。

工作项：

1. 扩展 Zod protocol：`captureId/revision/observedAt/terminalReason`。
2. provider bridge 为每次采集生成 captureId，并给 waiting/streaming/terminal 严格编号。
3. pending response buffer 按最高 revision 合并，保留该 revision 的 text/Markdown 原子对。
4. database schema 增加 `captureId/responseRevision/terminalReason`。
5. `applyResponseUpdate` 在事务中实现 compare-and-apply；拒绝旧 capture、低 revision 和 terminal 回退。
6. 为并发写入、乱序消息、重复 terminal、terminal 无正文建立测试。
7. 明确当前开发期数据库策略：若仍不维护迁移链，提升数据库版本并更新文档；如果需要保留已有测试数据，则添加单向迁移。

主要文件：

- `src/core/messaging/protocol.ts`
- `src/entrypoints/provider-bridge.content.ts`
- `src/entrypoints/background.ts`
- `src/entrypoints/workspace/workspace-app.tsx`
- `src/db/database.ts`
- `src/db/session-service.ts`
- 对应 protocol/session/runtime tests

Phase 3 完成条件：revision 8 completed 后到达 revision 7 streaming，数据库仍保持 revision 8 的完整正文和 terminal 状态。

## 6. Phase 4：Provider 迁移

迁移顺序按当前风险：

1. DeepSeek
2. Qwen
3. Kimi
4. ChatGPT、Claude
5. Gemini/Coze/MiniMax 等现有 provider

每个 provider 必须提交：

- canonical turn tier；
- final container 与 content block；
- thinking/search/tool/status exclude；
- generating/terminal signals；
- 稳定 key 提取；
- 正常、深度思考、搜索、人工停止、重新生成 fixture；
- selector drift 时的保守 fallback。

不接受只增加 hashed class 的修复。class selector 只能作为 fallback，并在诊断中显示 tier。

## 7. Phase 5：转录、复制与历史 UI

工作项：

1. 转录测试覆盖完整 Markdown、partial 正文和 terminal reason。
2. mock `navigator.clipboard.writeText`，逐字断言 artifact，无标题-only 假成功。
3. 历史详情区分 completed、部分回复、人工停止和终态不确定。
4. terminal 正文为空或仅 status-only 时，不显示绿色“已完成”。
5. diagnostics 中展示 selector tier、revision、长度和 terminal reason，不展示正文。

主要文件：

- `src/core/transcript/markdown-transcript.ts`
- `src/entrypoints/workspace/text-transfer.ts`
- `src/entrypoints/workspace/session-history-detail.tsx`
- `src/runtime/provider-diagnostics.ts`
- 对应 tests

## 8. Phase 6：真实站点 smoke

使用专用账号和低频非敏感提示词：

```text
请输出 120 行，格式严格为 LINE-001 到 LINE-120。
第 60 行写 MID-SENTINEL，第 120 行写 END-SENTINEL。
```

对 DeepSeek 至少覆盖：

- 普通回答；
- 深度思考；
- 搜索模式；
- 人工停止；
- iframe 可见、工作台最大化/恢复；
- 标签页短暂后台；
- 官网 SPA 路由或 frame reload。

断言 DOM 预览、IndexedDB history、历史详情和复制 artifact 均包含 LINE-001、MID-SENTINEL、END-SENTINEL。人工停止只要求保存停止前正文并标 partial。

真实 smoke 记录 selector tier、revision 数、最终长度和 terminal reason，不保存回答正文。

## 9. 性能与回滚

- observer callback 不运行 Turndown；读取按 dirty 合并。
- 只观察 conversation root/active turn，root 未出现时才使用较宽 observer。
- streaming 更新可按 100-250 ms 合并；terminal 不延迟越过 final settle。
- 单条回复继续受 2 MB 上限保护，超限必须显式 partial/error。
- 若新 adapter 在真实站点失配，可按 provider feature flag 回退旧 adapter，但旧路径不得再报告 `completed`，只能输出 partial，以免恢复静默数据损失。

## 10. 后续独立 change

以下能力不阻塞本 change，但可以基于本次调研另建 change：

- 用户主动触发的虚拟历史逐屏导出；
- 经授权的 provider data-source/API adapter；
- 站点原生 Copy 的 MAIN-world fallback；
- closed Shadow DOM 的 document-start bridge。

这些能力需要额外权限、站点条款、凭据与交互风险评审，不能作为本次实时采集修复的隐式依赖。
