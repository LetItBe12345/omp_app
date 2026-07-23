# 决策记录 02：OMP RPC 与 IPC 主链路

- 对应任务：`TODO/done/02-omp-rpc-runtime-and-ipc.md`
- 状态：已确认
- 确认日期：2026-07-22

## 架构与执行边界

1. Desktop 使用 `Renderer → Preload → Electron Main / Runtime Supervisor → OMP RPC` 的固定链路。
2. OMP 以 `runtime/omp --mode rpc` 运行，Desktop 不解析 TUI 文本，也不新增 WebSocket、gRPC 或 HTTP Agent 服务。
3. Electron Main 管理 OMP 进程、RPC 请求和宿主能力；Renderer 不重建 Agent 状态机。
4. MVP 只有一个长期 OMP Runtime；不为每个 Session 启动独立进程。
5. 一个 Runtime 可以保存和切换多个 Session，但同一时间只有一个活动 Workspace、一个活动 Session 和一条执行链。
6. 多 Session 并行属于 POST-MVP；未来采用“每个正在生成的 Session 一个 Runtime”，并在 Settings 限制最大并行数量。
7. Agent 的 Bash Tool 和其他命令由 OMP Runtime 执行，不经过 Desktop Terminal 或 PTY。
8. 内置 Terminal 是以后单独实现的独立 PTY，不能与 Runtime 的命令执行或代理配置混为一谈。
9. MVP-02 只接收已经解析好的 Runtime `env` 并原样传入 `spawn`；环境、代理和凭据解析由后续 Runtime Environment / Network 任务负责。
10. 普通 Renderer 不直接调用 RPC `bash`，也不获得 Host Tool、Host URI、Node 对象、ChildProcess 或文件句柄。
11. MVP 不注册 Host Tool 和 Host URI；如果 Runtime 意外发出对应请求，Main 明确返回“不支持”，不能静默悬挂。

## Runtime 启动与就绪

12. 应用先创建并显示窗口，恢复或选择出有效 Workspace 后才启动 OMP，避免 Runtime 阻塞首屏。
13. Runtime 二进制从应用资源中解析并校验，不依赖用户全局安装的 `omp`。
14. 活动 Workspace 通过 OMP 的 `--cwd` 设置；RPC 没有动态 `set_cwd`，切换 Workspace 必须重启 Runtime。
15. OMP 使用 `shell: false` 启动，避免命令解释和参数注入。
16. Runtime 启动使用 single-flight；并发初始化调用共享同一个 Promise，不产生第二个长期进程。
17. Runtime 必须在 15 秒内发出 `ready`；否则结束进程并进入 `START_FAILED`。
18. `starting` 状态下发送按钮不可用并显示灰色，不额外堆叠冗长提示；内部初始化请求等待同一个 ready Promise。
19. 启动失败时所有等待者收到同一个结构化错误，界面提供“重启 Runtime”。

## Workspace、Session 与历史

20. “切换 Workspace”只表示用户选择另一个项目根目录，例如从侧边栏点击另一个项目；文件、子目录和 Session 切换不属于 Workspace 切换。
21. 运行中切换 Workspace 或 Session 前必须确认；确认后停止当前执行链并清空排队消息，取消则保持原状态。
22. Workspace 切换时先结束旧 Runtime，再以新 Workspace 启动，不能在现有进程中动态修改工作目录。
23. Session 切换只接受 OMP 返回或 Main 可信保存的 Session 标识；Renderer 不能构造任意 Session 路径。
24. 应用启动时先恢复上次 Workspace，再恢复上次 Session 并调用 `get_messages`。
25. 上次 Session 不存在时新建 Session，并向用户显示简短提示。
26. OMP Session 是聊天历史的唯一可信来源；Desktop 不复制一套完整消息数据库。
27. Session 历史未来必须用于 Desktop 对话概览和历史聊天恢复，不只是 Runtime 内部状态。
28. Runtime 诊断日志与 Session 历史完全不同；日志不能用于恢复聊天记录，删除日志也不能影响 Session。
29. Desktop 只持久化 Workspace、布局、每 Session 草稿等少量 UI 状态。
30. Renderer 刷新或崩溃重载不能停止 Runtime；新 Renderer 重新订阅，并通过 `get_state`、`get_messages` 恢复状态和历史。
31. Renderer 离线期间不无限缓存流式增量；重载后最终以 OMP Session 历史为准。

## 结束、崩溃与恢复

