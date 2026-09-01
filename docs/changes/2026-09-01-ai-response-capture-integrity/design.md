# AI 回复采集完整性设计

日期：2026-09-01

## 1. 目标与非目标

### 目标

- 官网已显示完整回答时，历史和复制结果不得只剩标题、首段或状态文字。
- “已完成”必须表示采集器拥有足够的终态证据，而不仅是当前 DOM 暂时安静。
- assistant turn 的临时 root 被替换或保留时，采集器可以升级到更可信的 final root。
- 同一 assistant turn 的多个正文 block 按文档顺序完整聚合，不重复、不混入 thinking、搜索过程和工具栏。
- 旧 streaming 消息、断线重发或并发 IndexedDB 写入不能覆盖新 revision 或 terminal 结果。
- 保持当前权限和隐私边界，不读取站点会话凭据和私有接口。

### 非目标

- 不在正常实时采集过程中自动滚动整段历史。
- 不实现 DeepSeek/ChatGPT/Claude 私有会话 API。
- 不注入 MAIN world 劫持站点 clipboard/fetch/WebSocket。
- 不承诺从未在本次运行中挂载、且此前没有持久化的虚拟历史消息可以被 DOM 恢复。
- 不用内容长度阈值否定合法的一字回答；短内容是否有效必须由结构和终态证据判断。

## 2. 完整性不变量

实现必须满足以下不变量：

1. `completed` 不能由 `nonEmpty && quiet` 单独产生。
2. 同一 `turnKey` 的更高 tier candidate 可以替换仍连接的低 tier candidate。
3. 临时空节点不进入永久 seen 集合；填充后仍可采集。
4. UI status 只影响状态，不作为 answer payload。
5. 每个 revision 都是从单次 clone 生成的 text/Markdown 原子快照。
6. reducer 只接受当前 `captureId` 的更高 revision。
7. terminal revision 不能回退到 waiting/streaming，也不能被旧短快照覆盖。
8. abort、timeout、navigation 和人工停止保留最后一个有效快照，状态为 `partial`，不伪装 `completed`。
9. transcript 使用的响应必须与数据库中的 terminal revision 一致；复制层不自行重新抓 DOM。

## 3. Provider 采集契约

现有扁平 `responses/responseContent/responseExclude/generating` 需要演进为可表达优先级的契约。示意接口：

```ts
interface ResponseCapturePlan {
  turnTiers: readonly SelectorTier[];
  finalContainers: readonly string[];
  contentBlocks: readonly string[];
  exclude: readonly string[];
  statusOnly: readonly string[];
  generating: readonly string[];
  terminalAttributes: readonly string[];
}

interface SelectorTier {
  id: string;
  selectors: readonly string[];
  confidence: "canonical" | "semantic" | "fallback";
}
```

规则：

- `turnTiers` 按 tier 选择：canonical tier 有结果时不允许 fallback tier 产生独立 turn。
- 同一 tier 内 selector 是 union，不按“第一个命中即返回”。
- `finalContainers` 定位最终回答容器；一个容器可以包含多个 block。
- `contentBlocks` 收集全部正文 block，消除父子重复后按 `compareDocumentPosition` 排序。
- 如果同时存在可信完整 container 和 block union，二者都生成候选快照，由结构质量选择器决定，不按 selector 下标决定。
- `statusOnly` 和 `exclude` 基于 DOM 结构排除按钮、反馈栏、停止徽标、thinking、search/tool 过程；不使用“已停止”等自然语言全局黑名单，避免误删合法回答。

DeepSeek 首期契约应以 `[data-virtual-list-item-key]` 或稳定 message ID 所在 assistant turn 为 canonical root，以 `.ds-assistant-message-main-content` 为 final container，`.ds-markdown` 只是 container 内的 block。hashed class 只能作为明确标注的 fallback。

## 4. 候选发现与升级

### 4.1 身份与候选分离

