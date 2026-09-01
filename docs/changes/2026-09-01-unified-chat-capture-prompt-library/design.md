# 设计方案

## 1. 统一对话

### 1.1 桌面布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 会话标题 · N 轮                         复制/下载       关闭 │
├───────────────────────────────────────────┬──────────────────┤
│ 主时间线                                  │ 问题导航         │
│                                           │                  │
│ 第 1 轮                                   │ 01 问题摘要      │
│                  [用户问题]               │ 02 问题摘要      │
│ ▸ DeepSeek · 已完成                       │ 03 当前问题      │
│ ▸ Kimi · 已完成                           │                  │
│                                           │                  │
│ 第 2 轮                                   │                  │
│                  [用户问题]               │                  │
│ ▸ DeepSeek · 采集中                       │                  │
└───────────────────────────────────────────┴──────────────────┘
```

- 弹窗打开时 `activeTurnId = detail.turns.at(-1)?.turn.id`，只滚动弹窗自己的内容容器。
- 每个回答头是一个 disclosure button，始终显示 Provider、回复状态和展开图标。
- 所有 `aria-expanded` 初始为 `false`，正文只在展开后挂载，避免长历史一次解析大量 Markdown。
- 回答状态为 timeout/failed 时，折叠头已经能识别异常；展开后显示详情和已保存的 partial 内容。
- 右侧使用带可访问名称的 `nav`。按钮显示轮次编号和最多两行问题摘要，当前项设置 `aria-current="true"`。
- 用以详情滚动容器为 root 的 `IntersectionObserver` 更新当前导航项；点击导航通过稳定 `turn.id` 定位。
- `detail` 实时刷新时保留用户当前展开状态和 active turn；仅 Session 改变或对应 turn 消失时重置。

### 1.2 窄屏

宽度不足约 760 px 时，不强行保留右栏：

- 问题导航移动到标题下方，使用横向可滚动轮次条或紧凑 select。
- 主时间线保持单列。
- 代码块和表格只在回答正文内部横向滚动，不能撑宽整个弹窗。

### 1.3 Markdown 展示

新增独立 `MarkdownResponse` 组件：

- 新记录优先渲染 `responseMarkdown`。
- 旧记录没有 Markdown 时，继续用 `white-space: pre-wrap` 纯文本展示，避免把 `<tag>`、下划线或普通换行误解释成 Markdown。
- 支持 CommonMark 与 GFM 表格、删除线、任务列表和自动链接。
- 不解析原始 HTML；链接仅允许 `http/https/mailto`，新窗口打开时加 `noopener noreferrer`。
- 图片默认显示为带 alt 的外链，不在历史弹窗自动请求远程资源。
- 第一阶段只用 CSS 样式代码块，不加入语法高亮依赖。

## 2. 回复采集

### 2.1 Adapter 契约

把当前 `responses` 字符串数组扩为站点级回答契约：

```ts
interface ResponseLocator {
  profile: string;
  conversationRoots: readonly string[];
  assistantTurns: readonly string[];
  answerContents?: readonly string[];
  generating?: readonly string[];
  blocked?: readonly string[];
  stableKey?(element: HTMLElement): string | undefined;
  clean?(clone: HTMLElement): void;
}
```

通用内核负责状态机、observer、静默窗口、超时、快照和诊断；站点 adapter 只负责定位、稳定 key、清洗和少量特殊阶段判断。

千问至少区分 `qwen-domestic` 与 `qwen-international` profile。本项目当前只声明国内域名，不能为了“多兜底”把国际 selector 混入同一候选池，否则很容易在同页命中无关的隐藏结构。

### 2.2 状态机

```text
submitted
  -> waiting-for-turn
  -> streaming
  -> settling
  -> completed

