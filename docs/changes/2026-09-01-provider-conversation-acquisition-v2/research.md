# 调研结论

日期：2026-09-01

## 1. 开源实现的共同结论

- [ChatArchive](https://github.com/Weiykong/ChatArchive) 与 [decant-core DeepSeek adapter](https://github.com/Covai-Labs/decant-core/blob/main/ai/deepseek.js) 优先读取 DeepSeek `history_messages`，并从 `current_message_id` 沿 `parent_id` 恢复活动分支。
- [Chat2Note DeepSeek parser](https://github.com/shiquda/chat2note/blob/main/src/content-scripts/parsers/deepseek.ts) 把 REQUEST、RESPONSE 与 THINK fragment 分开，证明不能直接拼接所有 fragment。
- [chat-dump-bookmarklet ChatGPT parser](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/a5d80c653690a42eba6c1b69bb93a6e53d3910ba/src/Parsers/ChatGPTParser.js) 从 `current_node` 沿 parent 还原活动分支。
- [claude-chat-exporter](https://github.com/agarwalvishal/claude-chat-exporter) 说明 Claude 页面 DOM 会虚拟化，因此完整历史更适合从同源会话数据恢复。
- [ai-chat-exporter Kimi adapter](https://github.com/wanda1416/ai-chat-exporter/tree/master/packages/adapter-kimi) 展示了 Kimi `ListMessages`、分页 token 和 `blocks[].text.content` 数据形态。
- [DoubaoCLI](https://github.com/Xian-debu/DoubaoCLI) 与 [doubao-helper](https://github.com/chensanle/doubao-helper) 均记录了豆包虚拟列表；一次最终 DOM 扫描不能证明拿到完整历史。
- [ai.md](https://github.com/koobzaar/ai.md) 证明调用站点原生 Copy 能复用官网自己的 Markdown 生成逻辑，但 clipboard API 形态变化会造成 hook 漂移，因此 Copy 适合作为 provider adapter 策略，而不是唯一架构。
- [SingleFile](https://github.com/gildas-lormeau/SingleFile) 使用 `document_start`、MAIN world 和 all-frames hook，说明需要在站点请求发生前安装观察器。
- [rashidazarang/chatgpt-chat-exporter](https://github.com/rashidazarang/chatgpt-chat-exporter) 明确区分“采到正文”和“证明完整”，并处理空壳节点、流式增长与虚拟化消息。

## 2. 为什么旧方案反复失败

旧方案把三个不同问题混成一个：

1. 发现当前回复属于哪个 turn；
2. 判断该 turn 是否结束；
3. 从 DOM 或 Copy 转出正文。

在虚拟列表、React root replacement、thinking/final 双容器和重复 prompt 下，单一 selector 或静默定时器无法同时解决三者。复制按钮也不是全局历史协议：它通常只复制某一条回复，而且必须先可靠关联到本轮新消息。

## 3. 采用的结论

- 会话 API 可以提供稳定 ID、父链、分页与完整性证据，优先级最高。
- 原生 Copy 复用官网序列化，适合当前轮正文，但目标必须排除发送前已经存在的按钮。
- DOM 只能作为当前回复作用域的有界回退，不能声明恢复了未挂载的历史。
- 质量闸门必须在持久化之前执行；来源之间不能拼接，否则无法解释顺序与完整性。
- API observation 必须晚于发送预检基线，并且 conversation ID 与当前页面一致。

## 4. 未采用

- 不读取 Cookie、localStorage、IndexedDB token 或站点凭据。
- 不向后台发送 Authorization、Cookie、CSRF、API key 等敏感字段。
- 不用 CDP/debugger 权限抓包。
- 不自动滚动整个会话作为正常实时采集路径。
- 不把短正文自动判失败；短回答可由稳定 ID、终态游标或原生 Copy 证据证明有效。
