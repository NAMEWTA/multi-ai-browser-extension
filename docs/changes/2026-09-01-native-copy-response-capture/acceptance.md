# 原生 Copy 终态回复采集验收

日期：2026-09-01

## 1. 验收原则

- 原生 Copy 只增强当前轮终态正文，不替代 DOM streaming 和 revision 持久化。
- 自动化测试使用脱敏 fixture，不依赖真实账号或保存正文日志。
- 真实站点 smoke 只能在已授权登录态手动执行，不读取或导出凭据。
- 任一剪贴板恢复、错轮次、隐私或静默截断问题均为发布阻断项。

## 2. 自动化验收矩阵

| ID            | 场景             | 操作                                           | 预期结果                                        | 验证方式           |
| ------------- | ---------------- | ---------------------------------------------- | ----------------------------------------------- | ------------------ |
| CORE-01       | 无 adapter       | provider 不注册 native adapter                 | DOM 采集行为与当前版本一致                      | Unit               |
| CORE-02       | 无 client        | adapter 存在但 `FrameContext.nativeCopy` 缺失  | 不点击页面，回退 DOM                            | Unit               |
| CORE-03       | Markdown payload | 捕获 `text/markdown`                           | 原 Markdown 规范化换行后成为 terminal 正文      | Unit               |
| CORE-04       | Plain payload    | 捕获 `text/plain`                              | 保留全部换行，text/Markdown 均非空              | Unit               |
| CORE-05       | HTML payload     | 仅捕获 `text/html`                             | 安全转为 Markdown/纯文本，不持久化可执行 HTML   | Unit/Security      |
| CORE-06       | 标题-only        | native 只有标题，DOM 有多段正文                | native 校验失败，保留 DOM best snapshot         | Unit               |
| CORE-07       | 短合法回答       | DOM 与 native 都是合法短答                     | 不因固定长度阈值误拒绝                          | Unit               |
| CORE-08       | 灾难性缩短       | DOM 很长，native 只有首段                      | native 校验失败，不标记 native completed        | Unit               |
| CORE-09       | 过大 payload     | 捕获内容超过协议限制                           | 显式 partial/failed，绝不静默截断               | Unit/Protocol      |
| MAIN-01       | `writeText`      | 站点 Copy 调用 `navigator.clipboard.writeText` | 捕获完整字符串，原方法未执行                    | Unit/Integration   |
| MAIN-02       | `write`          | 站点 Copy 调用 `navigator.clipboard.write`     | 从 ClipboardItem 读取首选 MIME                  | Unit/Integration   |
| MAIN-03       | MIME 优先级      | 同一 item 含 Markdown、plain、HTML             | 选择 `text/markdown`                            | Unit               |
| MAIN-04       | 默认透传         | 捕获成功后再次手动 Copy                        | wrapper 调用原 clipboard 方法                   | Unit               |
| MAIN-05       | 异常清理         | click handler 抛错                             | 解除 armed，wrapper 恢复默认透传                | Unit               |
| MAIN-06       | 超时清理         | 点击后不写 clipboard                           | 到时失败并解除 armed，不重复点击                | Fake timer         |
| MAIN-07       | abort 清理       | 捕获中取消 turn                                | 请求结束并解除 armed，无悬挂 listener           | Unit               |
| MAIN-08       | pagehide         | frame 在捕获中卸载                             | 尽力取消并清理，没有后续响应污染新 frame        | Integration        |
| MAIN-09       | single-flight    | 同 frame 同时发两个请求                        | 第二个返回 busy，只有一次 armed/click           | Unit               |
| MAIN-10       | MAIN 超时        | isolated client 未发送 cancel                  | MAIN 独立解除 armed，下一请求可以成功           | Unit               |
| BRIDGE-01     | request 关联     | 注入错误 token 响应                            | isolated client 忽略                            | Unit               |
| BRIDGE-02     | frame 隔离       | 两个 provider iframe 同时运行                  | 每个请求只作用于自己的 frame                    | E2E                |
| BRIDGE-03     | 无 active 请求   | 页面正常运行                                   | wrapper 完整透传，不观察内容、不点击元素        | Integration        |
| TURN-01       | streaming 阶段   | 连续产生 DOM mutation                          | 原生 Copy 点击次数为 0                          | Strategy test      |
| TURN-02       | 终态阶段         | generating 结束且 final snapshot 稳定          | 当前轮原生 Copy 恰好执行 1 次                   | Strategy test      |
| TURN-03       | DOM 终态不确定   | 只有 fallback root/标题                        | 不执行或不接受 native completed，结果为 partial | Strategy test      |
| TURN-04       | root replacement | 原 root 失联，同 turn key 出现新 root          | 重绑定后只点击新 root 的 Copy                   | Fixture            |
| TURN-05       | root 卸载        | 当前 turn 从虚拟列表卸载                       | 不滚动、不点击其他 turn，保留 checkpoint        | Fixture            |
| TURN-06       | 快速连续两轮     | 第二轮启动时第一轮已 terminal                  | 两轮各自最多一次，正文不串写                    | Strategy/E2E       |
| TURN-07       | 旧 revision 晚到 | native terminal 后到达旧 DOM streaming         | reducer 拒绝回退                                | Store integration  |
| PROVIDER-01   | assistant scoped | turn 内同时有回答 Copy、代码 Copy              | 只命中回答 Copy                                 | Provider fixture   |
| PROVIDER-02   | 用户 Copy        | 页面含用户消息 Copy                            | 不命中                                          | Provider fixture   |
| PROVIDER-03   | hidden duplicate | 页面含隐藏回答副本                             | 不命中隐藏按钮                                  | Provider fixture   |
| PROVIDER-04   | disabled Copy    | Copy 按钮未就绪                                | 不点击，回退 DOM                                | Provider fixture   |
| TRANSCRIPT-01 | 端到端正文       | native terminal 被持久化后导出                 | transcript 回答与捕获 payload 逐字一致          | Integration        |
| TRANSCRIPT-02 | 原问题复现       | 会话标题为“你好”，回答为多段列表               | 导出不再只有 `# 你好`，完整回答存在             | Regression fixture |

