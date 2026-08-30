# Multi AI Workspace

[![CI](https://github.com/NAMEWTA/multi-ai-browser-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/NAMEWTA/multi-ai-browser-extension/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NAMEWTA/multi-ai-browser-extension)](https://github.com/NAMEWTA/multi-ai-browser-extension/releases/latest)

Chrome/Chromium 全页扩展工作台：在一个标签页中并排打开多个真实 AI 官方网页，将全局输入同步到各网页的原生输入框，并在用户确认后统一触发发送。

## 产品边界

- 展示真实官网，不自行渲染聊天界面或回答。
- 使用浏览器中各站点已有的登录状态，不读取或复制 Cookie。
- 只操作网页 DOM，不调用模型 API、站点内部接口或保存 API Key。
- 本地历史只保存发送内容、时间、目标站点和逐站结果，不恢复旧网页会话。
- 站点不能稳定嵌入时，降级到普通浏览器标签页继续统一发送。

预配置站点：DeepSeek、Kimi、Coze、ChatGPT、Claude、通义千问、MiniMax。DeepSeek 与 Kimi 默认打开，其余站点由用户在工作台内添加。

## 技术栈

- WXT、React、TypeScript、Manifest V3
- Content Script Provider plugins
- Chrome runtime Port、`webNavigation`、session DNR rules
- Zustand、Dexie、Zod
- Vitest、Playwright

## 安装

### GitHub Release

1. 从 [最新 Release](https://github.com/NAMEWTA/multi-ai-browser-extension/releases/latest) 下载 `multi-ai-workspace-*-chrome.zip`。
2. 解压 ZIP，打开 Chrome 的 `chrome://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压目录。

Windows 用户也可以下载 Release 中的 `install-latest.ps1`，或从仓库运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-latest.ps1
```

安装最新 Alpha/预发布版本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-latest.ps1 -IncludePrerelease
```

脚本会自动查询最新 Release、下载并验证 SHA-256、解压到 `%LOCALAPPDATA%\MultiAIWorkspace\<version>`、复制目录路径并打开扩展管理页。Chrome 不允许从 GitHub 在 Windows/macOS 上静默安装扩展，因此最后的“加载已解压的扩展程序”必须由用户确认。

### 本地构建

```bash
pnpm install
pnpm dev
```

生产构建位于 `.output/chrome-mv3`：

```bash
pnpm build
```

在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，然后选择该构建目录。

## 自动发布

推送与 `package.json` 版本一致的语义化标签会自动运行验证、打包并创建 GitHub Release：

```bash
git tag v0.0.1
git push origin v0.0.1
```

Release 包含 Chrome ZIP、Windows 安装辅助脚本和 SHA-256 校验文件。工作流定义位于 [release.yml](.github/workflows/release.yml)。

## 验证

```bash
pnpm check
pnpm test
pnpm e2e
```

真实网站 smoke test 会访问官网并可能产生真实发送，只应使用专用测试账号：

```bash
pnpm smoke:live
```

## 当前文档

- [产品计划](docs/product-plan.md)
- [技术架构](docs/technical-architecture.md)
- [UI 与交互规范](docs/ui-design.md)

这三份文档是当前唯一基线；仓库不保留历史计划、发布说明或旧测试报告。

## License

[MIT](LICENSE)
