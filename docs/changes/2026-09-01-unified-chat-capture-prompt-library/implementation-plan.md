# 实施计划与验收

## 0. 前置决策

开始业务实现前确认：

- 统一对话采用“最后一轮定位、全部回答收起”。
- 千问是否已有书面授权；没有授权则只做手动面板和官方 API 方案，不启用网页自动发送/采集。
- 提示词库仅本机保存，暂不提供独立导入导出。

## 1. Phase A：采集 fixture 与页面扰动基线

目标：先把失败变成可重复测试，不直接猜 selector。

工作项：

1. 为每个 Provider 保存脱敏的 composer、用户轮次、thinking、streaming、completed DOM fixture；不包含真实账号和真实问答。
2. 为千问在获授权的真实登录环境记录候选元素描述，验证第三方 selector 线索，禁止直接照搬。
3. 为回答候选增加 diagnostics，区分 selector miss、根节点替换和未稳定。
4. 修改通用提交器的 focus 行为，增加滚动位置回归测试。
5. 对全页 provider status observer 做 debounce/窄范围监听，避免流式输出触发高频 composer 全 DOM 扫描。

涉及文件：

- `src/core/providers/submitters/button-submitter.ts`
- `src/core/providers/dom.ts`
- `src/runtime/provider-diagnostics.ts`
- `src/providers/*/selectors.ts`
- `src/providers/*/*.test.ts`

完成门槛：mock 中发送前后 workspace 与站点滚动容器位置不变；千问 fixture 可明确命中 answer content 或输出 `selector-miss`，不再只有笼统 timeout。

## 2. Phase B：事件驱动采集内核与 Markdown 快照

目标：替换 250 ms 全页轮询和 `count + lastText` 判断。

工作项：

1. 引入 `ResponseLocator` 和 Provider 级完成策略。
2. 建立页面 root 重绑 observer、当前回答 observer、低频兜底轮询和绝对 deadline。
3. 建立 baseline/turn 关联与 submitted -> streaming -> settled 状态机。
4. 为每个 panel 建立单一 capture lease 和 AbortController，导航/新会话/pagehide 时正确收尾。
5. 增加 blocked/CAPTCHA 状态和人工接管，不自动重试。
6. 对回答 DOM clone 清洗，生成 `plainText + markdown`。
7. 扩展协议、缓冲、数据库、历史 JSONL 和 transcript 的可选 Markdown 字段。
8. timeout 时保留 partial；只有从未观察到正文才写空 timeout。

涉及文件：

- `src/core/providers/contracts.ts`
- `src/core/providers/base-dom-strategy.ts`
- `src/core/providers/dom.ts`
- `src/entrypoints/provider-bridge.content.ts`
- `src/core/messaging/protocol.ts`
- `src/db/database.ts`
- `src/db/session-service.ts`
- `src/db/history-transfer.ts`
- `src/core/transcript/markdown-transcript.ts`

依赖 spike：

- 展示固定使用 `react-markdown + remark-gfm`。
- 转换比较 Turndown 与 `rehype-parse + rehype-remark + remark-stringify`；以真实 fixture 保真度、bundle 增量、100 KB/2 MB 输入耗时和安全审计决定。

完成门槛：流式文本节点更新、root 替换、thinking -> answer、生成控件闪烁和超时 partial 均有确定性测试。

## 3. Phase C：统一对话折叠、导航与 Markdown

目标：完成第一项可见需求。

工作项：

1. 从 `workspace-app.tsx` 抽出 `SessionHistoryDetail` 和 `MarkdownResponse`。
2. 增加 `activeTurnId`、`expandedExchangeIds`、详情滚动容器 ref。
3. 默认定位最后一轮；问题导航点击和滚动同步。
4. 所有回答默认折叠，展开时才挂载 Markdown。
5. 增加 1120 px 左右桌面宽版布局和 <=760 px 顶部导航降级。
6. 更新复制/下载展示，使 Markdown 与旧纯文本记录都正确。

涉及文件：

- `src/entrypoints/workspace/workspace-app.tsx`
- `src/entrypoints/workspace/workspace.css`
- 建议新增 `src/entrypoints/workspace/session-history-detail.tsx`
- 建议新增 `src/entrypoints/workspace/markdown-response.tsx`
- `tests/e2e/extension.spec.ts`

