# AI 回复采集完整性修复

状态：实现与自动化验证完成；真实 DeepSeek smoke 待专用登录态执行

日期：2026-09-01

## 问题

AI 官网已经显示完整回答，但工作台历史只保存了标题、首段或状态文字。当前复现中，官网回答包含多段正文和列表，历史卡片却只显示“已停止”，复制结果甚至只有会话标题 `# 你好`。

这不是普通的剪贴板截断问题。现有复制函数会整体写入已经生成的字符串，转录器也只是读取 IndexedDB 中的 `responseMarkdown/responseText`。主要数据损失发生在更上游的 DOM 候选选择、完成判定或回复更新持久化阶段。

## 本 change 的结论

首期修复采用四个相互配套的机制：

1. 用有优先级的 canonical turn/content 契约代替混合 selector union。
2. 允许同一轮回复从临时标题节点升级到更可信的最终正文节点，并聚合同一 assistant turn 的全部正文块。
3. 用终态感知的采集状态机代替“任意非空文本静默一段时间即 completed”。
4. 给跨 frame 更新和 IndexedDB 写入增加 `captureId + revision`，禁止旧 streaming 更新覆盖完整终态。

首期继续遵守项目当前的隐私和权限边界：不读取 Cookie、localStorage 或站点私有会话 API，不注入脚本劫持站点剪贴板。GitHub 上常见的 API-first 和原生 Copy 方案已经记录在调研中，但只有在另行完成合规、凭据处理和架构评审后才能启用。

## 已实施

- 新增 canonical/semantic/fallback turn tiers，以及 final container、content block、exclude 和 status-only 契约。
- 同一轮可从临时标题候选晋升到完整正文候选；终态需要可信证据和两次相同快照确认。
- provider bridge、workspace buffer 和 IndexedDB 使用 `captureId + revision` 单调合并。
- DeepSeek 脱敏 fixture 覆盖 thinking-only、root replacement 和 heading-first 完整回答。
- 全部内置 provider 已迁移到分层 capture plan。
- 历史、transcript 与 clipboard 使用持久化的 terminal/partial 正文，并显示终止原因。

## 文档

- [research.md](./research.md)：开源项目证据、当前链路审计和根因判断。
- [design.md](./design.md)：采用的完整性模型、状态机和数据契约。
- [implementation-plan.md](./implementation-plan.md)：按风险拆分的实施顺序。
- [acceptance.md](./acceptance.md)：自动化与真实站点验收标准。
- [verification.md](./verification.md)：本次实施的自动化结果与剩余真实站点验收。

## 与已有 change 的关系

`2026-09-01-unified-chat-capture-hardening` 完成了 baseline entries、基础 Markdown 转换、selector 补充和超时保留 partial。本 change 不重复这些工作，而是实施此前被列为后续方向的采集内核完整性能力，专门阻止“短快照被错误标为已完成”。
