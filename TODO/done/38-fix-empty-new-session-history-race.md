# MVP-38：修复空新会话被旧历史覆盖

## 问题

旧 Session 的 `getMessages()` 请求可能在用户点击“新建对话”后才返回。Renderer
会把这份迟到的历史写入临时新会话的空白投影，界面因此看起来自动切回了
旧会话。会话列表同时仍把 Runtime 底层持有的旧 Session 显示为选中。

## 完成条件

- [x] 进入临时新会话时取消旧 Session 的历史恢复，迟到结果不能改写空白界面。
- [x] Runtime 继续持有旧 Session 时，临时新会话不把旧 Session 行显示为当前项。
- [x] 显式点击旧 Session 仍能退出临时新会话并恢复历史。
- [x] Renderer 回归测试覆盖迟到历史、Runtime 快照、OMP 实时事件和显式切换。
- [x] CI 的 Workspace/Session 专项步骤运行上述测试。
- [x] 类型检查、Lint、格式检查和完整测试通过。

## 实施结果

- 临时新会话作为独立的 Renderer 显示状态，不恢复 Runtime 底层旧 Session 的历史。
- 旧历史请求、旧 OMP 投影事件和中断输入在临时新会话期间不改写当前对话。
- 会话侧栏和对话标题使用去掉旧 Session ID 和名称的可见 Runtime 快照。

## 验证

- `pnpm test:workspace-session`：3 个测试文件、37 项测试通过。
- `pnpm check`：25 个测试文件、167 项测试通过，类型、Lint 和格式检查通过。
- `OMP_RPC_FAKE=1 node scripts/rpc-smoke.mjs`：通过。
- `pnpm build`：通过。
