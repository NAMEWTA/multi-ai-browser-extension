# 调研记录

日期：2026-09-01

## 调研对象

### ChatGPT

- [sanand0/scripts 的 ChatGPT 自动化脚本](https://github.com/sanand0/scripts/blob/main/chatgpt) 使用 `[data-testid^="conversation-turn-"]` 建立轮次边界，再从匹配用户问题之后选择第一个 assistant turn。
- 同一实现优先使用 `button[data-testid="copy-turn-action-button"]`，而不是页面上的任意 Copy 按钮。

结论：ChatGPT 适配器必须以 conversation turn 为根，要求根内存在 `data-message-author-role="assistant"`，Copy 优先绑定 `copy-turn-action-button`。

### Claude

- [claude-chat-exporter](https://github.com/agarwalvishal/claude-chat-exporter) 明确指出虚拟化 DOM 和易变 CSS 会使全历史 DOM 导出不可靠；它转而使用同源接口导出。
- 本 change 不读取私有接口，因此只承诺捕获当前新生成且仍挂载的 assistant turn。Provider 适配器使用 Claude 的 assistant/testid、`font-claude-response` 与 action group 边界，并排除代码块 Copy。

结论：不能把“当前回复 Copy”扩张成“自动补采全部官网历史”；历史完整性来自每轮生成完成时立即持久化。

### 豆包

- [DoubaoCLI](https://github.com/Xian-debu/DoubaoCLI) 记录豆包使用 `.list_items > .v_list_row` 虚拟列表，旧消息会被复用或卸载，单纯按行数判断新回复不可靠。
- 其消息动作模块也将 Copy 视为独立的 message action，但简单的全局第一个 `[class*="copy"]` 容易点错轮次。
- [doubao-helper](https://github.com/chensanle/doubao-helper) 同样识别 `.v_list_row`、`.flow-markdown-body` 与 `.md-box-root` 等结构，并说明长历史 DOM 是虚拟化窗口。

结论：豆包必须把 `.v_list_row` 纳入 turn 根，以当前 prompt 后的新 assistant row 为目标；Copy 只能在该 row 的 action bar 内查找。终态需同时满足生成控件消失和内容稳定窗口，不能只稳定 250ms。

### Coze 与 MiniMax

公开源码中缺少稳定、可复用的当前网页 Copy testid。两者采用 Provider 本地的分层选择器：稳定语义属性优先，action/toolbar + 可访问名称次之，易变 class 仅作末级兼容。

结论：不得把 Coze/MiniMax 选择器放进 core；适配器与 fixture 都放在各自 `src/providers/<provider>/` 中，真实站点验证后只需局部更新。

## 对现有实现的审计结论

1. 现有 MAIN bridge 在第一次 `clipboard.writeText/write` 后立即结束。一次点击若产生多笔写入，可能取到较短的先行 payload。
2. 现有终态快速路径只要求目标稳定 250ms。生成控件 selector 漂移时，流式停顿会被误判成终态。
3. 现有 bridge 会把 DOM streaming 正文逐 revision 写入 IndexedDB。
4. 原生 Copy 失败后，现有策略会把 DOM 可见片段保存成 partial，造成“有内容但不完整”的假成功。
5. ChatGPT、Claude、Coze、MiniMax 尚未注册原生 Copy 适配器。

这些问题必须一起修复；单独继续增加 response DOM selector 不能保证完整性。
