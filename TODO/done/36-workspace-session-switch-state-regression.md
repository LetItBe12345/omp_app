# 36 Workspace 与 Session 切换状态回归

## 问题

Workspace 切换期间，Main 会先返回 `starting`，再在后台启动 Runtime 和恢复活动 Session。Runtime 曾在 Session 恢复完成前发布 `ready`，Renderer 也会短暂保留上一个 Workspace 的 Session 列表。用户在这个窗口继续操作时，可能得到“Session 不存在”或“Workspace 正在启动，请稍候”。错误写入 Renderer 后没有随成功切换清除，因此提示会长期残留。

Desktop 保存的 `activeSessionId` 对应文件失效时，当前实现只记录日志，不清理失效引用，后续切换还会重复触发同一问题。

## 完成条件

- [x] Workspace 激活全过程保持 `starting`，直到目标 Session 恢复结束才发布最终状态。
- [x] Workspace 切换开始后立即清空旧 Session 列表，并丢弃旧 Workspace 的迟到查询结果。
- [x] 失效的 `activeSessionId` 只在仍为当前值时清除，保留其他 Session 偏好。
- [x] 成功的 Workspace 或 Session 操作清除之前的侧栏错误。
- [x] Main、Renderer 和 Desktop 状态存储都有对应回归测试。
- [x] CI Quality 明确运行 Workspace/Session 专项回归测试，不依赖 Linux 打包步骤。
- [x] 类型检查、Lint、格式检查和完整测试通过。

## 验证

- `pnpm test:workspace-session`：3 个测试文件、36 项测试通过。
- `pnpm check`：类型检查、Lint、格式检查及 25 个测试文件、166 项测试通过。
- `OMP_RPC_FAKE=1 node scripts/rpc-smoke.mjs`：通过。
- `pnpm build`：通过；生产输出没有 source map 或测试 fixture 引用。