## 3. 真实站点验收

每个启用 adapter 的 provider 单独执行以下矩阵：

| ID      | 场景            | 预期结果                                                       |
| ------- | --------------- | -------------------------------------------------------------- |
| LIVE-01 | 普通多段回答    | 官网原生 Copy、扩展历史、transcript 正文一致                   |
| LIVE-02 | 标题 + 有序列表 | 标题和全部列表项均保留                                         |
| LIVE-03 | 多代码块        | fence、语言标签、缩进和块顺序保留                              |
| LIVE-04 | 表格/公式/引用  | 站点 Copy 能提供的结构不被 DOM fallback 降级                   |
| LIVE-05 | 极短回答        | 合法短答可 completed，不被长度阈值误拒绝                       |
| LIVE-06 | 人工停止        | 保留已有正文并记录 interrupted/partial，不混入“已停止”状态文字 |
| LIVE-07 | 快速连续提问    | 每轮内容归属正确，不点击上一轮 Copy                            |
| LIVE-08 | 页面内手动 Copy | 扩展捕获完成后，用户再次使用站点 Copy 正常                     |
| LIVE-09 | 用户剪贴板保护  | 捕获前放置哨兵文本，捕获后哨兵仍存在                           |
| LIVE-10 | 长对话虚拟列表  | 不自动滚动；只保证本次新生成轮，UI 不声称补齐旧历史            |

真实站点记录只包含浏览器版本、provider、URL 模式、adapter 版本、MIME、长度、耗时和结果状态，不保存 prompt 或回答正文。

## 4. Provider 目录验收

- provider adapter 位于 `src/providers/<provider>/native-copy.ts`。
- provider selector 不出现在 `src/core/providers/native-copy.ts` 或 runtime bridge。
- adapter 查找范围绑定当前 assistant turn。
- provider `index.ts` 是唯一组装入口。
- 没有 native 能力的 provider 不创建占位 adapter。
- 每个启用 adapter 的 provider 均有脱敏测试。
- 删除单个 provider adapter 后，core/runtime 和其他 provider 无需修改即可构建。

## 5. 隐私与安全验收

以下全部必须满足：

- 不新增 clipboard read 权限。
- 默认不调用原始 clipboard write，不改变用户剪贴板。
- 不读取 Cookie、localStorage token、IndexedDB 登录态或页面私有网络响应。
- 不 hook `fetch`、XHR、WebSocket 或站点模块加载器。
- bridge 消息不包含扩展秘密，且只接受匹配 request/channel 的响应。
- 诊断不记录 clipboard payload、回答正文、HTML 或按钮完整 DOM。
- `text/html` 不直接进入可执行渲染路径。
- 不自动滚动、展开历史、批量点击或绕过挑战页面。

## 6. 性能与页面扰动验收

- 无 active request 时零 clipboard patch。
- 一轮终态最多一次 Copy click。
- 捕获超时默认不超过 2 秒，并受 AbortSignal 控制。
- 不改变 `scrollY`、会话容器 `scrollTop` 或当前焦点；若站点 click 自身改变焦点，应在 adapter smoke 中记录并评估。
- 不创建长期 MutationObserver；沿用现有 DOM 状态机触发 finalize。
- 捕获结束后临时属性、事件监听器和定时器全部清理。

## 7. 回归命令

至少执行：

```text
pnpm test -- src/core/providers/native-copy.test.ts
pnpm test -- src/core/providers/base-dom-strategy.test.ts
pnpm test -- src/providers/<pilot>/native-copy.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm e2e
```

真实站点 smoke 无法由普通 CI 替代。未完成首个 provider 的 LIVE-01、LIVE-08 和 LIVE-09 时，不得默认启用该 adapter。

## 8. 发布否决项

出现以下任一情况即验收失败：

- 任一异常分支导致 clipboard 方法未恢复。
- 扩展捕获覆盖或清空用户剪贴板。
- streaming mutation 触发重复 Copy。
- 点击错误 turn、用户消息或代码块 Copy。
- 捕获失败后仍把标题-only/首段-only 标记为 completed。
- 为补历史而读取凭据、调用私有 API 或自动滚动全部会话。
- 日志、协议诊断或错误上报包含回答正文或 clipboard payload。

## 9. 回滚验收

- 移除/关闭单个 provider adapter 后立即恢复纯 DOM 行为。
- 禁用 runtime client 后 provider 提交、DOM streaming、partial checkpoint、历史和 transcript 仍工作。
- 旧版本忽略可选的 `captureSource/nativeMimeType` 字段，不需要数据库回滚。
- 回滚后页面站点 Copy 行为与未安装原生捕获能力时一致。
