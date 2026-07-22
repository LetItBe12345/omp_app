# MVP-02：OMP RPC 与 IPC 主链路

- 状态：已完成
- 优先级：P0
- 前置任务：MVP-01
- 后续任务：MVP-03、MVP-04、MVP-05、MVP-08

## 目标

让 Electron Main 稳定管理 OMP Runtime，并通过安全、类型明确的 IPC 向 Renderer 提供 MVP 所需的 RPC 能力。

## 固定方案

```text
Renderer
  ↓ Electron IPC
Preload
  ↓ Electron IPC
Main / Runtime Supervisor
  ↓ JSONL over stdin/stdout
runtime/omp --mode rpc
```

- MVP 只运行一个长期 OMP RPC 进程。
- 同一时间只有一个活动 Workspace、一个活动 Session 和一条执行链。
- OMP Session 是聊天历史的唯一来源；Desktop 只保存布局、每 Session 草稿等少量 UI 状态，不复制完整消息数据库。
- Follow-up 只存在于 OMP Runtime 内存；Desktop 不保存恢复副本。Runtime 重启或崩溃时，尚未执行的 Follow-up 可以丢失。

## 明确不做

- 不修改 OMP 核心，不解析 TUI 文本。
- 不新增 WebSocket、gRPC 或 HTTP 服务。
- 不为每个 Session 启动独立进程。
- 不在 Renderer 重建 Agent 状态机。
- 不在本任务解析 Runtime Environment / Network Profile；MVP-07 负责生成最终 `env`。
- 不向普通 Renderer 暴露 RPC `bash`、Host Tool 或 Host URI。
- MVP 不注册 Host Tool 和 Host URI；意外收到对应请求时明确返回“不支持”。
- 运行中不向界面提供 Steer；再次发送统一使用 Follow-up。
- 不实现 Follow-up 的持久化、恢复或单条撤销。

## 生命周期与状态机

### 启动

- [x] 先创建并显示窗口；只有恢复或选择出有效 Workspace 后才启动 OMP。
- [x] 从应用资源中解析并校验 `runtime/omp`。
- [x] 使用活动 Workspace 作为 `--cwd`，以 `shell: false` 启动 OMP。
- [x] Runtime Supervisor 接收 MVP-07 已解析的最终 `env`，并原样传入 `spawn`。
- [x] 启动过程使用 single-flight，防止并发调用产生第二个长期进程。
- [x] 等待 `ready`，最长 15 秒；未就绪则结束进程并进入 `START_FAILED`。
- [x] 处于 `starting` 时，用户发送按钮禁用且显示灰色；内部初始化请求等待同一个 ready Promise。
- [x] 启动失败时所有等待者收到同一个结构化错误，界面提供“重启 Runtime”。

### Workspace、Session 与 Renderer

- [x] Workspace 切换只指选择另一个项目根目录，不包括文件、子目录或 Session 切换。
- [x] 运行中切换 Workspace 或 Session 前确认；确认后停止当前执行链并清空队列，取消则保持原状态。
- [x] Workspace 切换时结束旧 Runtime，再用新 Workspace 启动；不动态修改 `cwd`。
- [x] Session 切换只接受 OMP 返回或 Main 可信保存的 Session 标识，不接受 Renderer 构造的任意路径。
- [x] 应用启动后恢复上次 Workspace，再恢复上次 Session 并调用 `get_messages`；Session 不存在时新建 Session 并给出简短提示。
- [x] Renderer 刷新或崩溃重载时不停止 Runtime。新 Renderer 重新订阅，并用 `get_state`、`get_messages` 对齐状态和历史。
- [x] 重载期间不无限缓存流式增量；最终以 OMP Session 历史为准。

### 结束与异常恢复

- [x] 正常结束依次关闭 stdin 并等待 5 秒、发送 SIGTERM 并等待 2 秒，最后 SIGKILL 整个进程组。
- [x] 应用退出、Workspace 切换、异常重启和强制 Stop 都清理整个进程组，避免遗留 Bash、Browser 等子进程。
- [x] Runtime 崩溃时拒绝全部 pending request，错误码为 `CRASHED`，并忽略旧连接的后到响应和事件。
- [x] 崩溃后不自动重放 Prompt；保留当前完整 Prompt 草稿，由用户决定是否重发。
- [x] 同一 Workspace 首次崩溃自动重启一次；60 秒内再次崩溃则停止自动重启，并显示退出码、信号、最近脱敏日志和手动重启按钮。
- [x] 应用关闭时若任务仍在运行，提示“任务正在运行，仍要退出吗？退出后任务将停止。”；确认后窗口可先关闭，Main 在后台完成清理。

