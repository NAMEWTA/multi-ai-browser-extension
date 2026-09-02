# 验收标准

## 自动化

- Canonical quality gate 拒绝空正文、标题复读、状态文字、计数缺失、未耗尽 cursor 和断裂 branch。
- DeepSeek thinking-only 节点不能触发失败或 completed；final root 替换后取得完整正文。
- 豆包分页必须处理重复 cursor/page、缺失 next cursor、expected count 与页数上限。
- Kimi 从 root token 遍历；第二轮不得复用第一轮 assistant。
- 千问拒绝旧 observation、会话 ID 不一致、POST replay 和 incomplete branch。
- ChatGPT 只保留 `current_node` 活动分支。
- Claude 排除 thinking/tool block，且 `has_more` 或不稳定 ID 不能 complete。
- provider API 即使没有 DOM/Copy target，也能在完整快照通过后结束等待。
- native Copy 失败时只允许 Copy target 所属 reply 容器回退，不读取页面全局文本。
- snapshot 全消息原子保存；相同 revision 幂等；session 删除无孤儿快照。
- 网络桥覆盖 allowlist、同源、大小限制、token 关联、listener 清理和敏感字段清洗。
- `typecheck/lint/format/test/build` 全部通过。

## 真实站点 smoke

每个 provider 至少执行：

1. 新会话发送包含多段、列表、代码块的长回答。
2. 连续两次发送完全相同的问题。
3. 生成中停顿、人工停止或重新生成。
4. 打开包含多轮历史的已有会话后再发送一轮。
5. 检查工作台状态不再停留“等待回复”。
6. 展开每轮卡片，正文首段、末段和代码 sentinel 均存在。
7. 复制最近一轮、复制 provider 会话、复制统一会话与 Markdown 导出逐字一致。
8. DevTools 确认 extension diagnostics/IndexedDB 中没有 token、Cookie 或 Authorization。

## 发布门槛

- 默认 DeepSeek、豆包、千问三站真实 smoke 全部通过。
- Kimi 重复 prompt 专项通过。
- API selector drift 时 Copy 回退通过，且 UI 显示正确 terminal 状态。
- 未执行真实 smoke 前，不把本 change 标记为“线上验证完成”。
