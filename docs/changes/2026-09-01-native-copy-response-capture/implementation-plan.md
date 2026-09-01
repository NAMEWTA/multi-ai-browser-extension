# 原生 Copy 终态回复采集实施计划

日期：2026-09-01

状态：阶段 0-6 已实现并通过自动化验证；阶段 7 真实登录站点灰度验收待执行。

## 1. 实施顺序

### 阶段 0：冻结边界

- 确认本次只做当前轮终态捕获，不做历史批量导出。
- 确认不读取 Cookie、localStorage token，不调用站点私有 API。
- 确认不增加 clipboard read 权限，不真实覆盖用户剪贴板。
- 选择一个 Copy 行为可稳定复现的 provider 作为首个试点；其他 provider 默认关闭。

完成条件：代码评审者可以从接口和目录结构确认以上边界，不能通过通用 selector 自动启用所有站点。

### 阶段 1：完善 core 契约

涉及文件：

- `src/core/providers/contracts.ts`
- `src/core/providers/native-copy.ts`
- 相应 core 单元测试

任务：

- 固化 `NativeCopyClient`、`NativeCopyAdapter`、request/payload/MIME 契约。
- 为 `ProviderPlugin` 或 strategy 组装点增加可选 adapter。
- `ResponseCaptureUpdate` 支持 `captureSource` 和 `nativeMimeType`。
- `captureNativeResponse` 实现非空、MIME、长度退化、DOM 重叠和标题-only 校验。
- 所有失败返回 `undefined` 或结构化能力错误，不直接把状态提升为 completed。

完成条件：纯函数测试覆盖三种 MIME、短合法回答、长 DOM/短 native、标题-only 和 HTML 安全转换。

### 阶段 2：实现 MAIN-world runtime

建议文件：

- `src/entrypoints/native-copy-main.content.ts`
- `src/runtime/native-copy-client.ts`
- `src/runtime/native-copy-protocol.ts`
- 对应 runtime 测试

任务：

- MAIN content script 使用与 provider bridge 相同的 built-in matches、`allFrames: true`、`runAt: "document_start"`。
- 建立版本化、request-scoped 的 frame-local bridge。
- 实现 single-flight mutex。
- 在 `document_start` 安装默认透传的 `writeText` 和 `write` wrapper，支持 `ClipboardItem.getType()`。
- 默认抑制系统剪贴板写入。
- timeout、abort、pagehide 和 handler error 全部进入统一 `finally`。
- MAIN 和 isolated 两侧都设置有界超时，任何结束路径解除 armed token。
- isolated client 不接受不匹配 request/channel 的消息。

完成条件：无 active request 时 wrapper 完整透传；所有成功和失败分支都能证明 armed token、计时器和监听器已清理。

### 阶段 3：接入 provider bridge

涉及文件：

- `src/entrypoints/provider-bridge.content.ts`
- 必要的 provider registry/plugin 组装文件
- provider bridge 测试

任务：

- 为同 frame 的 `FrameContext` 注入 `nativeCopy` client。
- 把 `captureSource`、`nativeMimeType` 原样加入 response update 协议与有界诊断。
- 不在 background/workspace 重新执行 Copy 或读取页面 DOM。
- 保证一次 `captureId + turnKey` 只尝试一次。
- abort active capture 时同时取消 native request。

完成条件：跨 frame 更新仍遵守现有 captureId/revision 单调规则；native 失败不覆盖 DOM checkpoint。

### 阶段 4：BaseDomStrategy 终态编排

涉及文件：

- `src/core/providers/base-dom-strategy.ts`
- `src/core/providers/base-dom-strategy.test.ts`

任务：

- 只在 canonical final snapshot 和终态证据成立后调用 native adapter。
- 调用前按稳定 `turnKey` 重新绑定 root，并验证 `isConnected`。
- native 成功：使用其 text/Markdown 生成 terminal update。
- native 不可用或失败：沿用 DOM completed；若 DOM 终态仍不确定则 partial。
- observer callback 和 streaming poll 中禁止点击 Copy。
- root 被替换、虚拟卸载或定位歧义时禁止复制其他 turn。

完成条件：测试能证明 streaming 期间零点击、terminal 最多一次、错轮次零点击、失败保持最佳 DOM snapshot。

