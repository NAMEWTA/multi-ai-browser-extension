# 原生 Copy 终态回复采集设计

日期：2026-09-01

## 1. 设计原则

### 1.1 双通道而非替换

```text
提交问题
  -> DOM baseline / 新 turn 归属
  -> DOM waiting / streaming checkpoints
  -> DOM 终态证据成立
  -> 当前 turn 原生 Copy 捕获一次
       -> 校验通过：native-copy 成为终态权威正文
       -> 不可用/失败：保留 DOM terminal 或 partial
  -> revisioned update 持久化
```

DOM 通道持续工作，原生 Copy 不参与逐 token 更新。这样可以同时满足：

- 即使原生 Copy 不可用，超时和导航前仍有 partial checkpoint。
- 站点 Copy 只触发一次，不随每个 mutation 重复点击。
- 原生结果只能覆盖同一个 `turnKey` 的终态正文，不能改变轮次归属。

### 1.2 权威性的含义

“权威”表示站点原生 Copy 是该轮最终内容的首选序列化结果。v2 允许 provider 的原生 Copy 目标本身参与证明终态，但必须同时满足：

- 当前 assistant turn 已从 baseline 后产生或发生可证明的本轮更新。
- Copy 按钮严格归属于该 assistant turn，不是用户消息或代码块按钮。
- generating 信号不存在，且同一 turn/button 节点连续两次观察稳定至少 250ms。
- turn key 和活 DOM 节点均未落入提交前 baseline。

canonical/final DOM container 仍是优先的流式与降级证据，但不再是启动原生 Copy 的硬前置条件。否则正文 selector 一旦漂移，原生 Copy 也无法救援，系统会重现“官网已经完整回复、扩展仍等待或只保存标题”的故障。

若按钮仍未就绪、捕获超时、输出为空或完整性校验失败，原生通道不得把状态从 partial/uncertain-final 提升为 completed。

当 provider 已证明 Copy 目标终态但捕获失败时，状态必须立即收敛：有该轮 DOM 正文则保存为 `partial`，无正文则标记 `failed`。不得继续维持 `waiting` 直到十分钟总超时。

## 2. 契约

通用契约保持在 `src/core/providers/contracts.ts`：

```ts
interface NativeCopyClient {
  capture(request: NativeCopyRequest): Promise<NativeCopyPayload>;
}

interface NativeCopyAdapter {
  id: string;
  locateCopyButton(ctx: FrameContext, response: HTMLElement): HTMLElement | undefined;
  prepareCopy?(ctx: FrameContext, response: HTMLElement, button: HTMLElement): Promise<void>;
  isReady?(ctx: FrameContext, response: HTMLElement, button: HTMLElement): boolean;
  normalize?(payload: NativeCopyPayload, context: NativeCopyContext): NativeCopyPayload;
}
```

职责边界：

- `NativeCopyClient` 只负责 MAIN-world arm/cancel 请求、点击、捕获和超时；MAIN bridge 负责提前 wrapper 与默认透传。
- `NativeCopyAdapter` 只负责 provider DOM：定位按钮、必要的无滚动准备、就绪判断和站点格式规范化。
- `captureNativeResponse` 只负责编排、完整性校验和构造 `ResponseCaptureUpdate`。
- `BaseDomStrategy` 仍负责 turn 身份、终态证据、DOM snapshot 和 fallback。

`ResponseCaptureUpdate` 需要携带：

```ts
captureSource?: "dom" | "native-copy" | "provider-api";
nativeMimeType?: "text/markdown" | "text/plain" | "text/html";
```

`provider-api` 只预留枚举，不在本 change 实现。

## 3. Provider 目录规范

provider 专属逻辑必须留在 `src/providers/<provider>/`，目标布局为：

```text
src/providers/<provider>/
  definition.ts          # 名称、URL、embed 能力
  selectors.ts           # composer/submit/turn/content/generating 等 DOM 契约
  native-copy.ts         # 可选：Copy 按钮定位、就绪判断、normalize
  native-copy.test.ts    # 可选：脱敏 fixture 与错轮次防护
  strategy.ts            # provider 的提交/采集编排特例
  strategy.test.ts
  index.ts               # 只组装并导出 ProviderPlugin
```

规则：