## JSONL、请求与响应

### 协议解析

- [x] 逐行解析 stdout JSONL，正确处理分包、粘包、空行和不完整行缓冲区。
- [x] 单条 JSONL 帧硬上限为 16 MiB；超限判定协议失效并重启 Runtime。
- [x] 单条畸形 JSON 不立即重启：记录长度受限且脱敏的诊断，发出 `RPC_PROTOCOL_ERROR`，继续解析后续行。
- [x] 10 秒内累计 3 条解析错误时判定协议失效并重启 Runtime。
- [x] 对输出帧做最小校验：必须是对象且 `type` 为字符串。响应按 `id` 在 Main 处理，其他事件作为纯数据转发。
- [x] Renderer 忽略未知事件并写 debug 日志，不因 OMP 新增事件崩溃。

### 请求关联与超时

- [x] 请求 ID 只由 Main 使用 `crypto.randomUUID()` 生成。
- [x] 每次 Runtime 启动生成新的 connection generation；请求表和事件都绑定 generation，隔离旧连接数据。
- [x] 状态查询超时 5 秒；Session 切换、模型和 Thinking 变更等异步命令超时 15 秒。
- [x] `prompt` 接收确认超时 5 秒；Agent 总执行时间不设置固定上限。
- [x] 超时后从请求表移除请求。后到响应只记录并忽略，不因此立即重启 Runtime。
- [x] `prompt` 的接收响应不等于完成；完成依据 `agent_end`、`prompt_result` 或 `agentInvoked: false`。
- [x] 正确处理 RPC 并发响应顺序，始终按 ID 关联；普通 Renderer 不直接调用 RPC `bash`。

## Prompt、Follow-up 与 Stop

### 发送规则

- [x] 空闲时普通发送调用 `prompt`；运行中普通发送一律调用 `follow_up`。
- [x] Follow-up 模式固定为 `one-at-a-time`，保持发送顺序和消息边界。
- [x] MVP 界面不提供 Steer。底层协议类型可以保留，但 Preload 不暴露当前界面不使用的 Steer 操作。
- [x] 运行中的 Slash Command 不进入 Follow-up；发送按钮禁用并提示任务结束后执行。
- [x] 只要 Runtime 正在执行或 Follow-up 队列非空，发送按钮都保持 Stop 形态，不在轮次间闪烁。
- [x] Main 在 Agent 运行期间拒绝模型和 Thinking 等级切换；MVP-03 接入控件时按同一状态禁用。

### Stop 规则

- [x] 发送按钮在执行开始后原位切换为圆圈内方块的 Stop 图标。
- [x] 鼠标点击 Stop，或对话区域没有选中文本时按 `Ctrl+C`，触发同一个 `stopCurrentRun()` IPC；有选中文本时 `Ctrl+C` 仍为复制。
- [x] Renderer 点击后 100 ms 内进入 `stopping` 并禁止重复操作；正常目标约 1 秒恢复可发送状态。
- [x] `stopCurrentRun()` 由 Main 一次接收并完成：`abort → switch_session(当前 Session) → get_messages`，清空全部 Follow-up 后恢复历史。
- [x] `abort` 最长等待 5 秒；无响应则强制重启 Runtime 并恢复 Workspace/Session。
- [x] 同 Session 重载被 Extension 取消、失败或超过 5 秒时，同样重启 Runtime，保证队列被清空。
- [x] Stop 后把当前被中止的完整用户消息放回原 Session 输入框；覆盖该输入框已有内容。
- [x] 若正在执行的是 Follow-up，只恢复该条 Follow-up；已完成消息留在历史，尚未执行的 Follow-up 直接清空。
- [x] 草稿按 Workspace ID + Session ID 持久化，成功发送后清除；MVP-05 接入 Session 删除动作时同步清理对应草稿。

## 事件、日志与恢复

- [x] `message_update` 和 Thinking 高频增量保持顺序，并按 16–33 ms 合并后发送给 Renderer。
- [x] 消息开始/结束、工具开始/结束、错误和 Extension UI 请求立即转发。
- [x] stderr 不进入对话流，只写 Runtime 诊断日志。
- [x] Runtime 日志按 5 MiB 轮转，最多保留 3 个文件；删除日志不影响 Session。
- [x] 日志不得记录完整 Prompt、模型密钥、代理凭据或环境变量值。
- [x] 错误界面只显示退出码、信号和最近脱敏日志摘要，并提供“查看日志”。

