# 43 Playwright 基础端到端测试

- [x] 接入真实 Electron 窗口的 Playwright 测试，隔离测试数据。
- [x] 覆盖新建 Session、切换 Agent 权限、输入命令、运行中取消和删除 Session。
- [x] 运行测试和相关检查，记录运行方法及测试边界。

## 实现

- 测试：`tests/e2e/session.spec.mjs`，运行方式及边界见 `docs/playwright-e2e.md`。
- 使用真实 Electron 窗口、IPC 和文件持久化；模型侧使用本地 RPC 测试进程。
- 修复端到端测试发现的侧栏竞态：临时会话绑定后，不再被延迟恢复逻辑重新插入。
- 测试废纸篓与 Session 文件放在同一文件系统，测试完成后清理。

## 验证（2026-10-10）

- Playwright 五项用例连续运行两轮：10/10 通过。
- `pnpm test:workspace-session`：48/48 通过（Node 24）。
- 生产构建、TypeScript 类型检查、改动文件 ESLint/Prettier、`git diff --check` 通过。
- `pnpm install --frozen-lockfile` 通过；锁文件仅新增 Playwright 依赖。
- 未调用真实模型，未验证真实 OMP 二进制或工具执行。
