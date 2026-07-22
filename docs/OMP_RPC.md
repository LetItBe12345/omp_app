# OMP RPC 能力索引

## 结论

OMP RPC 已经是一套比较完整的 **Headless Agent 控制接口**。

它不只是“发送 Prompt”。它可以控制：

- Agent 对话和流式输出
- 工具调用
- 模型与 Thinking 等级
- 会话、分支、压缩、重试
- Todo
- 子 Agent
- 扩展 UI
- OAuth 登录
- 宿主自定义工具
- 宿主虚拟文件系统

因此，**它足以支撑 Electron Desktop 的 MVP**。不需要修改 OMP 核心。

我检查的是 OMP `main` 分支在 **2026 年 7 月 20 日**的提交 `89d6a8f6`。

---

## 一、协议本身

启动方式：

```bash
omp --mode rpc
```

通信方式：

- Electron 向 OMP `stdin` 写 JSONL。
- OMP 从 `stdout` 返回 JSONL。
- 每行一个 JSON 对象。
- 启动后首先输出：

```json
{ "type": "ready" }
```

它不是 HTTP，也不是 gRPC，更不是标准 JSON-RPC 2.0。它本质是 **基于 stdio 的自定义 RPC 协议**。

---

# 二、全部 39 个 RPC 命令

| 类别     | 命令                        | 能做什么                         |
| -------- | --------------------------- | -------------------------------- |
| 对话     | `prompt`                    | 发送普通 Prompt，支持图片        |
|          | `steer`                     | Agent 工作中插入指令             |
|          | `follow_up`                 | 当前任务完成后继续执行           |
|          | `abort`                     | 中止当前 Agent                   |
|          | `abort_and_prompt`          | 中止后立即发送新 Prompt          |
|          | `new_session`               | 新建会话，支持父会话关系         |
| 状态     | `get_state`                 | 获取完整运行状态                 |
|          | `get_available_commands`    | 获取当前可用 Slash Commands      |
|          | `set_todos`                 | 设置当前 Todo 和阶段             |
|          | `set_host_tools`            | 注册 Electron 自己实现的工具     |
|          | `set_host_uri_schemes`      | 注册虚拟 URL/文件协议            |
|          | `set_subagent_subscription` | 设置子 Agent 事件订阅级别        |
|          | `get_subagents`             | 获取当前子 Agent                 |
|          | `get_subagent_messages`     | 获取子 Agent 消息和日志          |
| 模型     | `set_model`                 | 切换指定模型                     |
|          | `cycle_model`               | 循环切换模型                     |
|          | `get_available_models`      | 获取可用模型列表                 |
| Thinking | `set_thinking_level`        | 设置推理等级                     |
|          | `cycle_thinking_level`      | 循环切换推理等级                 |
| 消息队列 | `set_steering_mode`         | 设置 Steering 消息处理方式       |
|          | `set_follow_up_mode`        | 设置 Follow-up 消息处理方式      |
|          | `set_interrupt_mode`        | 立即打断工具或等待当前 Turn 完成 |
| 上下文   | `compact`                   | 手动压缩上下文                   |
|          | `set_auto_compaction`       | 开关自动压缩                     |
| 重试     | `set_auto_retry`            | 开关自动重试                     |
|          | `abort_retry`               | 中止当前重试                     |
| Shell    | `bash`                      | 直接执行 Shell 命令              |
|          | `abort_bash`                | 中止 Shell 命令                  |
| 会话     | `get_session_stats`         | 获取 Token、费用等统计           |
|          | `export_html`               | 导出 HTML 会话                   |
|          | `switch_session`            | 切换已有会话                     |
|          | `branch`                    | 从某条消息创建分支               |
|          | `get_branch_messages`       | 获取可以分支的用户消息           |
|          | `get_last_assistant_text`   | 获取最后一条助手文本             |
|          | `set_session_name`          | 设置会话名称                     |
|          | `handoff`                   | 生成 Handoff 并创建新上下文      |
| 消息     | `get_messages`              | 获取完整消息历史                 |
| 登录     | `get_login_providers`       | 获取 OAuth Provider              |
|          | `login`                     | 执行 OAuth 登录                  |

这是源码 `RpcCommand` 联合类型中的完整列表。

### Desktop 中的执行边界

RPC 只负责传输命令、响应和事件。`bash` 由 OMP Runtime 实际执行，不经过 Desktop 的内置 Terminal 或 PTY。

Desktop 启动 `omp --mode rpc` 时通过子进程 `env` 传入 PATH、普通环境变量和代理变量。OMP Runtime 后续启动的 Bash Tool 子进程默认继承这份最终环境。

环境或代理发生变化时，Desktop 需要重启 OMP Runtime，再恢复当前 Session。

---

## 三、`get_state` 可以读到什么

桌面端可以直接获得：

- 当前模型
- Thinking 等级
- 是否正在生成
- 是否正在压缩
- Steering 模式
- Follow-up 模式
- Interrupt 模式
- Session ID
- Session 文件路径
- Session 名称
- 消息数量
- 排队消息数量
- Todo 状态
- 当前 System Prompt
- 当前全部工具及其 JSON Schema
- Context Window 使用量和百分比

这意味着模型选择器、上下文进度条、Todo 面板、工具列表等都可以直接做。

---

# 四、流式事件

OMP 会主动向 Electron 推送：

### Agent 生命周期

- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`

### 消息流

- `message_start`
- `message_update`
- `message_end`

`message_update` 可以包含：

- 文本增量
- Thinking 增量
- Tool Call 增量

但 Thinking 只能显示模型实际提供的推理内容，不能获取模型隐藏的内部思维。

### 工具执行

- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

可以做出 Codex App 那种实时工具卡片、命令输出和执行状态。

### 其他状态事件

还包括：

- 自动压缩开始、结束
- 自动重试开始、结束
- Fallback 模型切换
- TTSR 触发
- Todo 提醒和自动清理
- IRC 消息
- Notice
- Thinking 等级变化
- Goal 状态变化

---

# 五、扩展 UI 可以映射到 Electron

OMP Extension 可以请求宿主显示：

- `select`：选择框
- `confirm`：确认框
- `input`：单行输入
- `editor`：多行编辑器
- `notify`：通知
- `setStatus`：状态栏
- `setWidget`：小组件
- `setTitle`：窗口标题
- `set_editor_text`：修改输入框内容
- `open_url`：打开 OAuth 页面
- `cancel`：取消之前的交互

Electron 返回选择结果、确认结果、输入内容或取消状态。

不过，TUI 专属组件无法直接复用：

- 自定义 Header/Footer 不支持
- TUI Component Factory 不支持
- Theme 切换不支持
- 自定义自动补全 Provider 不支持
- 自定义 Editor Component 不支持

这些 UI 需要 Electron 自己渲染。

---

# 六、Electron 可以向 Agent 注入自定义工具

通过 `set_host_tools`，Electron 可以注册任意 JSON Schema 工具。

例如：

- 打开系统文件选择器
- 操作剪贴板
- 调用系统通知
- 保存密钥到 Keyring
- 打开浏览器
- 管理项目
- 操作 Git GUI
- 调用 Electron 原生 API
- 控制其他本地进程

调用流程：

```text
OMP → host_tool_call → Electron
Electron → host_tool_update → OMP
Electron → host_tool_result → OMP
```

支持流式进度、错误和取消。

这是 RPC 最有价值的部分。它让 Desktop 扩展 OMP，而不用 Fork OMP。

---

# 七、Electron 可以提供虚拟文件系统

通过 `set_host_uri_schemes` 可以注册：

```text
db://users/42
notion://page/123
workspace://settings
desktop://projects/foo
```

Agent 可以直接使用已有的 `read` 和 `write` 工具访问这些资源。

支持：

- 读取
- 完整覆盖写入
- Markdown、JSON、纯文本
- 只读资源
- Immutable 资源
- 错误和取消

限制是 `edit` 不能操作这些虚拟 URI，只能使用 `write` 完整替换。

---

# 八、子 Agent 支持

订阅级别：

- `off`：关闭，默认
- `progress`：生命周期和进度
- `events`：再加上完整子 Agent 事件

桌面端可以显示：

- 子 Agent 名称
- 任务
- 状态
- 当前进度
- 父工具调用
- 独立 Session
- 独立消息历史
- 增量读取日志

---

# 九、Slash Commands、Skills 和 Extensions

`prompt` 不只是发送给模型。

OMP 会依次处理：

1. Skill 命令
2. Headless 可用的内置 Slash Command
3. Extension Command
4. Prompt Template
5. 普通 Agent Prompt

可用命令会通过：

```text
get_available_commands
available_commands_update
```

动态提供给 Desktop。

因此不要硬编码 `/model`、`/compact` 等命令列表。直接使用 OMP 返回的数据。TUI-only 命令会被过滤，因为它们无法在无头模式执行。

---

# 十、必须注意的坑

1. **Prompt 的成功响应不代表任务完成。**
   `prompt` 只是立即确认已接收。真正完成看 `agent_end`、`prompt_result` 或 `agentInvoked:false`。

2. **正在生成时再次发送 Prompt，必须指定 `steer` 或 `followUp`。**

3. **普通命令串行执行，但 `bash` 并发执行。**
   返回顺序不固定，必须按 `id` 匹配。

4. **RPC 没有直接的 `set_cwd` 命令。**
   工作目录应在启动 OMP 时通过 `--cwd` 设置。

5. **RPC 没有直接动态修改内置工具 Allowlist 的命令。**
   内置工具通过启动参数 `--tools` 控制。Host Tools 可以动态替换。

6. **部分 OAuth Provider 不支持完全 Headless 登录。**
   如果 Provider 在生成登录 URL 前就要求交互，必须先在 TUI 登录。

7. **官方 `RpcClient` 只是便利封装。**
   它没有保证覆盖所有协议能力。完整实现应以 `rpc-types.ts` 和原始 JSONL 为准。

---

## 对 Desktop 的明确判断

推荐结构：

```text
React Renderer
      │ Electron IPC
Electron Main
      │ stdin/stdout JSONL
omp --mode rpc
```

Electron Main 负责：

- 启动和关闭 OMP
- 维护请求 ID
- 解析事件
- 管理 Session 对应的进程
- 执行 Host Tools
- 将安全的事件转发给 Renderer

**MVP 不要 Fork OMP。**

先做：

1. 对话和流式输出
2. 工具调用卡片
3. Stop、Steer、Follow-up
4. 模型和 Thinking 选择
5. Session 新建、切换、历史
6. Extension UI
7. 一个 OMP 进程对应一个活跃 Workspace

现有 RPC 已经覆盖这些核心需求。真正缺的是 Electron UI 层，不是 Runtime 能力。