完成门槛：打开详情时最后一轮处于当前导航状态，但所有回答 `aria-expanded=false`；展开后标题、列表、代码块和表格可读，危险 HTML 不执行。

## 4. Phase D：提示词库与确定性发送

目标：允许维护、多选、预览并安全地复用提示词。

工作项：

1. 新增 Zod schema、storage repository 和纯函数 `composePrompt()`。
2. composer 增加提示词摘要按钮、选择 popover 和实际发送预览。
3. 增加提示词管理对话框的 CRUD、排序、搜索与删除确认。
4. 发送时冻结 `userQuestion + template snapshots + effectivePrompt`。
5. `WORKSPACE_SUBMIT` 仍只携带 effective prompt，保持 Provider 事务协议不变。
6. Turn 增加原始问题和模板快照；Session 标题/导航使用原始问题。
7. 成功后清空问题但保留勾选；失败保留问题和勾选。

建议新增文件：

- `src/core/prompts/contracts.ts`
- `src/core/prompts/compose-prompt.ts`
- `src/entrypoints/workspace/prompt-library-store.ts`
- `src/entrypoints/workspace/prompt-selector.tsx`
- `src/entrypoints/workspace/prompt-library-dialog.tsx`

完成门槛：选择 A、C 后每个目标官网只收到一条、内容逐字符等于预览的消息；任一预检/暂存失败仍是零点击。

## 5. 测试矩阵

### 单元测试

- 模板无选择、A+C 顺序、重复名称、删除已选、Unicode/换行、100,000 字符边界。
- 旧 Turn 回退 `prompt`，新 Turn 使用 `userQuestion` 导航。
- HTML 转 Markdown：标题、嵌套列表、引用、链接、代码 fence、表格、公式 fallback、隐藏控件清理。
- Markdown 安全：script、事件属性、`javascript:` 链接、远程图片。
- 采集状态机：新 turn、占位 turn、root 替换、stop 闪烁、quiet fallback、partial timeout。

### React 测试

- 初始最后一轮 current，但回答全部折叠且正文未挂载。
- 展开单个回答不影响其他回答。
- `detail` streaming 更新不丢失 active/expanded 状态。
- 重复问题仍有两个独立导航项。
- 空会话、失败、timeout、partial 和超长代码块。
- 提示词多选、管理、预览、超限和键盘操作。

### Mock E2E

- 多轮详情导航和响应式降级。
- A+C+问题的实际 iframe 输入值与预览逐字符一致。
- 提示词发送仍满足全站 precheck/stage/commit 和 rollback 语义。
- 点击发送不改变 panel stage、iframe 文档及最近滚动容器的位置。

### 真实站点 smoke

- 仅使用专用测试账号和明确允许自动化的站点。
- 记录 selector 版本、最终 URL、是否出现生成标记、首个正文时间和完成时间。
- 出现验证码、滑块、429、风险提示立即停止，不自动重试。
- 千问只有在书面授权范围内运行；否则只验证手动面板或官方 API provider。

## 6. 最终验收标准

1. 统一对话每个 AI 回答默认收起，点击可展开；打开详情默认定位最后一轮。
2. 桌面右侧问题导航完整、当前项可见；窄屏无挤压、遮挡和页面级横向滚动。
3. 新采集回答的标题、列表、引用、链接、代码块和表格在历史中正确呈现；旧历史无回归。
4. 任一站超时且已有正文时保存为 partial；只有完全没有观察到正文才显示“未采集到”。
5. 页面采集不主动滚动官网；发送不因 focus 造成面板跳动。
6. 风控或挑战出现时停止并给出可操作原因，不尝试规避。
7. 提示词 A、C 的选择顺序不影响合成顺序；预览与每个官网实际收到的单条消息完全一致。
8. 模板编辑/删除不改变旧 Turn 保存的模板快照。
9. `pnpm check`、单元测试、mock E2E、生产构建通过；真实站点 smoke 结果单独报告，不能由 mock 替代。

## 7. 推荐实施顺序

严格按 A -> B -> C -> D 推进。C 的 Markdown 视觉效果依赖 B 保存结构化内容；如果先做 C，只能得到“能解析少量残留 Markdown 的纯文本查看器”，不能满足官网格式保真。D 可以与 B 并行开发，但合并前必须一起验证 100,000 字符上限和历史字段语义。
