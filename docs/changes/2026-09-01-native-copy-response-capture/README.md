# 原生 Copy 终态回复采集

状态：Copy-first v2 已实现并通过自动化测试，待真实登录站点灰度验收

日期：2026-09-01

## 问题

DOM 采集已经能持续保存流式预览，但部分 AI 官网会把最终回答拆成多个节点、在终态替换回答 root，或只在站点原生 Copy 动作中生成完整 Markdown。此时 DOM 结果可能只有标题、首段或状态文字，最终转录仍可能退化成 `# 你好` 一类只有会话标题的内容。

站点原生 Copy 通常拥有比扩展 DOM 转换器更完整的格式语义，包括代码 fence、表格、公式、引用和站点已经完成的去噪。因此，本 change 为 provider 增加可选的原生 Copy 终态通道，但不让它取代现有 DOM 实时采集。

## 核心决策

1. DOM 采集仍是 waiting、streaming 和 partial checkpoint 的主通道。
2. 原生 Copy 只在当前 assistant turn 已具备终态证据后执行一次，不能参与逐 token 采集。终态证据可由 provider 的“新轮次身份 + 当前回复专属 Copy + 无生成中信号 + 250ms 双观察稳定”提供，不再强制依赖正文 selector 先成功。
3. 捕获必须在页面 MAIN world 的 `document_start` 安装默认透传 wrapper；只有短时 armed 窗口拦截 `navigator.clipboard.writeText` 和 `navigator.clipboard.write`，页面卸载或显式 uninstall 时恢复原方法。
4. provider 只负责定位当前轮 Copy 按钮、判断按钮是否就绪以及规范化站点输出；通用 core 不保存站点 selector。
5. 成功且通过完整性校验的原生结果是该轮终态正文的权威版本；捕获失败时回退现有 DOM 终态或 partial，不把失败伪装成 completed。
6. 本 change 不调用站点私有会话 API，不读取 Cookie、localStorage token，也不通过滚动恢复已经被虚拟列表卸载的历史消息。

## 目标

- 防止官网已完成回答在历史和复制结果中只剩标题、首段或状态文字。
- 同时支持站点通过 `writeText` 和 `write(ClipboardItem[])` 写入剪贴板。
- 不覆盖用户系统剪贴板；非 armed 状态完整透传并保持站点原有 Copy 行为。
- 每轮最多一次 single-flight 捕获，不点击用户轮、其他 assistant turn 或隐藏副本的 Copy。
- 保留 `captureSource` 和 MIME 诊断，使真实站点失败可定位、可按 provider 回滚。

## 非目标

- 不用原生 Copy 采集流式中间态。
- 不批量点击全部历史消息的 Copy 按钮。
- 不自动滚动会话列表，不承诺恢复未挂载的虚拟历史。
- 不 hook `fetch`、WebSocket 或站点私有数据接口。
- 不把原生 Copy 作为所有 provider 的强制能力。
- 不读取或恢复用户原有剪贴板内容；设计通过抑制真实写入来避免改动剪贴板。

## 文档

- [research.md](./research.md)：开源实现证据、可借鉴机制和边界。
- [design.md](./design.md)：终态权威模型、MAIN-world bridge、provider 目录和降级设计。
- [implementation-plan.md](./implementation-plan.md)：按风险拆分的文件级实施顺序。
- [acceptance.md](./acceptance.md)：自动化、真实站点、隐私和回滚验收矩阵。
- [execution.md](./execution.md)：Copy-first v2 的实际落地范围、故障修复和验证结果。

## 与相邻 change 的关系

`2026-09-01-ai-response-capture-integrity` 负责 canonical turn、候选升级、完成证据、revision 单调合并和持久化完整性。本 change 只扩展“当前轮已经进入终态后，如何取得站点认可的最终正文”。它不能绕过前一个 change 的轮次归属和完成状态机，也不能修复从未挂载且此前未保存的历史消息。