`turnKey` 表示“这是哪一轮回答”，`candidateId` 表示“当前用哪个 DOM 视图读取该轮”。两者不能继续混为一个 `selectedKey`。

```ts
interface ResponseCandidate {
  turnKey: string;
  candidateId: string;
  tier: number;
  root: HTMLElement;
  source: "container" | "block-union" | "turn-fallback";
  blockCount: number;
  text: string;
  markdown: string;
  textLength: number;
  markdownLength: number;
  statusOnly: boolean;
}
```

`turnKey` 优先使用 provider message ID、virtual item key、data-turn/data-chat 等稳定属性。没有稳定 ID 时使用提交基线、DOM 相对关系和本轮首次发现序号形成仅在本次 capture 内有效的 key，不用正文 hash 作为唯一身份，因为流式正文持续变化。

### 4.2 候选选择

候选质量按结构比较，不简单取最长 `textContent`：

1. final container 高于 turn fallback。
2. canonical tier 高于 semantic/fallback tier。
3. 非 status-only 高于 status-only。
4. 已通过 exclude 清洗且包含多个语义 block 的候选高于只含标题的候选。
5. 同级时，覆盖更多不重复可见正文的候选优先。
6. `textContent` 中隐藏 thinking/工具文本不能为候选加分。

当同一 `turnKey` 出现更高质量 candidate 时立即 promote，即使旧 candidate 仍连接。DOM wholesale replacement 后按 `turnKey` 重绑定，不能持有失联 element。

### 4.3 快照累积

每次 observer/poll 只标记 dirty；在 debounce 后执行一次完整读取。每个有效快照产生递增 revision。

同一 candidate 的流式扩展通常满足旧正文是新正文前缀，此时直接接受。对于 Markdown hydration、引用回填或 React 重写导致的非前缀变化：

- streaming 阶段保留最新快照，同时在内存保存 `lastNonEmptySnapshot` 和 `bestStructuralSnapshot`；
- 更短且结构质量更低的瞬态快照不能替换 best；
- explicit terminal 后执行 final re-read，连续两次相同的 canonical snapshot 才可成为 terminal payload；
- 如果 final snapshot 与 best 不一致且无法证明是等价重写，状态降为 `partial` 并保留质量更高的正文，不静默丢字。

`text` 与 `markdown` 必须从同一个 detached clone 生成。协议可以携带只用于进程内完整性核对的 digest，但诊断日志不记录正文或可离线猜测的无盐内容 hash。

## 5. 完成状态机

```text
awaiting-turn
  -> streaming
  -> settling
  -> completed
  -> partial (timeout | abort | navigation | interrupted | uncertain-final)
  -> failed  (没有任何有效正文)
```

### 5.1 awaiting-turn

只有出现 baseline 之后的新 `turnKey`，或 baseline 最后一轮发生可证明属于本次提交的身份/正文变化，才进入 streaming。历史 reindex、旧状态徽标和 thinking-only 节点不能启动最终回答。

### 5.2 streaming

任一信号可证明仍在生成：

- adapter 指定的 stop control 可见；
- `aria-busy=true`、`data-state=loading` 或 adapter 的 scoped signal；
- canonical answer 快照仍在变化；
- final container 尚未出现但本轮只有 reasoning/tool 阶段。

observer 必须按 adapter 声明观察有限的状态属性，包括 `aria-busy`、`data-state`、稳定 turn key 属性和必要 class 变化。poll 继续作为 observer 漏报的兜底。

### 5.3 settling

进入 settling 至少需要有效 canonical candidate。优先终态证据：

1. 曾看到 generating，随后 stop 消失/send 恢复或 busy 明确变为 false。
2. adapter 提供明确 final/complete 属性。
3. 没有可用控件时，新 turn 身份、final container、composer 恢复和多次稳定快照形成组合证据。

从未看到 generating 时，只出现标题、单 block 或 fallback root 不允许直接 completed。组合证据不足时可继续等待到 deadline，最终保存为 `partial: uncertain-final`。