## Extension UI 与系统打开能力

- [x] Main 识别并桥接 `select`、`confirm`、`input`、`editor`、`cancel` 和 `open_url`。
- [x] `notify`、`setStatus`、`setWidget`、`setTitle` 等非阻塞展示不进入当前 UI 范围。
- [x] Renderer 重载时，Main 保留尚未完成的 Extension UI 请求并在重新订阅后再次发送；原超时继续计算。
- [x] 应用退出、Runtime 重启或请求超时时，对尚未完成的 Extension UI 请求返回取消。
- [x] `open_url` 只允许 HTTP/HTTPS，并直接交给系统默认浏览器；允许 localhost、回环地址、局域网地址、公网地址和端口。
- [x] 禁止 `file:`、`javascript:`、`data:` 和其他自定义协议。
- [x] Main 和 Preload 提供受控的系统浏览器与文件管理器调用；本地路径必须是已存在的绝对路径，也允许 Workspace 外路径。

聊天内容的路径识别和 `Ctrl+点击` 交互由 MVP-06 接入实际消息与文件树时实现。

## Preload 与 IPC

- [x] 使用命令专用、类型明确的方法，例如 `getState`、`prompt`、`followUp`、`stopCurrentRun`、`switchSession`、`setModel` 和 `subscribe`；不暴露通用 `rpc(command)`。
- [x] 事件订阅返回取消函数，避免 Renderer 重载后重复监听。
- [x] 只接受当前主窗口的 `webContents`、顶层 frame 和允许的本地来源；开发模式只允许配置的开发 URL。
- [x] 窗口销毁后，旧 Renderer 的请求和订阅全部失效。
- [x] Main 校验所有路径、枚举、文本和结构化参数，不暴露 Node 对象、ChildProcess 或文件句柄。
- [x] 使用稳定的结构化错误：`code`、`message`、`retryable`。至少包含 `RUNTIME_NOT_READY`、`START_FAILED`、`CRASHED`、`RPC_TIMEOUT`、`PROTOCOL_ERROR`、`INVALID_ARGUMENT`、`SESSION_NOT_FOUND` 和 `UNSUPPORTED`。
- [x] Renderer 只按错误码分支，不解析错误文本。

## 测试

- [x] 为 JSONL 分包、粘包、空行、16 MiB 上限、单次错误和 10 秒内连续错误编写单元测试。
- [x] 为请求 ID、generation 隔离、分级超时、后到响应和进程退出编写单元测试。
- [x] 使用假 OMP 进程测试 `ready → get_state → response`、15 秒启动失败和单次自动重启。
- [x] 测试 Renderer 刷新后的状态恢复、事件重订阅和 Extension UI 请求重放。
- [x] 测试普通 Prompt、逐条 Follow-up、运行中 Slash Command 禁用和模型控件禁用。
- [x] 测试鼠标 Stop、`Ctrl+C`、选中文本复制、队列清空、当前 Prompt 恢复和 5 秒强制重启。
- [x] 测试应用关闭后没有遗留 OMP 及其子进程。
- [x] 保留并扩展 `scripts/rpc-smoke.mjs`。
- [x] 用测试环境变量验证 Runtime `env` 注入；完整 Profile 与 Agent Bash 继承验收由 MVP-07 完成。

## 完成条件

- [x] Main 可以稳定启动、停止、重启和关闭 OMP，且不会产生第二个长期 Runtime。
- [x] Renderer 可以通过 Preload 调用最小命令集并接收安全的 OMP 事件流。
- [x] Session 历史可恢复；Renderer 重载不终止正在运行的 Agent。
- [x] 请求失败、超时、协议错误、进程崩溃和强制 Stop 都有明确、可测试的状态。
- [x] Stop 在正常路径快速反馈，并能可靠清空当前任务和全部 Follow-up。
- [x] RPC smoke test 和相关单元测试通过。

## 参考

- `docs/OMP_RPC.md`
- `docs/desktop-architecture.md`
- `scripts/rpc-smoke.mjs`
- Oh My Pi `docs/rpc.md`
- Oh My Pi `packages/coding-agent/src/modes/rpc/`
