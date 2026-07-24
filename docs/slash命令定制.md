你说得对。上次 GitHub 连接器用得太浅，只看了总表，没有继续读源码和 PR。用法不合格。

## 最终判断

**不改 MVP-05、MVP-06。也不新增独立任务。**

把 Slash Command 放进现有 **MVP-07**。将它改名为：

> **MVP-07：输入命令、文件树与上下文引用**

原因很直接：

- MVP-05 已经定义 Session、Composer 和 `@` 候选机制。
- MVP-06 完整依赖 MVP-05，专门处理 Session 权限和审批。边界很清楚。
- MVP-07 本来就负责 Composer 与本地上下文联动。Slash 补全也属于输入体验，不属于权限，也不属于环境代理。
- 单独插入新任务会导致后续全部重新编号。收益很低。

## MVP-07 内部执行顺序

### 1. 先修正 Slash 执行语义

当前并不是“已经能正常执行”。

OMP 的本地 Slash Command 可以直接返回 `agentInvoked: false`，同时输出 `command_output`。

但当前 Desktop：

- `prompt()` 收到响应后无条件设置 `isStreaming: true`。
- Renderer 没处理 `command_output`。
- `/help` 这类本地命令存在卡在运行状态、输出被丢弃的问题。

需要：

- `prompt()` 返回 `{ agentInvoked: boolean | undefined }`。
- `agentInvoked: false` 时不进入 Streaming。
- 支持 `command_output`，显示为紧凑的“命令结果”。
- 处理 `config_update`、`session_info_update`，刷新模型、Thinking 和 Session 状态。
- 继续禁止运行中 Slash Command。Main 已有这层校验。

### 2. 接入动态命令目录

新增：

- `AvailableSlashCommand` 类型。
- `RuntimeSupervisor.getAvailableCommands()`。
- 类型化 Main IPC。
- Preload `getAvailableCommands()`。
- Renderer 独立的 Command Catalog 状态。

命令字段直接对齐 OMP：

- `name`
- `aliases`
- `description`
- `input.hint`
- `subcommands`
- `source`

OMP 已经提供完整结构。

Runtime 就绪和 Session 切换后主动调用一次 `get_available_commands`。同时监听 `available_commands_update`。OMP 会在启动、命令元数据变化和 Session 切换后发送更新。

不能只依赖事件。Renderer 晚于 Runtime 订阅时，会错过首次更新。

### 3. Composer 命令菜单

复用已有的：

- `cmdk`
- Radix Popover
- MVP-05 的 Composer 候选框基础设施

项目已经使用这套组件实现模型搜索，不需要增加依赖。

交互规则：

- 仅当首个非空字符是 `/` 时打开。
- 只按正式名称和别名做不区分大小写的前缀过滤；描述只显示，不参与搜索。
- 选择后只插入 `/command `，不立即执行。
- 别名匹配后插入正式名称。
- 有子命令时显示第二级候选。
- 显示参数 Hint，但不把 Hint 文本写入输入框。
- 上下键切换当前高亮候选；Enter 提交当前高亮候选；Tab 只补全；Esc 关闭菜单并保留原文。
- Agent 运行期间不打开菜单。
- 不硬编码 `/model`、`/compact` 等命令。
- 不在 Renderer 解析或执行命令。

## MVP-07 新增验收

- 动态展示 OMP 当前真实可用命令。
- Skills、Extensions、文件命令发生变化后自动刷新。
- `/help` 等本地命令不会制造假 Streaming。
- `command_output` 可以正常显示。
- 调用 Agent 的 Slash Command 继续走原有流式 Run。
- Session 切换后命令目录正确更新。
- Renderer 重载后可以重新获取命令。
- 运行中 Slash Command 仍被 Renderer 和 Main 双重拒绝。

**所以最合理的方案是：保持 5、6 不动，将 Slash Command 作为 MVP-07 的第一部分，先修协议语义，再做命令菜单，最后继续实现原有文件树。**
可以。

但要区分两件事：

## RPC 能获取什么

OMP RPC 有：

```text
get_available_commands
```

它会返回当前 Session 真正可用的 Slash Command 列表。每项包括：

- `name`
- `aliases`
- `description`
- `input.hint`
- `subcommands`
- `source`

其中 `source` 已经标明来源：

```text
builtin
skill
extension
custom
mcp_prompt
file
```

所以你说得对，Slash Command 本身确实是一个**混合入口**。它里面可能是：

- OMP 内置命令
- Skill
- Extension 注册命令
- 自定义命令
- MCP Prompt
- 项目文件中的 Prompt Command

OMP 内部已经负责把这些来源汇总、去重，然后通过 RPC 返回。Desktop 不需要自己扫描这些目录。

## RPC 不能获取什么

这个接口目前主要是**命令目录**，不是完整管理接口。

它可以：

- 列出命令
- 获取描述和参数提示
- 获取命令来源
- 监听 `available_commands_update`
- 通过普通 `prompt` 执行命令

它不能直接：

- 启用或禁用 Skill
- 安装 Extension
- 编辑自定义命令文件
- 修改 MCP Prompt
- 管理 Plugin 配置

这些属于不同来源各自的管理能力。

## Desktop 应该怎么设计

MVP 先只做一个统一的 **Command Palette**：

```text
/help            内置
/my-skill        Skill
/review          Extension
/deploy          自定义命令
/github-issue    MCP Prompt
/test            文件命令
```

UI 可以按 `source` 显示小标签，但不要在前端分别实现六套加载逻辑。

执行时仍把完整文本交给：

```text
prompt("/command args")
```

OMP 会先判断 Skill，再判断内置命令、Extension 命令和文件模板。

**结论：RPC 能完整获取“当前可执行 Slash Command 的统一视图”。但它不是 Skill、Plugin、MCP 的管理 API。命令选择和命令管理应该分开设计。**
