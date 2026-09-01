# AI 回复采集完整性验证记录

日期：2026-09-01

## 已通过

- `pnpm check`：TypeScript、ESLint、Prettier 全部通过。
- `pnpm test:coverage`：25 个测试文件、139 个测试通过。
- 覆盖率：语句 89.89%、分支 77.75%、函数 94.57%、行 93.34%。
- `pnpm build`：Chrome MV3 生产构建通过。
- `pnpm e2e`：20 个扩展 E2E 全部通过。
- 精确回归：旧实现稳定得到 `# 你好`，新实现取得标题、正文和列表末项，并排除 thinking、状态与按钮。
- 人工停止：DeepSeek 保留停止前完整正文，返回 `partial: interrupted`，状态文字不进入 payload。
- 乱序持久化：revision 8 completed 后到达 revision 7/9 streaming 或其他 capture 时，数据库保持 revision 8 完整正文。
- transcript/clipboard：`LINE-001`、`MID-SENTINEL`、`END-SENTINEL` 和完整 Markdown 逐字保留。

生产构建仍报告 workspace chunk 大于 500 kB 的既有性能警告，不影响本 change 的构建成功。

## 待执行

真实 DeepSeek 120 行 smoke 未执行。当前 live 配置每次创建全新临时 Chromium profile，仓库和环境中没有专用的 DeepSeek 已登录 profile；现有 live 用例也不包含本 change 所要求的 DeepSeek 120 行 sentinel 流程。

获得专用测试账号/profile 后，按 [acceptance.md](./acceptance.md) 第 8 节至少执行两次，其中一次覆盖后台标签页或布局切换，并验证 DOM、terminal revision、IndexedDB 与复制 artifact 四处都包含首行、`MID-SENTINEL` 和 `END-SENTINEL`。
