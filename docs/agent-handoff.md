# Multi AI Workspace Agent 交接摘要

> 状态：当前开发交接入口
> 基线版本：`v0.0.1-alpha.7`
> 更新日期：2026-08-31
> 仓库：https://github.com/NAMEWTA/multi-ai-browser-extension

## 1. 产品结论

本项目是 Chrome/Chromium 全页扩展工作台，在一个扩展标签页中并排嵌入多个真实 AI 官网，并复用浏览器现有登录状态。用户在工作台输入一次问题，扩展通过各官网 Content Script 操作原生输入框和发送按钮，不使用模型 API，也不重绘官网聊天界面。

当前预配置站点：

- DeepSeek：`https://chat.deepseek.com/`
- Kimi：`https://www.kimi.com/`
- 通义千问：`https://www.qianwen.com/`
- 豆包：`https://www.doubao.com/chat/`
- Coze、ChatGPT、Claude、MiniMax

完整产品、技术和 UI 基线分别见：

- [product-plan.md](product-plan.md)
- [technical-architecture.md](technical-architecture.md)
- [ui-design.md](ui-design.md)

## 2. 不可破坏的行为

1. 用户编辑全局草稿时，不得实时写入任何官网输入框。
2. 点击发送后冻结 `sessionId + turnId + prompt + targets`。
3. 全部目标先做零副作用预检；任一失败则整轮零写入、零点击。
4. 预检全部成功后才暂存到各官网；任一暂存失败必须清空已暂存内容，且不点击发送。
5. 全部暂存成功后并发点击。官网点击无法跨站回滚，因此提交阶段允许记录部分失败。
6. 只有至少一个站点确认提交后才能创建 Turn。失败发送不得污染历史。
7. 未点击“新任务”时，后续提问必须属于同一 Session，并继续使用各官网原会话上下文。
8. Session 必须保存各面板的完整 `location.href`、顺序、布局、宽度和目标选择；恢复时直接打开原 URL，不解析或拼接官网路径。
9. 点击左侧会话只切换，不改变排序。只有显式点击置顶按钮才置顶。
10. 跨域 iframe DOM 只能由对应官网 Content Script 操作，Workspace 不得直接访问。

## 3. 当前实现

### 发送事务

发送协议为：

```text
PRECHECK_PROMPT
  -> 全部成功
STAGE_PROMPT
  -> 全部成功
COMMIT_PROMPT（并发）

任一 Stage 失败
  -> ROLLBACK_PROMPT
  -> 不创建 Turn
```

`BaseDomStrategy.prepareSubmit()` 会绑定唯一输入框，Stage、Commit 和 Rollback 必须继续使用同一 DOM 节点。节点被官网替换时应安全失败，不能重新查询后误写到其他输入框。

### 会话与历史

Dexie 数据库为 `multi-ai-workspace-v4`，当前只保留开发期最新 Schema，不维护旧版本迁移兼容。核心记录：

- `SessionRecord`：标题、创建时间、内容更新时间、最近打开时间、置顶时间、来源和工作区快照。
- `Turn`：一次成功的统一提问。
- `ProviderExchange`：各站点提交状态、回复状态和可见回复纯文本。
- 活动 Session ID 单独存储在 metadata。

排序规则：置顶会话按 `pinnedAt` 倒序，其余会话按 `createdAt` 倒序。打开、发送、回复更新和自动保存均不得改变列表位置。

历史导入导出只接受当前 JSONL v3。Markdown 转录支持：

- 当前任务全部已打开站点的完整会话
- 全部站点最近一轮问答
- 单个站点完整会话
- 单个站点最近一次问答
- 复制到剪贴板或下载 `.md`

### UI

- 左侧：新任务、搜索、稳定排序的 Session 列表、显式置顶、统一时间线查看、JSONL 导入导出。
- 顶部：布局切换、全站 Markdown 操作、等分容器、诊断导出、站点管理。
- 输入区：独立目标选择器、全局草稿和发送按钮。
- Provider 标题栏：移动、刷新、最大化、Markdown 操作、普通标签页打开和关闭。
- 历史详情：宽屏时间线弹窗，按“用户问题 -> 各 AI 回复”展示。
- 布局支持平铺、自动适应、相邻边框拖拽和一键等分，不允许页面产生底部横向滚动条。