任意阶段 -> blocked / failed
截止时间 -> partial（有快照）或 timeout（始终无正文）
```

完成判断按可靠性排序：

1. 站点明确生成控件已出现后稳定消失，且 answer content 已存在。
2. `aria-busy` 从 `true` 变为 `false`。
3. 站点阶段从 thinking/searching 转为 answer，answer 文本在配置的 quiet window 内稳定。
4. 没有显式信号时，较长 quiet window 作为 fallback。

生成标记短暂消失不能立即完成；Qwen 类思考模型需要 disappearance debounce。绝对截止时间应为 Provider 配置，不再由全站固定 180 秒决定。

timeout 分为三段：首个回答节点 deadline、流式 idle deadline、总时长 ceiling。selector 完全未命中时应尽早给出 `selector-miss` 诊断；长推理已经产生正文时，只在 idle 或 ceiling 到达后保存 partial。

### 2.3 轮次关联

提交前记录 baseline：现有 assistant turn 的稳定 key、元素身份和文本摘要。提交后只接受满足以下条件之一的候选：

- 出现 baseline 中不存在的新稳定 key。
- 新元素身份出现在已提交用户轮次之后。
- 同一占位 assistant turn 从空变为 answer 阶段，且变更发生在本次提交之后。

不能再把“全局最后一个回答文本变化”直接等价为本轮回答。

每个 panel 同时只能有一个 capture lease。下一轮发送前必须确认旧采集已 terminal；新会话、pagehide、导航或显式取消通过 AbortController 结束旧 lease，并将已有正文保存为 partial。这样两个快速 Turn 不会串写。

### 2.4 双格式快照

```ts
interface ResponseCaptureUpdate {
  status: ResponseCaptureStatus;
  text?: string; // 可搜索、兼容旧记录、错误兜底
  markdown?: string; // 清洗后的结构化正文
  message?: string;
}
```

`ProviderExchangeRecord` 增加可选 `responseMarkdown`。不增加索引，因此 Dexie 不需要仅为该字段升级 schema。`.maiw.jsonl` 继续使用当前版本并增加可选字段；旧文件可导入，新字段缺失时回退纯文本，旧客户端会忽略额外字段。

每次 streaming 更新采用最后快照覆盖，不存 token 事件流。转换前对 DOM clone 限制节点数和文本大小，达到上限时保存 plainText、标记 partial，并在诊断中记录原因。

### 2.5 诊断

新增不包含回答正文的有界诊断：

- adapter/selector 版本；
- conversation root、assistant turn、answer content 候选数量；
- baseline key 与最终选中节点描述；
- observer 重绑次数、mutation 次数、最后文本长度；
- stop/aria-busy/quiet-window 是否出现；
- timeout 原因：`selector-miss`、`root-replaced`、`no-mutation`、`never-settled`、`blocked`。

诊断不能保存 Cookie、HTML、用户问题或回答正文。

## 3. 页面扰动和风控

### 3.1 页面扰动修复

- 通用 `ButtonSubmitter` 默认只调用 `click()`；若某站点证明必须先聚焦，则调用 `focus({preventScroll:true})`。
- composer 写入同样不得调用会滚动的 focus；站点特例必须显式声明。
- 采集器不得调用 `scrollIntoView()`、`scrollTo()` 或修改会话容器 `scrollTop`。
- 增加开发诊断：动作前后记录 `activeElement` 描述、页面 `scrollY` 和最近滚动容器 `scrollTop`，只记录数值与元素描述。

### 3.2 风控停止条件

识别到以下任一条件立即终止该站任务并提示人工处理：

- 验证码、滑块或“异常访问”提示；
- HTTP 429 在可见页面上的提示；
- 登录失效；
- 页面明确拒绝第三方或自动化操作；
- 连续一次提交未确认后仍无状态变化。

`ProviderSelectors`/adapter 需要正式增加 `blocked` 定位和人工接管状态，`probe()` 的优先级是 blocked -> login -> composer。用户在官网完成验证后只能手动点击“重新检查”，不能由扩展持续探测并自动重试。

不得自动刷新、循环重试或改变指纹。其他站点只有在各自条款允许时，才启用有限次数、尊重 `Retry-After` 的恢复策略。

## 4. 提示词库

### 4.1 交互

全局 composer 调整为：

```text
[发送至 2/3] [提示词 2] [本次问题输入........................] [发送]
```

点击“提示词 2”打开选择 popover：

- 搜索提示词；
- checkbox 多选；
- 显示名称和一行内容摘要；
- “管理提示词”进入管理对话框；
- “预览实际发送内容”展示只读合成结果和字符数。

管理对话框使用紧凑列表，不嵌套卡片：新增、编辑、删除、上移、下移。删除已选模板时同步取消选择；删除需要确认。

### 4.2 数据模型

```ts
interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

interface PromptLibraryState {
  version: 1;
  templates: PromptTemplate[];
  selectedIds: string[];
}
```

推荐使用 `browser.storage.local` 的单一 `prompt-library-v1` 文档并经过 Zod 校验。它是轻量工作台偏好，不和历史事务耦合。建议限制：200 条、名称 60 字符、单条正文 20,000 字符、合计 2 MB；名称大小写不敏感且唯一。

提示词库暂不进入会话 `.maiw.jsonl`。Turn 会保存本轮模板快照，确保模板后来被编辑或删除后，历史仍能解释当时发送了什么。

### 4.3 确定性合成

```ts
interface AppliedPromptTemplate {
  id: string;
  name: string;
  content: string;
  order: number;
}

interface TurnPromptMetadata {
  userQuestion: string;
  appliedTemplates: AppliedPromptTemplate[];
}
```

合成规则：

```text
提示词A
<提示词A正文>

提示词C
<提示词C正文>

用户
<本次问题>
```

- 上述三反引号仅用于文档示例，不发送 Markdown fence。
- 模板内容和问题只 trim 首尾，内部换行原样保留。
- 模板按 `order` 排序。
- 无模板时直接返回问题原文。
- 合成后继续受现有 100,000 字符协议上限约束；超限时在本地阻止发送并保留草稿。

### 4.4 发送和历史语义

现有 `TurnRecord.prompt` 继续保存官网实际收到的完整字符串，以保持审计和导出语义。新增：

```ts
userQuestion?: string;
appliedPromptTemplates?: AppliedPromptTemplate[];
```

- 新记录的 Session 标题、用户气泡和右侧导航使用 `userQuestion`。
- 旧记录没有 `userQuestion` 时回退到 `prompt`。
- 统一对话的用户问题旁显示“已应用 A、C”，可展开查看实际发送内容。
- Markdown 导出仍保留完整实际发送内容，同时明确列出原始问题和模板名称，不能让历史看起来像只发送了短问题。

发送时先读取并冻结模板快照，再生成 `effectivePrompt`。同一个 `effectivePrompt` 作为不可变 payload 进入现有 `WORKSPACE_SUBMIT -> PRECHECK -> STAGE -> COMMIT`，每个目标只收到一次写入和一次点击。
