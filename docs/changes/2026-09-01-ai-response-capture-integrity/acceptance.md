# AI 回复采集完整性验收标准

日期：2026-09-01

## 1. 阻断级验收

以下任一失败都不得合并：

1. 完整回答只保存标题或首段。
2. “已停止”、按钮文字、thinking/search/tool 状态成为 response payload。
3. 从未获得足够终态证据却返回 `completed`。
4. 旧 streaming revision 覆盖新的 completed/partial terminal。
5. abort、timeout、人工停止或 frame navigation 清空已经采集的正文。
6. 历史正文完整，但复制 artifact 少字或只剩会话标题。

## 2. 精确回归场景

### A. 标题先到、正文后到

Given：本轮初始只挂载 `<h1>你好</h1>`。

When：2 秒后同 key turn 被整体替换为标题、5 段正文和 3 项列表；3 秒时 stop 指示器消失 2 秒后恢复，随后继续追加正文，最终 stop 消失。

Then：

- stop 短暂消失时不得 terminal；
- 最终 `completed` 只在 canonical final snapshot 稳定后产生；
- Markdown 包含标题、最后一段和列表末项；
- 最终结果不得等于 `# 你好`；
- 每个正文块只出现一次。

### B. 临时 root 仍在但 final root 出现

Given：selected turn 中低 tier 标题 root 一直连接。

When：同 turnKey 出现高 tier `.ds-assistant-message-main-content`。

Then：candidate 必须 promote；不能因为旧 key 仍存在而锁死。

### C. reasoning 与 final 并存

Given：同一 virtual turn 同时包含 thinking `.ds-markdown`、search 状态、final container 和反馈工具栏。

Then：正文只来自 final container；thinking/search/status/button 不进入 text 或 Markdown。

### D. 空壳后填充

Given：virtual turn 先挂载空 element。

When：同一 element 后续通过 characterData/children 填入完整正文。

Then：空壳不会被永久 seen；填充内容正常进入 revision。

### E. 从未检测到 generating

Given：站点版本变化导致 stop selector 未命中，页面先出现标题或 fallback root。

Then：在 canonical final/组合终态证据出现前不允许 `completed`；deadline 后有正文则 `partial: uncertain-final`。

### F. 人工停止

Given：已经生成多段正文。

When：用户停止生成，页面出现“已停止”。

Then：停止前正文完整保留；状态为 partial/interrupted；“已停止”不替换正文。

## 3. Candidate engine 验收

- selector tier 有明确 ID 和顺序，canonical tier 命中时 fallback 不生成另一轮。
- 同一 tier 的所有 selectors 参与 union，不是 first-match return。
- final container 和 block union 都可构造候选，并按结构质量选择。
- block 去重能处理父子嵌套、重复 wrapper 和多个 sibling Markdown block。
- turnKey 与 candidateId 分离；同 turn 可以晋升、重绑定和整体 replacement。
- 不用“正文必须超过 N 字”判断有效性；合法的“是”在终态证据充分时可以 completed。
- 只含 role=status/按钮/aria-live chrome 的候选永远不是有效正文。

## 4. 状态机验收

- awaiting-turn 不会被历史 reindex 或旧回复激活。
- streaming 期间文本变化、生成控件、busy 属性任一可信信号都阻止 terminal。
- MutationObserver 覆盖 childList/subtree/characterData 和 adapter 声明的精确属性。
- observer callback 只调度读取，不同步执行 Turndown。
- terminal 前发生 final rebind 和两次相同 structural snapshot 确认。
- quiet window 只是 settling 条件，不是单独完成条件。
- timeout/abort/navigation 有正文时是 partial，无正文时才是 timeout/failed。
- detached root 能按 turnKey 重绑定；无法重绑定时保留最后 checkpoint。

## 5. Revision 与数据库验收

必须自动化覆盖以下乱序序列：

```text
revision 5 streaming (short)
revision 7 streaming (full)
revision 8 completed (full)
revision 6 streaming arrives late
revision 8 duplicate arrives again
revision 9 waiting from stale captureId arrives
```

最终数据库必须保持 revision 8 completed/full：

- revision 6 被拒绝；
- 重复 revision 8 幂等；
- stale captureId 被拒绝；
- terminal 不回退；
- text 与 Markdown 来自同一 revision；
- terminal update 未携带正文时保留 revision 7 的正文；
- reducer 决策发生在 Dexie 事务内。

pending turn buffer 也必须按最高 revision 合并，不能按消息最后到达时间覆盖。