- 没有稳定原生 Copy 能力的 provider 不创建空 adapter。
- Copy selector 可以声明在 `native-copy.ts` 内，或从 `selectors.ts` 导出有明确命名的 `nativeCopy` 分组；禁止混入通用 `responses` union。
- `native-copy.ts` 不访问 `browser.runtime`，不实现跨 world 协议，不保存状态。
- core 不出现 `.ds-*`、Claude `data-testid`、Gemini custom element 等站点 selector。
- `index.ts` 负责把 definition、strategy 和可选 adapter 组装为插件，registry 继续通过 `/src/providers/*/index.ts` 自动发现。
- 每个 adapter 必须以 assistant turn root 为查询范围，不能 `document.querySelector` 后取页面第一个或最后一个 Copy。

建议让 `ProviderPlugin` 增加只读可选字段：

```ts
interface ProviderPlugin {
  definition: ProviderDefinition;
  nativeCopy?: NativeCopyAdapter;
  createStrategy(): ProviderStrategy;
}
```

若实施时选择由 strategy 构造器接收 adapter，也必须维持相同目录和职责边界，不能把站点逻辑塞进 `BaseDomStrategy`。

## 4. MAIN-world bridge

### 4.1 运行结构

新增两个运行时角色：

```text
provider-bridge.content.ts (ISOLATED, all frames)
  -> NativeCopyClient
  -> 有界 CustomEvent/window message 请求

native-copy-main.content.ts (MAIN, all frames, document_start)
  -> 提前安装默认透传的 clipboard.writeText/write wrapper
  -> 监听 frame-local arm/cancel 请求
  -> armed 时捕获下一次站点 clipboard write
  -> 返回 payload 或结构化错误
  -> 解除 armed；页面卸载或显式 uninstall 时恢复原 descriptor
```

MAIN 脚本不使用 extension runtime API。桥接消息只在当前 frame 的 `window` 内传输；请求不得路由到顶层 frame 再反查按钮。

### 4.2 请求关联

请求至少包含：

- 固定且版本化的 DOM event 名称。
- 随机一次性 `token`。
- 超时上限。
- 是否抑制真实系统剪贴板写入。

响应必须匹配当前 active token。按钮仍由 isolated client 持有并只在收到 `armed` 后点击，不把 DOM selector 或节点标识传入 MAIN world。一次 frame 只允许一个 active request；第二个请求立即返回 `busy`。

页面脚本理论上可以观察或伪造同一页面事件，因此 bridge 不传输扩展秘密，也不把事件响应直接当作 provider update。isolated 侧仍需用当前 `turnKey`、DOM snapshot 和 adapter 校验捕获内容。

### 4.3 提前 wrapper 与短时 armed

执行顺序：

1. `document_start` 保存 `writeText`、`write` 的原始引用和 property descriptor，并安装保持正确 `this` 语义的 wrapper。
2. 无 active token 时 wrapper 完整调用原方法，不观察或改变用户手动 Copy。
3. isolated client 发送 arm，MAIN bridge 设置互斥 token 和独立超时，返回 `armed`。
4. isolated client 点击当前 provider adapter 已确认的回答 Copy 按钮。
5. armed wrapper 捕获第一次有效 write；`suppressSystemClipboard=true` 时不调用原方法。
6. 对 `ClipboardItem[]` 按 `text/markdown`、`text/plain`、`text/html` 的优先级读取 Blob。
7. 成功、失败、超时、abort 或 cancel 都解除 active token；页面卸载或测试 uninstall 时恢复 descriptor。

必须覆盖以下异常：

- clipboard 对象或方法不存在。
- 属性不可写/不可配置。
- 站点 handler 抛错。
- 点击后没有发生写入。
- `ClipboardItem.getType()` 拒绝。
- request timeout、AbortSignal、frame unload。
- wrapper 被站点重新覆盖或 descriptor 无法安装。

### 4.4 不改动用户剪贴板

默认 `suppressSystemClipboard=true`。wrapper 捕获站点准备写入的内容后直接 resolve，不调用原始 clipboard 方法。因此无需申请 clipboard read 权限，也不需要读取、缓存或恢复用户原剪贴板。

如果某站点只有在真实 write resolve 后才完成内部状态，adapter 必须先通过真实站点验证；不得默认关闭 suppress。任何允许真实写入的例外都需要单独 UX 和权限评审，不在首期范围。

## 5. 逐轮终态调用

原生捕获挂在 `finalizeResponse` 或 `BaseDomStrategy` 的 terminal finalize 阶段，不能放进 observer callback。

调用前重新按 `turnKey` 绑定当前 root：