## 4. Alpha 7 关键修复

千问此前失败不是官网告警日志导致，而是两个适配回归叠加：

1. 千问 Slate 输入框把 `data-slate-placeholder` 和零宽字符放进 `textContent`，旧逻辑误判为“官网已有草稿”。现在读取内容时会排除占位节点和零宽字符。
2. Alpha 4 之后的可见性判断递归排除了祖先带 `aria-hidden` 的元素，而千问真实可见输入框位于这种容器内。当前恢复为：元素自身 `aria-hidden` 仍不可用，但祖先的 ARIA 提示不代替真实 CSS 可见性。

千问现在使用候选评分选择真实聊天输入框，排除搜索框、隐藏、只读和禁用节点。诊断只记录元素描述、评分和规范化长度，不记录用户文本。

站点状态监听同时修复了异步检查期间丢失 DOM 变化的问题，并增加低频复核，以应对官网替换根文档后观察器失效。页面离开时必须清理 Observer 和 Interval。

## 5. 代码入口

- 工作台 UI：`src/entrypoints/workspace/workspace-app.tsx`
- 工作台样式：`src/entrypoints/workspace/workspace.css`
- Service Worker 编排：`src/entrypoints/background.ts`
- 官网桥接：`src/entrypoints/provider-bridge.content.ts`
- DOM 事务基类：`src/core/providers/base-dom-strategy.ts`
- DOM 工具：`src/core/providers/dom.ts`
- 千问适配：`src/providers/qwen/strategy.ts`
- 会话服务：`src/db/session-service.ts`
- JSONL：`src/db/history-transfer.ts`
- Markdown：`src/core/transcript/markdown-transcript.ts`
- 状态监听：`src/runtime/provider-status.ts`
- 可控浏览器测试：`tests/e2e/extension.spec.ts`
- 真实官网烟测：`tests/live/real-sites.spec.ts`

## 6. 开发与验收

```powershell
pnpm install
pnpm dev
pnpm verify
pnpm smoke:live
```

`pnpm verify` 包含类型检查、Lint、格式检查、单元测试覆盖率、生产构建和 Playwright 扩展测试。Alpha 7 发布前结果：

- 77 项单元测试通过
- 语句覆盖率约 90%，行覆盖率约 94.5%
- 16 项可控浏览器端测试通过
- 4 项真实官网测试通过
- 千问真实官网已验证：加载、原生输入框只读预检、草稿隔离和实际发送

真实官网控制台中的埋点、权限策略、Hydration 或第三方资源告警不能直接视为扩展故障。应以 Provider 诊断、输入框候选、事务阶段结果和真实页面状态定位问题。

## 7. 发布状态

- 当前提交基线：`dd399dd`（Alpha 7 功能提交）
- Release：https://github.com/NAMEWTA/multi-ai-browser-extension/releases/tag/v0.0.1-alpha.7
- 主分支 CI 和 Release Action 均已通过。
- Release 资产包含 Chrome ZIP、`install-latest.ps1` 和 SHA-256 校验文件。

Windows 获取最新 Alpha：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-latest.ps1 -IncludePrerelease
```

脚本会下载、校验并解压扩展。Chrome 对非商店扩展不允许静默安装，最后仍需用户在 `chrome://extensions` 中确认“加载已解压的扩展程序”。

## 8. 后续开发原则

- 站点适配优先新增站点专用 Strategy 和回归测试，不在通用选择器中无限追加模糊规则。
- 任何发送逻辑修改都必须覆盖预检零副作用、失败回滚、单次点击、绑定节点不漂移和失败不建 Turn。
- 官网 DOM 变化应先通过隐私安全诊断定位，再更新语义候选评分。
- 回复历史只能采集页面中已经可见的纯文本，不读取 Cookie、Token、隐藏状态或内部接口。
- 开发期允许不兼容重构，但完成后只保留一套最新 Schema、协议和文档基线。
- 发布前必须运行 `pnpm verify`；涉及 Provider 选择器或发送逻辑时还必须运行 `pnpm smoke:live`。