## 6. 转录与剪贴板验收

- Session、latest turn、single provider、open providers 等所有转录范围都读取 terminal/partial 正文。
- Markdown 标题、段落、列表、代码 fence、表格、链接和 emoji 保持。
- mock `navigator.clipboard.writeText` 收到的参数与 artifact 逐字符相等。
- fallback textarea 收到的 value 与 artifact 逐字符相等。
- 只有标题但没有回答时，UI 明确提示范围内没有可用回答，不显示复制完整回答成功。
- partial 回答被复制时正文保留，并带有“采集尚未完成”的状态说明。
- 接近或超过 2 MB 时有明确结果；不得通过 slice 或 schema rejection 静默变短。

## 7. Provider fixture 矩阵

DeepSeek 为合并阻断项，其他 provider 可分批迁移，但迁移一个就必须覆盖：

| 场景                       | DeepSeek | Qwen   | Kimi   | ChatGPT | Claude |
| -------------------------- | -------- | ------ | ------ | ------- | ------ |
| 普通 Markdown              | 必须     | 必须   | 必须   | 必须    | 必须   |
| 多 content block           | 必须     | 必须   | 必须   | 必须    | 必须   |
| 深度思考与 final 分离      | 必须     | 必须   | 必须   | 适用时  | 必须   |
| 搜索/tool 状态排除         | 必须     | 必须   | 必须   | 必须    | 必须   |
| 人工停止保留 partial       | 必须     | 必须   | 必须   | 必须    | 必须   |
| root wholesale replacement | 必须     | 必须   | 必须   | 必须    | 必须   |
| virtual empty mount        | 必须     | 适用时 | 适用时 | 必须    | 必须   |
| stable key/fallback key    | 必须     | 必须   | 必须   | 必须    | 必须   |

fixture 必须来自脱敏的真实 DOM 结构或对真实结构忠实压缩，不能全部是单 div 手写模型。

## 8. 真实 DeepSeek smoke

使用专用测试账号、低频执行，提示词包含可机器验证的 sentinel：

- 120 行编号输出；
- 第 60 行 `MID-SENTINEL`；
- 第 120 行 `END-SENTINEL`；
- 至少一个标题、列表、代码块和 emoji。

每次运行验证四个边界：

1. provider frame 最终 DOM snapshot；
2. `PROVIDER_RESPONSE_UPDATE` terminal revision；
3. IndexedDB exchange；
4. 复制 artifact。

四处都必须包含首行、中间 sentinel、末尾 sentinel，Markdown 结构存在，正文长度没有逆向下降。

另外执行：

- 普通模式；
- 深度思考/搜索模式；
- 人工停止；
- 标签页短暂后台；
- panel 最大化再恢复；
- SPA URL 变化或 frame reload。

真实站点 smoke 失败时输出 selector tier、revision、长度、生成信号和 terminal reason，不输出 prompt/回答正文。

## 9. 性能与安全验收

- active turn streaming 时 observer 触发频繁也不会为每个 token 同步运行 Turndown。
- 长回答期间主线程没有持续全 document 扫描；poll 只读受控 conversation scope。
- observer、timer、rAF、port listener 在 terminal/pagehide 后全部清理。
- 不新增 cookies 权限或 `<all_urls>`。
- 不读取 Cookie、localStorage token、站点 IndexedDB 或私有 API。
- 不 hook fetch/WebSocket/clipboard/closed attachShadow。
- diagnostics 不含 prompt、回答正文、token 或无盐正文 hash。
- 外部借鉴代码符合许可证；AGPL 项目只借鉴公开思路，不复制实现。

## 10. 完成定义

本 change 只有在以下条件全部满足时才可标记完成：

1. 精确回归 fixture 在旧实现失败、新实现通过。
2. DeepSeek fixture 全矩阵通过。
3. protocol、buffer、Dexie 乱序 revision 测试通过。
4. transcript/clipboard 逐字符端到端测试通过。
5. typecheck、lint、unit、coverage、build 和扩展 E2E 通过。
6. 至少两次真实 DeepSeek 120 行 smoke 完整通过，其中一次包含后台/布局切换。
7. 人工停止保存 partial 正文且不出现“已停止”替换正文。
8. 诊断信息足以区分 selector miss、candidate lock、提前 terminal、navigation abort 和 reducer reject。

“把 quiet 时间调长后暂时没复现”不算完成；“历史里有一点内容”也不算完成。验收对象是可证明的 canonical 最终快照和单调持久化结果。
