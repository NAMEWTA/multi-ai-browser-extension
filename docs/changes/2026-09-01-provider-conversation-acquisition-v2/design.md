# 设计

## 1. 采集流水线

```text
provider submit baseline
  -> fresh provider response observation
  -> provider API parser + completeness gate
  -> current-turn native Copy
  -> scoped terminal DOM
  -> immutable snapshot persistence
  -> exchange/history/transcript/export
```

策略是顺序选择，不是内容合并。只有首个通过质量闸门的单一来源可以成为本轮结果。

## 2. Canonical 契约

`ConversationSnapshot` 包含：

- `providerId/conversationId/capturedAt/source`；
- 有稳定 ID、role、parent/branch 和结构化 content block 的 messages；
- `complete/partial/unknown` 与消息数、字符数、首尾边界；
- cursor、branch、stable key 等 evidence；
- 不含正文的 diagnostics。

“有字符串”不等于 complete。API snapshot 只有在游标耗尽、活动分支可线性化、provider 计数一致等适用证据满足时才能通过。

## 3. 当前轮关联

- 预检产生 DOM/Copy baseline，并记录 `acquisitionObservedAfter`。
- API observation 的请求时间必须不早于该边界。
- observation、页面 URL 和 payload 中可用的 conversation ID 必须一致。
- 结果按规范化后的完整 prompt 找到最后一个 user message，再只选择其后的 assistant message。
- Copy target 的稳定 key 必须不在发送前 baseline 中。
- 重复 prompt 如果只有旧 assistant、或最新 user 后尚无 assistant，不得回退选择更早回答。

## 4. 网络桥

- WXT MAIN-world content script 在 `document_start` 安装 fetch/XHR 观察器。
- 只观察 `identifyProviderEndpoint` 明确列出的同源 JSON endpoint。
- 真实 URL、请求头和 credentials 只在 MAIN closure 保存；公开 descriptor 只包含安全 URL、方法、允许的分页/会话字段和时间。
- replay 只能复用已观察请求；body patch 只允许豆包/Kimi 分页键。
- direct fetch 必须同源且 provider/endpoint 配对完全匹配。
- request 事件上限 64 KB，response 上限 8 MB；超限显式错误，不截断。

## 5. Provider 矩阵

| Provider | 首选来源                   | 完整性证明                                                      | 回退               |
| -------- | -------------------------- | --------------------------------------------------------------- | ------------------ |
| DeepSeek | `history_messages`         | current message + parent chain                                  | Copy -> scoped DOM |
| 豆包     | `/im/chain/single`         | pagination cursor exhausted                                     | Copy -> scoped DOM |
| 通义千问 | observed conversation JSON | conversation ID + cursor + active branch                        | Copy -> scoped DOM |
| Kimi     | `ListMessages`             | root page + token exhausted + parent chain + finished assistant | Copy -> scoped DOM |
| ChatGPT  | conversation mapping       | `current_node` parent chain                                     | Copy -> scoped DOM |
| Claude   | full conversation response | stable IDs + terminal assistant + no `has_more`                 | Copy -> scoped DOM |
| Coze     | no verified API adapter    | current-turn Copy                                               | scoped DOM         |
| MiniMax  | no verified API adapter    | current-turn Copy                                               | scoped DOM         |

## 6. 持久化

通过质量闸门后，整个 snapshot 中的消息按
`turnId + panelId + providerId + conversationId + providerMessageId + revision` 幂等保存。当前 extension turn 选中的 assistant message 标记 `selected=true`，历史消息保存为 `selected=false`。相同官网会话可以安全地被多个本地 session 引用，删除一个 session 不影响另一个。

Exchange 继续保存本轮最终正文，现有“复制最近一轮、复制统一对话、Markdown/JSONL 导出”只读取持久化结果，不重新抓官网 DOM。

## 7. 降级语义

- API partial/unknown：拒绝该候选，继续 Copy。
- Copy 无事件、只复制确认文案或与当前回复不一致：继续 scoped DOM。
- DOM 只有状态/空壳：继续等待；超时不保存伪正文。
- 已有终态 revision：任何旧 revision 或 waiting 更新均不得覆盖。
- 删除 session：同步删除该 session turns 对应的 acquisition snapshots。
