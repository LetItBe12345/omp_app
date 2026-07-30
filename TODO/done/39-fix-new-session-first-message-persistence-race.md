# MVP-39：修复新会话首条消息的部分成功状态

## 现象

在临时新会话中发送首条消息时：

1. 界面提示“Session 不存在”。
2. 发送按钮变为 Stop，说明 Runtime 已经开始执行。
3. 当前对话栏删除了乐观显示的首条 Prompt，也不显示后续流式输出。
4. 切换其他 Session 时提示“任务、Follow-up 或交互仍在进行，请先 Stop”。
5. Stop 后重新进入该 Session，可以看到首条 Prompt 实际已经发出。

## 原因

`createSession` 在 `supervisor.prompt()` 成功后立即调用
`requireSession()` 扫描 Session JSONL。OMP 已经接收 Prompt 并把 Runtime 设为
`isStreaming=true`，但 JSONL 可能还没有出现在目录中。扫描失败后，
IPC 返回 `SESSION_NOT_FOUND`。

这是一个部分成功状态：

- Runtime 一侧已经接收 Prompt，不能再回滚。
- Main 却把整个创建请求返回为失败。
- Renderer 按失败处理，删除乐观 Prompt，恢复输入框，并继续保持
  `temporarySession=true`。
- Renderer 在临时会话状态下会忽略 OMP 实时事件，因此对话栏不显示
  已发出的 Prompt 和后续输出。

## 修复原则

`supervisor.prompt()` 返回成功是新会话首条消息的提交点。提交点之前的
错误可以返回失败，由 Renderer 撤销乐观 Prompt。提交点之后不能因为
Session 文件延迟、目录刷新或 Desktop 状态写入失败，把已经执行的 Prompt
改判为发送失败。

Session JSONL 是延迟生成的持久化结果，不是 Prompt 是否被 Runtime 接收的
判定依据。

## 修复计划

### 1. 调整 Main 的提交语义

- 保留 `new_session -> setSessionName -> prompt` 的 Runtime 命令顺序。
- `prompt` 成功后立即把这次 `createSession` 视为成功。
- 提交点后保存权限和活动 Session ID。写入失败只标记
  `approvalModeSaved=false`，不能返回 Prompt 发送失败。
- 从同步成功路径中移除必须成功的 `requireSession()`。允许 Session 摘要在返回时
  暂时不可用。
- 只有 `new_session`、标题设置中的必要操作或 `prompt` 本身在提交点之前失败时，
  才向 Renderer 返回失败。标题设置仍保持非阻断。

### 2. 允许 Session 摘要延迟出现

- 调整 `CreatedSession` 返回类型，使 Session 摘要可选，或者只返回已确定的
  Runtime 快照和 Session ID。
- Main 可以尝试读取一次 Session 摘要，但读取不到时仍返回成功。
- Renderer 成功后先退出临时会话，再异步刷新 Session 列表。列表暂时没有
  新 Session 时不显示错误。
- OMP 事件或后续目录刷新发现 JSONL 后，用真实摘要替换临时列表状态。

### 3. 保证对话栏不丢事件

- `createSession` 成功时保留已经显示的乐观 Prompt，不恢复输入框。
- Renderer 退出 `temporarySession` 后，必须接收新 Session 的实时文本、Thinking、
  Tool Call、Permission 和结束事件。
- 处理 `createSession` IPC 等待期间事件可能已经到达的竞态。实现时在下列方案中
  选择最小且可验证的一种：
  - 创建期间暂存新 Session 的 OMP 事件，成功后按顺序重放，失败时丢弃。
  - 成功后立即用 `getMessages()` 对话历史校正当前投影，并保证校正过程不覆盖
    同时到达的新事件。
- 不能仅隐藏“Session 不存在”错误；Prompt 和 Assistant 输出必须真正出现在
  当前对话栏。

实际选择了更小的现有状态方案：记录进入临时会话时的 Runtime Session ID。
`new_session` 产生不同 ID 且 Runtime 进入 streaming 后，即可确定后续事件属于
正在创建的新 Session。Renderer 直接把这些事件写入当前投影，不需要额外
缓存、历史重放或重复发送 Prompt。

### 4. 保留真实失败的回滚行为

- `new_session` 失败或 `prompt` 未被 Runtime 接收时，Renderer 继续删除乐观 Prompt、
  恢复输入框并显示准确错误。
- 提交点前失败不能保存无效的活动 Session ID。
- 提交点后的 Session 列表延迟不得触发第二次发送或重复 Prompt。

### 5. 补充回归测试

Main 测试：

- `prompt` 已接收但 Session JSONL 暂时不存在时，`createSession` 仍返回成功。
- 上述情况会保存活动 Session ID，且不返回 `SESSION_NOT_FOUND`。
- `prompt` 在提交点前失败时，不保存活动 Session ID。
- Desktop 状态写入失败时，已接收的 Prompt 仍返回成功，并标记状态未保存。

Renderer 测试：

- Session 摘要暂时不可用时，退出临时会话并保留乐观 Prompt。
- `createSession` 等待期间到达的 OMP 事件不丢失，且不重复用户消息。
- 新 Session 生成期间 Stop 按钮正常，对话栏显示的是正在运行的 Session。
- 真实的创建或发送失败仍会撤销乐观 Prompt 并恢复输入。
- Session 摘要延迟出现后，列表自动刷新且不改写当前对话。

端到端或 fake OMP 测试：

- 模拟 `prompt` 已确认、JSONL 延迟出现的真实顺序。
- 验证 Prompt 只发送一次，对话栏始终可见，任务可 Stop，Session 列表最终出现该会话。

## 完成条件

- [x] Prompt 被 Runtime 接收后，不再因 Session JSONL 暂时不可见而返回失败。
- [x] 首条 Prompt 和后续实时输出在当前对话栏中持续可见。
- [x] Renderer 在提交成功后退出临时会话，Stop 和当前 Session 状态一致。
- [x] Session 列表允许延迟刷新，不阻塞 Prompt 的成功返回。
- [x] 提交点前的真实失败仍会回滚界面，且不留下无效活动 Session ID。
- [x] Main 和 Renderer 回归测试直接覆盖 JSONL 延迟与实时事件竞态，fake RPC smoke 验证 Runtime 协议主链路。
- [x] `pnpm test:workspace-session`、`pnpm check`、fake RPC smoke 和生产构建通过。

## 实施结果

- `supervisor.prompt()` 成功后，`createSession` 不再因 `requireSession()` 读取不到
  JSONL 而返回失败。
- `CreatedSession.session` 改为可选。摘要暂时不可用时，Renderer 先进入真实
  Session，再异步刷新列表。
- Renderer 同步记录 Runtime 快照，并在新 Session 进入 streaming 后接收创建期间的
  OMP 事件。
- 真实的 `prompt` 失败仍返回失败，且不保存活动 Session ID。

## 验证

- `pnpm test:workspace-session`：3 个测试文件、39 项测试通过。
- `pnpm check`：25 个测试文件、169 项测试通过，类型检查、Lint 和格式检查通过。
- `OMP_RPC_FAKE=1 node scripts/rpc-smoke.mjs`：通过。
- `pnpm build`：通过。

## 上次尝试记录

上次修改把 `requireSession()` 移到 `prompt()` 之后，并在 Session 文件可读后才
保存活动 ID。静态测试通过，但测试没有模拟“Prompt 已接受、JSONL 尚未出现”
的真实时序，因此漏掉了这次部分成功问题。

上次验证数据仅证明当时测试集通过，不再作为本任务已完成的依据。
