# AI 回复采集完整性调研

日期：2026-09-01

## 1. 调研问题

需要解释并修复以下静默数据损失：

- AI 官网已经渲染完整回答。
- 工作台历史只保存标题、首段、“已停止”或空回答。
- 完整会话复制只得到 `# 你好` 一类极短结果。
- UI 仍把对应站点标记为“已完成”，用户没有收到不完整警告。

调研覆盖 AI 对话导出扩展、网页转 Markdown 工具、虚拟列表采集器、流式 DOM 观察器、frame/shadow DOM 保存工具，以及当前仓库从 DOM 到剪贴板的完整链路。

## 2. 当前仓库的证据链

### 2.1 剪贴板不是首要嫌疑

`src/entrypoints/workspace/text-transfer.ts` 把完整字符串交给 `navigator.clipboard.writeText`，fallback 也把完整字符串赋给 textarea 后执行一次复制。这里没有截取标题或首段的逻辑。

`src/core/transcript/markdown-transcript.ts` 直接拼接持久化的 `responseMarkdown || responseText`。因此历史详情已经缺失时，复制层无法恢复正文。只复制出标题说明数据库中对应范围没有可用回答，或上游只存入了极短回答。

### 2.2 content selector 会在首个匹配层提前停止

`src/core/providers/response-content.ts` 的 `queryContentElements` 按 selector 顺序查找，并在第一条存在任何 match 的 selector 上立即返回。它没有比较：

- 该 match 是标题块、单个 Markdown block，还是完整 answer container；
- 同一 assistant turn 中其他 selector 能否覆盖更多正文；
- 多个 block 是否需要按 DOM 顺序聚合；
- 候选是否只是状态 chrome、思考过程或工具输出。

DeepSeek 当前 `responseContent` 首项是较窄的 `.ds-assistant-message-main-content .ds-markdown`，后面才是完整 `.ds-assistant-message-main-content`。如果官网把标题与后续正文渲染为不同 block，首项只要命中标题，包含全部 block 的完整容器就永远不会参与选择。