- root 仍连接且 key 相同：继续。
- root 被 React 替换：重新定位同 key canonical turn。
- key 不存在或定位到多个不可判定候选：放弃原生 Copy，保留 DOM partial。
- turn 已被虚拟列表卸载：不滚动恢复，保留此前 DOM checkpoint。

每个 `captureId + turnKey` 记录 `nativeCopyAttempted=true`，无论成功失败均不得在相同终态循环中重复点击。仅显式用户重试可以创建新 capture 并再次尝试。

## 6. 内容与完整性校验

MIME 优先级：

1. `text/markdown`
2. `text/plain`
3. `text/html`

规则：

- `text/markdown` 原样规范化换行并 trim，不重新 Turndown。
- `text/plain` 同时作为 text 和 Markdown fallback，保留换行。
- `text/html` 必须经过现有安全 HTML-to-Markdown 或纯文本转换，禁止直接持久化为可执行 HTML。
- adapter 可以移除站点固定前后缀，但不能按自然语言猜测并删除任意内容。

校验不能只依赖固定最小长度，因为合法回答可能很短。组合校验至少包括：

- payload 非空，且不是 Copy 成功提示、按钮标签、模型名或用户 prompt。
- 捕获按钮属于当前 assistant turn。
- 与最终 DOM snapshot 存在合理的规范化文本重叠；允许原生 Markdown 比 DOM text 更长。
- 当 DOM 正文较长时，native payload 不能灾难性缩短；默认阈值可采用 DOM 长度的保守比例并设置上限。
- 原生输出只有标题、而 DOM 已有多段正文时，判定失败。
- 输出超过扩展消息上限时明确返回 partial/too-large，不能截断后 completed。

校验通过后返回 `captureSource: "native-copy"` 和 `nativeMimeType`。校验失败不覆盖 `bestStructuralSnapshot`。

## 7. 虚拟列表与 API 边界

本设计只操作当前新生成且仍挂载的 assistant turn：

- 不向上滚动加载旧消息。
- 不批量点击历史 Copy。
- 不因页面最后一个按钮存在就假定它属于当前 turn。
- 不从 clone 中寻找按钮；事件必须作用于活 DOM 元素。

旧 turn 若已卸载，只能依赖本项目在生成时保存的 revision。完整历史补采需要 provider API 或主动逐屏累计，但它们会引入登录凭据、站点条款、页面扰动和分支恢复问题，必须另建 change/ADR。

## 8. 状态、诊断与持久化

原生 Copy 不增加新的用户可见状态，沿用现有 completed/partial/failed。诊断增加：

- `native-copy-start`
- `native-copy-unavailable`
- `native-copy-busy`
- `native-copy-timeout`
- `native-copy-captured`
- `native-copy-invalid`
- `native-copy-restore-failed`
- provider、adapter ID、turn descriptor、MIME、payload length、duration

诊断不得记录正文、HTML、clipboard 内容、用户原剪贴板或按钮完整 `innerHTML`。持久化正文仍通过现有 revision reducer；同一 terminal revision 中 native payload 取代 DOM payload，但旧 revision 和其他 captureId 仍会被拒绝。

## 9. 风险与回滚

### 风险

- 站点改变 Copy 按钮结构或 clipboard 写入方式。
- 页面预先缓存原 clipboard 方法，导致 patch 捕获不到。
- 用户在极短捕获窗口内手动复制，产生竞态。
- hidden duplicate turn 的 Copy 被误点。
- wrapper 被站点覆盖或失去默认透传能力，影响页面后续复制。

### 缓解

- adapter 按当前 turn scoped lookup，并要求唯一可见按钮。
- single-flight、短超时、每轮一次。
- 捕获前后核对 turn key、root 连接状态和按钮归属。
- 默认抑制系统写入。
- 任一 restore 异常对当前 frame 熔断。
- rollout 先单 provider、单浏览器渠道，再逐站点启用。

### 回滚

- `nativeCopy` 是 provider 可选能力；移除该 adapter 即回到纯 DOM。
- MAIN bridge 没有 active request 时不 patch、不观察正文、不点击页面。
- 不新增数据库 schema，因此回滚不需要迁移或清理用户数据。
- 可按 provider 配置关闭，不影响其他 provider。
- 出现页面复制异常时，首先关闭对应 provider adapter；若是 bridge 共性问题，则禁用整个 native-copy client，保留 DOM terminal/partial。