32. 正常关闭 Runtime 时依次关闭 stdin 并等待 5 秒、发送 SIGTERM 并等待 2 秒，最后向整个进程组发送 SIGKILL。
33. 应用退出、Workspace 切换、异常重启和强制 Stop 都必须清理整个进程组，避免遗留 Bash、Browser 或其他子进程。
34. Runtime 崩溃时拒绝所有 pending request，统一使用 `CRASHED`，并忽略旧连接后到的响应和事件。
35. 每次 Runtime 启动生成新的 connection generation；旧 generation 的数据不能影响新进程。
36. Runtime 崩溃后不自动重放 Prompt，避免产生重复副作用。
37. 崩溃时保留当前完整 Prompt 草稿并放回输入框，由用户决定是否重新发送；已有输入框内容可以直接覆盖，不增加冲突合并逻辑。
38. 同一 Workspace 首次崩溃自动重启一次；60 秒内再次崩溃则停止自动重启。
39. 连续崩溃后显示退出码、信号、最近脱敏日志和手动重启按钮。
40. 应用关闭时若任务仍在运行，提示“任务正在运行，仍要退出吗？退出后任务将停止。”；确认后窗口可以先关闭，Main 在后台完成进程清理。

## JSONL 协议

41. stdout 按 JSONL 逐行解析，必须正确处理分包、粘包、空行和末尾不完整行。
42. 单条 JSONL 帧硬上限为 16 MiB；超限视为协议失效并重启 Runtime，避免异常输出耗尽 Main 内存。
43. 单条畸形 JSON 不立即重启；记录长度受限且脱敏的诊断，发出 `RPC_PROTOCOL_ERROR`，继续解析后续行。
44. 10 秒内累计 3 条解析错误时判定协议失效并重启 Runtime。
45. 输出帧只做最小前向兼容校验：必须是对象且 `type` 为字符串。
46. 响应由 Main 按 `id` 处理；其他事件只作为纯数据转发，不在 Main 重建 Agent 状态。
47. Renderer 遇到未知事件只写 debug 日志并忽略，不能因 OMP 新增事件崩溃。

## 请求、响应与超时

48. RPC 请求 ID 只由 Main 使用 `crypto.randomUUID()` 生成，Renderer 不参与生成。
49. 请求表和事件都绑定 connection generation，隔离旧进程的后到数据。
50. 状态查询超时为 5 秒；Session、模型和 Thinking 等异步变更命令超时为 15 秒。
51. `prompt` 的接收确认超时为 5 秒；Agent 总执行时间不设置固定上限。
52. 请求超时后立即从请求表移除；后到响应只记录并忽略，不因此单独重启 Runtime。
53. `prompt` 的 response 只代表已接收；完成必须依据 `agent_end`、`prompt_result` 或 `agentInvoked: false`。
54. RPC 响应可能乱序，始终按 ID 关联，不能依赖发送顺序。

## Prompt 与 Follow-up

55. Runtime 空闲时普通发送调用 `prompt`；Agent 运行中再次发送普通消息统一调用 `follow_up`。
56. MVP 不提供 Steer；底层协议类型可以保留，但 Preload 不暴露未使用的 Steer 操作。
57. Follow-up 模式固定为 `one-at-a-time`，严格保持发送顺序和每条消息边界。
58. Follow-up 队列由 OMP Runtime 在内存中持有，不在 Desktop 保存恢复副本，也不新增队列数据库。
59. Runtime 重启或崩溃时，尚未执行的 Follow-up 可以丢失；不为低价值恢复增加复杂度。
60. 运行中的 Slash Command 不进入 Follow-up；发送按钮直接不可用并显示灰色，任务结束后再执行。
61. 只要 Runtime 正在执行或 Follow-up 队列非空，发送按钮持续显示 Stop，不能在轮次间短暂恢复成发送图标。
62. Agent 运行期间禁止模型和 Thinking Level 切换。

## Stop 交互与语义

63. 执行开始后，原发送按钮原位切换成“圆圈内方块”的 Stop 图标，不另增第二个停止按钮。
64. 鼠标点击 Stop 和键盘 `Ctrl+C` 调用同一个 `stopCurrentRun()` IPC。
65. 对话区域存在选中文本时，`Ctrl+C` 保持系统复制；没有选中文本时才触发 Stop。
66. 用户操作后 100 ms 内进入 `stopping` 并禁止重复操作；正常路径目标约 1 秒恢复可发送状态。
67. Stop 对用户是一个原子动作；Renderer 不逐步发送一长串命令，Main 一次接收后执行完整流程。
68. Stop 固定执行 `abort → switch_session(当前 Session) → get_messages`，用同 Session 重载清空全部 Follow-up 并恢复可信历史。
69. `abort` 最长等待 5 秒；无响应时强制重启 Runtime，并恢复当前 Workspace 和 Session。
70. 同 Session 重载被 Extension 取消、失败或超过 5 秒时，同样重启 Runtime，确保当前任务和排队消息真正清空。
71. Stop 后将当前被中止的完整用户消息放回原 Session 输入框，并直接覆盖已有草稿，不做合并弹窗。
72. 如果被中止的是 Follow-up，只恢复正在执行的那一条；已完成消息保留在历史，尚未执行的 Follow-up 全部丢弃。
73. 草稿按 Workspace ID 与 Session ID 持久化；成功发送后清除，后续删除 Session 时同步清理对应草稿。