公开项目已经出现完全相同的故障。[obsidian-AI-exporter issue #281](https://github.com/sho7650/obsidian-AI-exporter/issues/281) 记录了一个 assistant turn 内存在多个 `.markdown.prose`，旧实现只读取首块导致后半回答丢失；[修复 PR #284](https://github.com/sho7650/obsidian-AI-exporter/pull/284) 改为收集全部 block、去重并按 DOM 顺序合并。

### 2.3 turn root 的优先级被混成普通 union

DeepSeek 的 `responses` 同时包含虚拟列表 turn wrapper、assistant wrapper、main content、通用 assistant 节点和 `.ds-markdown`。`queryDistinctVisibleElements` 只能按 selector 顺序消除父子重叠，无法表达“canonical turn tier 有结果时禁止 fallback tier 抢占”。

`BaseDomStrategy.captureResponse` 一旦设置 `selectedKey`，只要该 key 仍存在就继续返回它，不再比较同一轮是否出现更高可信度候选。因此临时标题 root 即使仍留在 DOM，后来出现的最终 answer root 也没有晋升机会。

[ai-browser-bridge issue #2](https://github.com/YosefHayim/ai-browser-bridge/issues/2) 展示了相同类型的 selector 层级问题：只观察消息内容节点会漏掉真实 turn 结构，必须先确定 turn wrapper，再关联正文节点。

### 2.4 当前 completed 条件允许从未见过生成态

当前完成条件是：存在 `latestText`、当前没有检测到 `generating`、文本静默达到 `quietMs`。它没有要求：

- 曾经观察到 generating；
- canonical final answer 已出现；
- stop/send 控件完成了一次可确认的状态转换；
- 当前 root 在 final re-read 中保持相同；
- 新快照比标题或状态文字更像正文。

所以 stop selector 短暂失配、按钮在发送/停止之间复用、属性变化未被 observer 捕获，都会让 `# 你好` 在静默 12 秒后合法地变成 `completed`。延长 quiet 时间只能降低概率，不能修复判定逻辑。

[Parley 的流式 observer](https://github.com/Satyajeet-04/parley/blob/main/parley/adapters/js.py) 同时观察文本增长与生成控件，并在完成前重复采样；[ai-browser-bridge 的 Gemini adapter](https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/features/providers/gemini/geminiPage.ts) 先确认新回复，再等待生成指示消失，最后要求非暂态文本稳定。两者都说明 MutationObserver 的“暂时没有 mutation”不等于模型已经完成。

### 2.5 更新协议没有 revision 和终态防回退

`PROVIDER_RESPONSE_UPDATE` 只有状态和正文，没有 `captureId/revision`。Workspace 对正常更新采用 fire-and-forget 持久化，`applyResponseUpdate` 也会无条件接受到达的状态和文本。

因此协议无法证明以下顺序一定安全：

```text
streaming revision 7 starts writing
completed revision 8 starts writing
revision 7 finishes last and overwrites terminal data
```

浏览器消息和 IndexedDB 在常见情况下可能保持顺序，但这是实现偶然性，不是领域契约。完整性修复必须让 reducer 自己拒绝旧 revision、终态回退和无依据的短正文覆盖。

### 2.6 observer 已较完整，但仍缺少关键属性

当前 observer 已覆盖 `childList + subtree + characterData`，这比“只加 MutationObserver”类建议更成熟。不过 attribute filter 没有覆盖常见的 `aria-busy`、`data-state` 和 `data-virtual-list-item-key`。1 秒 poll 可以补读最终状态，却可能错过短暂的生成边界。

[MDN MutationObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe) 明确区分 child、character data 和 attribute 变化。正确方向是让 observer 只负责唤醒合并读取，并观察 adapter 声明的有限状态属性，不是在 mutation callback 内立即执行重型 Markdown 转换。

## 3. 开源实现调研

### 3.1 与当前故障最相关的实现

| 项目                                                                                                           | 关键机制                                                                                                                               | 可借鉴点                                                                 | 边界                                                      |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| [rashidazarang/chatgpt-chat-exporter](https://github.com/rashidazarang/chatgpt-chat-exporter)                  | 固定一次 selector；虚拟 turn 空挂载时进入 pending，不提前标 seen；稳定 ID；MutationObserver quiet 后重读；输出 complete/unreached 诊断 | 空壳重试、候选缓存、完整性不能默认为 true、隐藏 tab 处理                 | MIT；API 与滚动导出主要面向完整历史，不直接等于实时采集   |
| [Scroll](https://github.com/asker-kurtelli/scroll)                                                             | provider adapter；Claude 同一 turn 的重叠候选按有效正文长度择优；ChatGPT 按 turn ID 缓存虚拟化文本                                     | 不以第一个 selector match 作为真相；按站点划定 reasoning 与 final answer | MIT；其 observer 未监听 characterData，不能直接复用       |
| [ai-chat-to-obsidian](https://github.com/coryeleven/ai-chat-to-obsidian)                                       | 逐屏累计稳定 ID；记录 reachedTop/reachedBottom；结果显式带 `complete`                                                                  | “采到内容”和“证明完整”是两个状态                                         | MIT；包含私有 ChatGPT API 路径，不纳入首期                |
| [Dialogue Export](https://github.com/vaulthunt3r/dialogue-export)                                              | 用可见起始 signature、节点数、scrollTop、scrollHeight 的连续稳定样本判断批次；逐屏缓存                                                 | 虚拟列表不能靠最终一次 DOM 扫描；恢复原滚动位置                          | 面向用户主动导出，正常实时采集不应自动滚动                |
| [Context Sync DeepSeek adapter](https://github.com/Vineetpandey0/context-sync/blob/main/injectors/deepseek.js) | MutationObserver + debounce + 多 class fallback                                                                                        | SPA 持续观察思路                                                         | MIT；宽泛/hashed class 和覆盖式快照会重复或截断，作为反例 |

[rashidazarang 的提取引擎](https://github.com/rashidazarang/chatgpt-chat-exporter/blob/master/src/extraction-engine.js) 还有两个直接适用的细节：流式回答在导出前必须停止增长；消息节点先挂载但内容为空时不能永久去重，否则正文填充后不会再被读取。其测试还明确要求“永不停止的流只能标为不完整，不能伪装 complete”。

### 3.2 API-first 项目

以下项目绕过虚拟 DOM，从站点同源内部接口读取结构化会话：

- [ChatArchive DeepSeek adapter](https://github.com/Weiykong/ChatArchive/blob/main/src/content/platforms.js) 和 [extractor](https://github.com/Weiykong/ChatArchive/blob/main/src/content/extractor.js) 优先调用 DeepSeek `history_messages`。
- [AI Exporter DeepSeek API](https://github.com/sisodiabhumca/AI-Exporter/blob/main/extension/lib/api-deepseek.js) 与 [parser](https://github.com/sisodiabhumca/AI-Exporter/blob/main/extension/lib/parser-deepseek.js) 兼容另一种响应 envelope。
- [decant-core DeepSeek adapter](https://github.com/Covai-Labs/decant-core/blob/main/ai/deepseek.js) 从 `current_message_id` 沿 `parent_id` 恢复当前分支。
- [Chat2Note DeepSeek parser](https://github.com/shiquda/chat2note/blob/main/src/content-scripts/parsers/deepseek.ts) 展示了 `chat_messages[].fragments[]` 中 REQUEST、RESPONSE、THINK 的拆分。
- [Threadkeeper ChatGPT adapter](https://github.com/LogicalAbsurd/threadkeeper/blob/main/content-scripts/chatgpt.js) 从 `current_node` 沿 parent 恢复当前可见分支。
- [claude-chat-exporter](https://github.com/agarwalvishal/claude-chat-exporter) 读取 Claude 会话树，并把 `stop_reason: user_canceled` 与已有正文分开表示。

API-first 对长历史和虚拟列表最完整，但这些都是未公开、随站点变更的内部接口；部分方案还读取 localStorage token 或页面会话。它们与本仓库当前“只读可见 DOM、不读取 Cookie/localStorage/私有流量”的架构冲突。`decant-core` 与 Threadkeeper 还分别涉及 AGPL-3.0 许可，不能直接复制到当前项目。

结论：把这些方案记录为单独的 provider data-source 能力候选，但不放进本 change 的首期实现。若以后采用，必须另建 ADR，明确用户授权、凭据不出页面、不记录 token、schema drift、401/429、服务条款和许可证义务。

### 3.3 站点原生 Copy 项目

[ai.md](https://github.com/koobzaar/ai.md) 在页面主世界临时替换 `navigator.clipboard.writeText` 和 `navigator.clipboard.write`，点击站点原生 Copy 后拦截站点生成的 Markdown，并在 `finally` 恢复原方法。Claude 后来改用 `ClipboardItem` 导致只 hook `writeText` 失效的案例见 [claude-chat-exporter issue #20](https://github.com/agarwalvishal/claude-chat-exporter/issues/20)。

这个 fallback 可以保留站点原生公式、引用和代码格式，但它需要 MAIN world 注入、临时 monkey patch 全局剪贴板、识别每轮正确按钮并处理用户同时复制的竞态。它适合作为用户主动触发的诊断/导出 fallback，不适合作为静默实时采集主路径，也不纳入本 change 首期。

### 3.4 普通网页与深层 DOM 工具

- [Turndown](https://github.com/mixmark-io/turndown) 接受 DOM Node，并支持 remove/addRule/GFM。它解决“已有完整 HTML 如何转 Markdown”，不负责发现完整回复。
- [Mozilla Readability](https://github.com/mozilla/readability) 建议在克隆 document 上运行，因为 parse 会修改 DOM。它适合文章正文，不理解 assistant role、分支、thinking 和生成状态。
- [Defuddle](https://github.com/kepano/defuddle) 在结果过短时降低过滤强度重试，并可展开 open Shadow DOM。其“短结果不是自动成功”值得借鉴，但通用文章打分不能替代 provider adapter。
- [SingleFile](https://github.com/gildas-lormeau/SingleFile) 使用 all-frames、document-start 和 shadow-root hook 保存完整页面。它证明 closed shadow root 必须提前 hook；当前没有证据表明 DeepSeek 回答位于 closed shadow root，因此不应引入这一级复杂度。
- [MarkDownload](https://github.com/deathau/markdownload) 使用 detached HTML、Readability 与 Turndown/GFM。其转换流水线有参考价值，但虚拟化内容不在 DOM 时同样无法恢复。

## 4. 浏览器边界

- Content Script 可以读取它所在 frame 的 DOM，但父页面不能跨同源策略直接读取 provider iframe。[Chrome content script 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) 与 [MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy) 支持当前“frame 内采集、background 校验 frame 身份后转发”的架构。
- `allFrames: true` 只解决匹配 URL 的 frame。about:blank、data:、blob: 等继承 origin 的 frame 还涉及 `match_origin_as_fallback`。本 change 应增加 frame fixture，但没有实际证据时不扩大 host permission。
- `textContent` 会包含隐藏节点、script/style，`innerText` 反映渲染文本但可能触发布局。[MDN Node.textContent](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent) 支持继续以 clone 后 HTML -> Markdown 为主，纯文本只作为 fallback；不能简单选择最长 `textContent`。
- open Shadow DOM 可以递归读取；closed Shadow DOM 不能事后穿透。[MDN ShadowRoot.mode](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/mode) 说明需要 document-start hook 才能保留 closed root 引用。首期不做无证据的全局 hook。

## 5. 根因优先级

| 优先级 | 根因                                                       | 与当前截图的吻合度                     | 修复方向                                           |
| ------ | ---------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| P0     | 同一 turn 的正文选择在首个窄 selector 上提前返回           | 极高，公开 issue 已复现“只取首块”      | canonical container + 全 block 聚合 + 候选择优     |
| P0     | `selectedKey` 锁定临时 root，不能升级 final root           | 高，SPA/虚拟 DOM 常先挂临时节点        | 同 turn candidate promotion                        |
| P0     | 从未见 generating 也可 quiet-only completed                | 高，可直接从当前代码推出               | terminal-aware 状态机 + final re-read              |
| P0     | 状态 chrome 被当回答，“已停止”覆盖正文                     | 高，历史卡片已出现该文字               | 结构化 UI noise 分类，停止只作为 terminal metadata |
| P1     | 无 revision 的异步持久化发生旧更新覆盖                     | 中高，协议没有防护                     | captureId/revision reducer                         |
| P1     | root wholesale replacement/navigation 使 observer 失去归属 | 中                                     | 稳定 turn key 重绑定和 checkpoint                  |
| P2     | 完整历史因虚拟列表未挂载                                   | 对当前新回复较低，对后续全历史导出很高 | 生成时持续持久化；主动导出另做 sweep/API           |
| P3     | clipboard 自身截断                                         | 低                                     | 端到端长度测试即可，不先改 clipboard API           |

## 6. 调研结论

本问题不能通过“再加一个 selector”“把 quiet 从 12 秒改成 20 秒”或“换一个 Markdown 库”解决。首期应同时建立：

```text
canonical turn identity
  -> tiered content candidates
  -> promote to the best structural snapshot
  -> terminal-aware completion
  -> final atomic re-read
  -> revisioned transport and persistence
  -> transcript length/integrity assertion
```

这条路径能直接解决当前新生成回复的静默截断，并保持现有权限、隐私和站点交互边界。长历史虚拟化导出、私有 API 和站点原生 Copy 属于不同能力，应另行评审，不能混入本次修复来掩盖实时采集内核的问题。