进入 terminal 前执行：

```text
microtask drain
  -> double requestAnimationFrame（带 timer 上限，后台页不得无限等待）
  -> 250-500 ms final settle
  -> canonical rebind
  -> two identical structural snapshots
```

固定 quiet 时间仍可用于 settling，但只是条件之一，不是完成证明。

### 5.4 interrupted/abort/navigation

人工停止与网络错误的 UI 文字不进入正文。只要已有有效快照：

- 返回 `partial`；
- 保留 text/Markdown；
- terminal reason 记录 `interrupted`、`aborted`、`navigation` 或 `timeout`。

没有正文时才返回 failed/timeout。pagehide 或 frame reload 至少先发送 checkpoint；后续是否恢复同一 capture 由实施阶段验证，不能用空 terminal 覆盖 checkpoint。

## 6. Revisioned 传输与持久化

回复更新扩展为：

```ts
interface ResponseCaptureEnvelope {
  captureId: string;
  revision: number;
  observedAt: string;
  status: ResponseStatus;
  terminalReason?: TerminalReason;
  text?: string;
  markdown?: string;
  textLength?: number;
  markdownLength?: number;
  sourceTier?: string;
  turnKey?: string;
}
```

约束：

- `captureId` 在一次 commit 启动采集时生成，不能跨 turn 复用。
- revision 从 1 严格递增；waiting 可以是 0。
- background 验证 schema 和 frame 身份后原样转发，不重排、不合并正文。
- Workspace 的 pending buffer 按 `(turnId, panelId, captureId)` 保存最高 revision，而不是最后到达对象。
- `applyResponseUpdate` 在单个 Dexie 事务内比较 persisted revision；低 revision、不同 captureId 的陈旧更新、terminal -> streaming 回退全部忽略。
- terminal update 没带正文时保留已存的最高有效正文；带正文但结构质量异常降低时不得无条件覆盖。
- 只有 reducer 接受更新后才刷新 turn 聚合状态。

数据库记录至少增加 `captureId`、`responseRevision`、`terminalReason`。`sourceTier/turnKey/长度` 可进入有界诊断，不保存 selector 命中的原始正文。

## 7. 转录与复制完整性

复制继续只读取持久化数据，但增加端到端不变量测试：

- terminal exchange 的 Markdown 长度与转录中该回答正文逐字一致；
- `# 会话标题` 不能被当作“包含回答”的成功导出；
- response 为 partial 时转录保留正文并附带状态说明；
- clipboard adapter 接收到的字符串长度与 artifact 长度一致；
- 2 MB 协议上限附近必须显式失败或 partial，不能静默截断。

无需通过读取系统剪贴板来证明每次复制；自动化测试可以 mock `writeText` 并逐字节断言参数。

## 8. 诊断与隐私

为定位真实站点 selector drift，每个 revision 记录不含正文的诊断字段：

- provider、panel、turn/capture ID；
- selector tier ID、root descriptor、candidate source；
- text/Markdown 长度、block count、revision；
- generating signals、quiet duration、candidate promotion 次数；
- terminal reason、pending empty node 数、root replacement 次数；
- protocol/reducer 接受或拒绝原因。

不得记录 prompt、回答正文、Cookie、token、站点 storage 或私有接口响应。用于消息完整性比较的 digest 不写持久诊断。

## 9. 降级原则

- 找到正文但终态不确定：`partial`，绝不 `completed`。
- 只找到状态 chrome：继续等待；deadline 后 failed/timeout。
- 只有 fallback root：可以上报 streaming preview，但没有组合终态证据时只能 partial。
- selector drift：保留已有最佳快照，输出明确 diagnostics。
- Markdown 转换失败：使用同一 clone 的纯文本 partial，不返回空字符串。

这会让少数过去被乐观标为 completed 的回复显示“部分回复”，但这是正确的风险偏好：完整性未知必须可见，不能继续静默丢失数据。
