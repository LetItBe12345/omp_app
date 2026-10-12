# 47 · Workspace 打开与历史 Session 回归

## 问题与证据

- 用户反馈选择其他目录后仍停留在原 Workspace，历史 Session 消失。
- 本机历史 JSONL 仍在；重复打开当前 Workspace 会无条件清空列表，但 ID 未变化，列表加载 effect 不再执行。

## 完成条件

- [ ] 明确目录选择未切换的原因。
- [x] 重复打开当前目录不丢失历史会话与当前输入。
- [x] 增加真实 Electron 的打开、重开、跨 Workspace、重载回归测试。
- [ ] 相关检查通过，创建 PR，本地快进，重新打包并更新安装版本。

## 根因与修复

`openWorkspace()` 总是执行 `resetSessionsForWorkspaceChange()`。当目录选择器返回当前 Workspace 时，ID 不变，依赖 ID 的加载 effect 不再触发，导致侧栏长期为空。该操作也错误清空了输入与临时对话状态。

现在同一 Workspace 只刷新列表与概览，保留输入、对话投影与临时 Session。跨 Workspace 仍执行原来的重置与加载流程。

本机状态只有 `/home/jin`，历史 JSONL 均仍存在；用户希望打开的目录实际为 `/home/jin/interview/kanglong`。模拟选择器返回另一个真实目录的 Electron 回归通过，尚未捕获用户复现时系统选择器的返回值，不能把该问题认定为已修复。Main 增加选中路径、规范路径、之前路径的诊断日志，便于后续定位。

## 验证

- 新增前端回归在修复前失败、修复后通过。
- 219 项单元测试串行执行全部通过。并行运行时一个既有性能测试 P95 为 133ms 超过 100ms，串行通过。
- 6 项 Electron E2E 通过，包含重开、中文路径跨 Workspace、切回和页面重载；确认原 JSONL 正文未被修改。
- TypeScript、修改文件的 ESLint/Prettier、fake RPC smoke 通过。
- 打包后的原生 Wayland smoke 通过，默认 GPU 和 sandbox。
- 全量 `pnpm check` 被已有的 `scripts/check-interview.mjs` 14 处 `no-undef` 阻断；这些文件属于本地未推送的文档提交，本次不修改。
