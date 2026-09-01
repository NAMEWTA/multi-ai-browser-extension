# 设计

日期：2026-09-01

## 1. 核心不变量

### 1.1 正文来源

- `responseText` / `responseMarkdown` 非空时，`captureSource` 必须是 `native-copy`。
- 官网 DOM 文本只能参与目标定位、稳定性指纹和完整性校验。
- 原生 Copy 不可用、超时或校验失败时，结果是 `failed`/`timeout`，正文保持为空。

### 1.2 轮次归属

- 发送前保存可见原生 Copy targets 的 key 集合。
- 发送后只考虑 baseline 中不存在的新 target。
- Provider 优先通过当前 prompt 后的 assistant turn 选择目标。
- Copy 按钮必须属于目标 turn 的 action/toolbar 边界，代码块、引用、链接和用户消息 Copy 必须排除。

### 1.3 单次持久化

- Provider bridge 首先发送一次 `waiting`，不含正文。
- capture 期间不发送 streaming 正文。
- 成功时只发送一次 terminal update，包含 native payload。
- 失败时只发送一次 terminal update，且不含正文。
- revision/captureId reducer 继续拒绝旧 capture、重复 revision 和 terminal 后回退。

## 2. Provider 标准

每个 `src/providers/<provider>/` 必须包含：

```text
definition.ts
selectors.ts
native-copy.ts
native-copy.test.ts
strategy.ts
strategy.test.ts（站点有特殊输入/终态行为时）
index.ts
```

`native-copy.ts` 负责：

- 枚举当前挂载的 assistant turns。
- 在 turn 内定位回复级 Copy。
- 排除代码块和非回复 Copy。
- 生成稳定 turn key。
- 将 prompt 与发送后的 assistant turn 关联。
- 判断 Provider 的生成状态是否结束。
- 必要时 hover 以显示 action bar。
- 对 Provider 固定包装文本做保守 normalize。

core 不包含任何站点 selector。

## 3. 终态状态机

```text
WAITING
  | 新 native target 出现
  v
TARGET_SEEN
  | generating 存在或 target 指纹变化
  +------------------------------> TARGET_SEEN
  | generating 消失且指纹静默达到 terminalStableMs
  v
COPY_ARMED
  | 点击本轮 Copy 一次
  | 收集同一点击的 clipboard 候选写入
  | clipboard 静默窗口结束后选最完整 payload
  v
VALIDATING
  | 通过 ------------------------> COMPLETED -> 持久化正文
  | 失败 ------------------------> FAILED    -> 不持久化正文
```

默认 `terminalStableMs` 为 1.5 秒；豆包使用更保守的 3 秒。Provider 的 stop/generating 证据仍是硬条件之一，但稳定窗口用于抵抗生成 selector 漂移和流式停顿。

## 4. 剪贴板捕获

- MAIN world 在 document start 包装 `navigator.clipboard.writeText` 和 `write`。
- 无 active request 时完整透传。
- active request 默认阻止真实系统剪贴板写入，避免覆盖用户内容。
- 一次点击产生的多笔写入进入候选集合，不在第一笔立即 resolve。
- 每次新候选重置短静默计时器；静默后按有效文本长度优先、MIME 质量次优选择 payload。
- `ClipboardItem` 内仍按 `text/markdown`、`text/plain`、`text/html` 读取。
- 候选、超时、取消和卸载都必须清理 timer；正文不得进入诊断日志。

## 5. 完整性校验

- payload 规范化后必须非空。
- payload 不得等于 prompt 或 Copy 成功提示。
- 当 DOM 已有较长正文时，native 文本不得灾难性短于 DOM。
- 默认要求 native 包含 DOM 末尾锚点；Provider 只有在真实 Copy 明确会产生不同序列化时才可关闭。
- HTML 先转换成安全 Markdown/纯文本，不直接持久化可执行 HTML。

## 6. 默认 Provider 迁移

- 新默认顺序：DeepSeek、豆包、通义千问。
- 默认全部选中。
- workspace storage 升级到 v4；读取 v3 后仅对“恰好是旧默认 DeepSeek + Kimi”的布局执行一次迁移，自定义布局保持不变。

## 7. 失败语义

- 无 native adapter/client：`unsupported`。
- 到期前没有本轮 Copy target：`timeout`。
- 检测到验证页：`failed` + `verification`。
- Copy 点击未写入、payload 无效或按钮归属失效：`failed`。
- 下一轮开始时，上轮仅在可确认 terminal target 时尝试一次 finalize；否则失败，不保存 DOM 片段。

## 8. 下游业务

会话详情折叠面板、最后一轮复制、统一会话复制和 Markdown 导出不直接读取官网 DOM，也不再次点击官网历史 Copy。它们只读取 IndexedDB 中每轮已完成的 native-copy 正文，因此统一复用同一份稳定数据。
