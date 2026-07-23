# POST-MVP-01：Changes、Review 与 Diff

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-04、MVP-07、MVP-09
- 后续任务：无

## 目标

在对话之外提供独立的代码改动审查界面。

## 任务清单

- [ ] 建立 Changes / Review 面板，列出 Changed Files。
- [ ] 显示新增、修改、删除和未跟踪文件。
- [ ] 支持按文件查看、搜索和折叠 Diff。
- [ ] 大 Diff 使用截断、分页或虚拟化。
- [ ] 支持 Accept / Revert，并在破坏性操作前确认精确目标。
- [ ] 支持 Open in Editor。
- [ ] 支持在 Diff 上评论。
- [ ] 支持将 `@diff` 加入对话上下文。
- [ ] 对话流只显示文件变更摘要，点击后进入 Review。
- [ ] 从 Edit Action 的 `details.diff`、`diagnostics` 和 `perFileResults` 提取单次改动产物。
- [ ] 聚合整个 Run 的 ChangeSet，并正确处理多次编辑同一文件后的最终 Diff。
- [ ] 检测 Bash、Write 等非 Edit Action 造成的工作区变化，不能只依赖单次工具结果。
- [ ] 区分 RPC 工具报告的 Diff 与工作区最终状态；Review 以可重新校验的最终状态为准。

## 完成条件

- [ ] 可以从 Changed Files 打开单文件 Diff。
- [ ] 可以编辑、丢弃或接受明确选中的改动。
- [ ] 完整 Diff 不会长期占用对话流。
- [ ] 大 Diff 不会阻塞主线程。
- [ ] 同一 Run 多次修改同一文件时，ChangeSet 与工作区最终内容一致。