### 阶段 5：首个 provider adapter

目标目录：

```text
src/providers/<pilot>/
  native-copy.ts
  native-copy.test.ts
```

任务：

- 只使用当前 assistant root 内的稳定 `data-*`、ARIA、按钮动作组相对关系。
- 排除用户 Copy、代码块 Copy、分享、重试、反馈和隐藏 duplicate。
- `isReady` 验证可见、启用、归属当前 turn，且站点不再生成。
- `prepareCopy` 不调用 `scrollIntoView`、不改滚动位置、不展开历史。
- normalize 只处理已知固定包装，不做语言相关的激进删除。
- 用脱敏 fixture 覆盖完整多段、代码、表格、公式、短回答和中断回答。

完成条件：adapter 不在 core 留下任何站点 selector；禁用 adapter 后所有原有测试仍通过。

### 阶段 6：协议、持久化和 UI 回归

任务：

- 检查 messaging schema 是否保留 `captureSource/nativeMimeType`；未知旧字段仍向后兼容。
- reducer 继续按 captureId/revision 拒绝陈旧更新。
- transcript 和“复制完整对话”仍只读取持久化 terminal/partial，不在用户点击导出时重新操作 provider 页面。
- UI 可在诊断视图显示 source，但不向普通历史卡片加入实现说明。
- 大 payload 超过协议上限时明确 partial/failed，不能静默截断。

完成条件：native terminal 到 IndexedDB、详情、Markdown transcript 和最终用户 clipboard 的正文逐字一致。

### 阶段 7：真实站点灰度

- Chrome stable，真实登录态，手动触发一个 provider。
- 覆盖普通文本、标题加列表、代码块、表格/公式、人工停止和快速连续两轮。
- 对照官网原生 Copy、扩展持久化正文和最终 transcript。
- 检查捕获前后的用户剪贴板没有变化。
- 检查页面自身 Copy 在扩展捕获后仍正常工作。
- 记录 selector 版本、浏览器版本、站点 URL 模式和不含正文的诊断。

完成条件：首个 provider 全部通过后才能为第二个 provider 增加 adapter。

## 2. 测试策略

### 单元测试

- protocol request/response 关联与伪造消息忽略。
- `writeText`、`write`、MIME 优先级。
- resolve/reject/timeout/abort 的 armed 状态清理与 isolated `finally` cancel。
- single-flight 和 session 熔断。
- native payload 校验与 HTML 安全转换。

### Fixture 测试

- Copy 按钮属于当前 assistant turn。
- 用户 Copy、代码 Copy、隐藏 duplicate 不命中。
- root replacement 后同 key 重绑定。
- root 虚拟卸载时放弃，不点击其他 turn。

### 集成/E2E

- DOM streaming update 先到，native terminal 后到并成为最高 revision。
- native 失败时 DOM best snapshot 保持不变。
- terminal 之后旧 DOM streaming revision 不能回退正文。
- 最终 transcript 不再只有标题。

## 3. 发布与回滚步骤

1. adapter 默认只为试点 provider 注册。
2. 先运行 targeted tests、typecheck、lint、format check、build 和 E2E。
3. 完成一次真实站点 smoke 后再进入常规构建。
4. 观察 native-copy timeout、invalid 和 restore-failed 诊断比例。
5. provider selector 漂移时只移除对应 adapter。
6. 出现默认透传失败或页面 Copy 回归时禁用整个 runtime client。

回滚不涉及数据库迁移；已保存的 `captureSource` 是可选字段，旧版本可忽略。

## 4. 建议验证命令

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

实际文件名变更时使用仓库最终测试路径，但不得跳过 MAIN-world restore、错轮次和真实站点 clipboard 回归。

## 5. 停止条件

出现以下任一情况，停止该 provider 的 rollout：

- clipboard 方法无法可靠恢复。
- 捕获动作修改用户系统剪贴板。
- Copy 需要自动滚动、展开全部历史或批量点击。
- selector 无法区分当前回答 Copy 与代码块/用户 Copy。
- 站点要求读取 token、Cookie 或调用私有 API 才能完成。
- 捕获窗口出现不可消除的用户复制竞态。
- 只有标题或明显缺段的 native payload 仍被接受为 completed。