## 事件、日志与性能

74. `message_update` 和 Thinking 等高频增量必须保持顺序，并按 16–33 ms 合并后再发给 Renderer。
75. 消息开始/结束、工具开始/结束、错误和 Extension UI 请求立即转发，不参与延迟合并。
76. stderr 不进入聊天消息，只写 Runtime 诊断日志。
77. Runtime 日志按 5 MiB 轮转，最多保留 3 个文件。
78. 日志不得记录完整 Prompt、模型密钥、代理凭据或环境变量值。
79. 错误界面只显示退出码、信号和最近脱敏日志摘要，并提供“查看日志”。

## Extension UI 与系统打开能力

80. MVP 桥接 Extension UI 的 `select`、`confirm`、`input`、`editor`、`cancel` 和 `open_url`。
81. `notify`、`setStatus`、`setWidget`、`setTitle` 等非阻塞展示不进入当前 UI 范围。
82. Renderer 重载时，Main 保留未完成的 Extension UI 请求，并在新 Renderer 订阅后重发；原超时继续计算。
83. 应用退出、Runtime 重启或请求超时时，未完成的 Extension UI 请求统一返回取消。
84. Extension 的 `open_url` 只允许 HTTP/HTTPS，并由 Main 交给系统默认浏览器；允许 localhost、回环地址、局域网地址、公网地址和端口。
85. `file:`、`javascript:`、`data:` 和其他自定义 URL 协议一律禁止。
86. 聊天中的 HTTP/HTTPS 链接使用 `Ctrl+点击` 交给系统默认浏览器，包括本地前端开发地址。
87. 聊天中的有效本地文件或目录路径使用 `Ctrl+点击` 交给系统文件管理器定位或打开；MVP 不实现应用内浏览器、文件打开器或编辑器。
88. 本地路径必须是已经存在的绝对路径；允许 Workspace 外路径，但必须由 Main 校验，Renderer 不能直接获得 Shell 权限。

## Preload、IPC 与错误

89. Preload 只提供命令专用、类型明确的方法，例如 `getState`、`prompt`、`followUp`、`stopCurrentRun`、`switchSession`、`setModel` 和 `subscribe`。
90. Preload 不暴露通用 `rpc(command)`、通用 `invoke` 或原始 `ipcRenderer`。
91. 事件订阅必须返回取消函数，Renderer 重载和组件卸载时清理监听。
92. IPC 只接受当前主窗口的 `webContents`、顶层 frame 和允许的本地来源；开发模式只允许已配置的开发 URL。
93. 窗口销毁后，旧 Renderer 的请求和订阅全部失效。
94. Main 校验路径、枚举、文本和结构化参数，不信任 Renderer 输入。
95. 错误使用稳定结构 `code`、`message`、`retryable`；至少覆盖 `RUNTIME_NOT_READY`、`START_FAILED`、`CRASHED`、`RPC_TIMEOUT`、`PROTOCOL_ERROR`、`INVALID_ARGUMENT`、`SESSION_NOT_FOUND` 和 `UNSUPPORTED`。
96. Renderer 只按错误码分支，不能解析可能变化的错误文本。

## 测试与验收边界

97. JSONL 测试覆盖分包、粘包、空行、16 MiB 上限、单次错误和 10 秒内连续错误。
98. 请求测试覆盖 UUID、generation 隔离、分级超时、后到响应、响应乱序和进程退出。
99. 使用假 OMP 进程验证 `ready → get_state → response`、15 秒启动失败和单次自动重启。
100.  Renderer 测试覆盖刷新后的状态恢复、事件重订阅和 Extension UI 请求重放。
101.  交互测试覆盖普通 Prompt、逐条 Follow-up、Slash Command 禁用、模型控件禁用、鼠标 Stop、`Ctrl+C`、文本复制、队列清空和 Prompt 恢复。
102.  进程测试必须确认应用关闭、Stop、崩溃和重启后没有遗留 OMP 及其子进程。
103.  保留并扩展 `scripts/rpc-smoke.mjs`；无真实凭据的 CI 使用明确的假 Runtime 模式，真实二进制 smoke 需要可用模型配置。
104.  MVP-02 只验证最终 `env` 能传给 Runtime；完整 Runtime Profile、代理和 Agent Bash 继承由 MVP-08 验收。
