# 验收标准

日期：2026-09-01

## 自动化门禁

| ID          | 场景                           | 预期                                      |
| ----------- | ------------------------------ | ----------------------------------------- |
| CORE-01     | 新 target 正在生成             | 不点击 Copy，不上报正文                   |
| CORE-02     | target 内容短暂停顿            | 未达到 Provider 稳定窗口时不完成          |
| CORE-03     | 终态 Copy 成功                 | 只返回 `native-copy` 正文                 |
| CORE-04     | Copy 超时/无写入               | failed，无 DOM 正文                       |
| CORE-05     | 响应 deadline                  | timeout，无 DOM 正文                      |
| CORE-06     | 下一轮抢占上轮                 | 仅终态 native target 可 rescue            |
| CLIP-01     | 一次点击写入两次               | 选择信息最完整的 payload                  |
| CLIP-02     | Markdown/plain/html 同时存在   | Markdown 优先                             |
| CLIP-03     | active request 抑制写入        | 不改写用户系统剪贴板                      |
| CLIP-04     | 无 active request              | 官网 Copy 完整透传                        |
| MSG-01      | streaming + 正文               | schema 拒绝                               |
| MSG-02      | completed + DOM 正文           | schema 拒绝                               |
| MSG-03      | completed + native-copy + MIME | schema 接受                               |
| PROVIDER-01 | 历史与当前各有 Copy            | 只选 baseline 后当前 turn                 |
| PROVIDER-02 | 用户消息有 Copy                | 不选用户 Copy                             |
| PROVIDER-03 | 回复内代码块有 Copy            | 不选代码 Copy                             |
| PROVIDER-04 | Copy 隐藏到 hover              | prepare 后可定位并点击                    |
| PROVIDER-05 | 按钮 disabled                  | 不点击                                    |
| DEFAULT-01  | 全新工作区                     | 顺序为 DeepSeek、豆包、通义千问，全部选中 |
| DEFAULT-02  | 旧默认工作区                   | 一次迁移到新默认                          |
| DEFAULT-03  | 用户自定义工作区               | 升级后保持原布局和选择                    |
| HISTORY-01  | 会话详情                       | 只显示已持久化的最终正文，不模拟流式增长  |
| EXPORT-01   | 末轮/完整复制/Markdown         | 与数据库 native payload 一致              |

## Provider fixture 矩阵

- DeepSeek
- 豆包
- Kimi
- 通义千问
- ChatGPT
- Claude
- Coze
- MiniMax

每个目录必须至少有一个“当前 assistant turn + 回复 Copy + 代码 Copy/历史 Copy 干扰”的测试。

## 真实站点 smoke

真实账号环境分别验证：

1. 短回复。
2. 多段列表长回复。
3. 表格和多代码块回复。
4. 连续两轮，确认没有复制上一轮。
5. 复制结果与官网手动 Copy 逐字比较。
6. 用户原剪贴板在自动捕获后不变。

自动化环境没有站点登录态时，必须在发布说明中明确此残余验证边界，不能用 DOM fixture 冒充在线验证。
