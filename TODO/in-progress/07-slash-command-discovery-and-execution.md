# MVP-07：Slash Command 发现、补全与执行

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-06
- 后续任务：MVP-08

## 目标

补齐 OMP RPC 的 Slash Command 执行和发现链路，让用户可以在 Composer 中查看、搜索和补全当前 Session 真实可用的命令。

## 已有基础

- `RuntimeSupervisor` 已处理 `prompt` 响应中的 `agentInvoked: false` 和后续 `prompt_result`，本地命令结束后会退出运行状态。
- Renderer 和 Main 已在 Agent 运行期间拒绝 Slash Command，普通消息仍可进入 Follow-up 队列。
- 项目已经使用 `cmdk` 和 Radix Popover，可以复用现有依赖实现命令菜单。

## 明确不做

- 不硬编码 `/model`、`/compact` 等命令列表。
- 不在 Renderer 扫描 Skill、Extension、MCP Prompt 或命令文件。
- 不在本任务中安装、启停或编辑 Skill、Extension、MCP Prompt 和自定义命令；命令选择与命令来源管理分开。
- 不拦截未知 `/...` 输入。未被 OMP 识别的 Slash 文本仍按 OMP 现有语义作为普通 Prompt 处理。

## 任务清单

### Slash Command 执行语义

- [ ] 将同一次 Prompt 的多条 `command_output` 按原文直接拼接为一个紧凑、可展开的“命令结果”，不额外插入空格或换行，不把它伪装成 Assistant 回答或 Tool Call。
- [ ] 显示和复制前去掉 ANSI 终端控制序列，保留普通换行、空格和 Tab；清理后没有非空输出时不创建空结果框。
- [ ] “命令结果”只在当前运行期显示，不由 Desktop 持久化；切换 Session 或重启后不要求从历史恢复。
- [ ] 本地命令的用户输入与“命令结果”一起作为临时内容；OMP 未写入历史时 Desktop 不单独持久化。会调用 Agent 的 Slash 在当前运行期显示正式命令，恢复历史时接受 OMP 保存的展开后 Prompt，不建立额外显示映射。
- [ ] 处理 `config_update`，立即同步当前模型和 Thinking Level 控件，不增加对话消息或 Toast。
- [ ] 处理 `session_info_update`，同步当前 Session 的名称和标识，并刷新对应 Session 摘要；仅标题变化时不增加对话消息或 Toast。
- [ ] `session_info_update` 改变 Session ID 时按真实 Session 切换处理：刷新目标历史和侧栏、清空并重查命令目录、加载目标 Session 草稿；新 Session 继承当前 Runtime 权限，已有 Session 恢复其已保存权限。
- [ ] 保留 `agentInvoked: false` 和 `prompt_result` 的现有结束逻辑；本地命令不得等待不存在的 `agent_end`。
- [ ] 保留 Renderer 和 Main 对运行中 Slash Command 的双重拒绝：目录合法且最新时只拒绝第一个命令词与正式名称或别名精确匹配的输入；没有成功目录或当前只剩刷新失败的旧结果时拒绝所有 `/...`；目录最新时不完整前缀和无匹配文本仍按普通 Follow-up 处理。

### 动态命令目录

- [ ] 新增与 OMP RPC 对齐的 `AvailableSlashCommand` 类型：`name`、`aliases`、`description`、`input.hint`、`subcommands` 和 `source`。
- [ ] `source` 只接受 OMP 当前返回的 `builtin`、`skill`、`extension`、`custom`、`mcp_prompt` 和 `file`。
- [ ] 在 `RuntimeSupervisor`、类型化 Main IPC 和 Preload API 中接入 `get_available_commands`。
- [ ] Runtime 就绪和 Session 切换后主动查询一次命令目录，避免 Renderer 因订阅较晚而错过启动事件。
- [ ] Session 切换时先清空旧命令目录，再查询目标 Session；不能在查询期间显示前一个 Session 的命令。
- [ ] 命令菜单打开时重新查询一次，使磁盘命令变更可以在下次打开菜单时生效；Desktop 不自行监听或扫描命令目录。
- [ ] 监听 `available_commands_update`，将每次事件作为完整快照替换缓存，不与旧目录增量合并。
- [ ] 同一 Runtime 和 Session 的查询不并发；进行中的查询直接复用，查询完成后下次打开菜单再发起新查询。
- [ ] 查询绑定 Runtime 实例和 Session ID，丢弃 Session 切换、Runtime 重启后的迟到响应和旧 Runtime 更新事件。
- [ ] 严格校验整份命令快照，任一命令不符合协议就拒绝整份快照，保留同一 Session 上次成功结果并记录诊断错误。
- [ ] 同一 Session 查询或更新失败时保留上次成功快照，并在菜单内提示当前显示旧结果；目标 Session 没有成功快照时显示错误和空列表，不影响普通 Prompt 输入。
- [ ] 查询失败后不做定时重试，只在下次打开菜单时重试或由合法更新事件恢复；错误只在菜单或相关 Slash 提交处显示，不进入全局错误状态。

### Composer 命令菜单

- [ ] 输入内容去除开头空白后以 `/` 开始，且光标位于第一个命令词内时打开菜单；裸 `/` 显示全部命令，Agent 运行期间不打开。
- [ ] 候选只按正式名称和别名做不区分大小写的前缀过滤，精确匹配优先；描述只显示，不参与搜索，无匹配时关闭菜单。
- [ ] 上键和下键切换当前高亮候选；Tab 将候选补全为正式名称 `/command ` 且不提交，Enter 直接提交当前高亮候选，Esc 关闭菜单并保留原文。
- [ ] 裸 `/` 默认选中第一项；Enter 提交该项，Esc 关闭菜单后再按 Enter 才发送原始 `/`。
- [ ] 一级命令补全并出现空格后关闭一级菜单，允许继续输入参数；完整文本仍原样交给 OMP。
- [ ] 候选保持 OMP 返回顺序，只将精确匹配提到前面；显示英文 `source` 原值和描述，不按来源分组。
- [ ] 将 `input.hint` 显示为不写入输入框的参数提示；存在 `subcommands` 时在一级命令后的空格处提供第二级候选，Tab 补全、Enter 提交，并显示 `usage`。
- [ ] 菜单只显示正式名称，不显示或单列别名；别名仍参与过滤和精确匹配。
- [ ] 通过别名找到的候选补全为正式名称；直接提交精确别名时也将第一个命令词规范化为正式名称并保留参数，未知命令不改写。
- [ ] 多个正式命令使用相同别名时全部保留并维持 OMP 顺序；直接提交该别名时采用第一项正式名称。
- [ ] 已知命令带前导空白时，Tab、Enter 或直接发送都去掉前导空白并使用正式名称；未知命令保留完整原文。
- [ ] 切回 Session 并恢复 Slash 草稿时自动重新打开菜单；命令目录仍在查询时显示加载状态。
- [ ] 菜单打开时收到完整更新快照，按正式名称保留仍存在的选中项；候选消失后选中第一项，无匹配时关闭菜单并保留输入。
- [ ] 目录加载且没有候选时不阻塞发送，Enter 原样提交当前文本。
- [ ] 鼠标点击候选只补全不提交；鼠标悬停同步高亮，移出后保留高亮。
- [ ] 菜单位于 Composer 上方，最多直接显示 8 条且宽度不超过输入框；超出后支持鼠标滚轮和键盘驱动的内部滚动。
- [ ] 每条候选固定单行：正式名称和 `input.hint` 在左、描述在中、英文 `source` 在右；长描述省略，不换行。
- [ ] Renderer 只负责候选交互；Enter 提交的完整命令文本仍通过现有 `prompt` 交给 OMP 解析和执行。

### 顶层消息操作

- [ ] 用户 Prompt、Assistant 最终文本和“命令结果”使用同一种复制入口；用户 Prompt 保留可见文字和 `@` 路径但不复制图片数据，Assistant 最终文本复制原始 Markdown，“命令结果”复制完整原文。
- [ ] Thinking、Tool Call、Lifecycle、权限确认和其他过程信息不增加上述顶层复制入口。
- [ ] 复制按钮一直显示；Assistant 最终文本和“命令结果”都放在内容正下方，用户 Prompt 使用贴近气泡右侧的紧凑按钮，使用小尺寸、紧凑间距和克制颜色。
- [ ] 复制成功后在原位置显示勾约 1.5 秒，不弹 Toast、不造成布局变化。
- [ ] 复制失败时在原位置显示失败图标和“复制失败”约 1.5 秒，不弹 Toast；只有剪贴板确认成功后才显示勾。
- [ ] “命令结果”默认最多显示 8 行，超出后显示总行数和“展开”；展开后显示完整内容并可收起，折叠状态下复制仍取得完整原文。

### 测试

- [ ] 测试 `agentInvoked: false` 和后续 `prompt_result` 都能结束本地命令，且不会等待 `agent_end`。
- [ ] 测试 `command_output` 的直接拼接、ANSI 清理、空输出忽略，以及 `config_update` 和 `session_info_update` 的静默状态归并。
- [ ] 测试本地命令的输入和结果不持久化，以及调用 Agent 的 Slash 在实时显示正式命令、历史恢复使用 OMP 展开后 Prompt。
- [ ] 测试启动事件丢失后可通过主动查询恢复命令目录，并测试 Session 切换和 `available_commands_update` 的整表替换。
- [ ] 测试命令菜单的触发、名称/别名前缀过滤、精确匹配优先、描述不参与搜索、裸 `/` 默认选择、Tab 补全、Enter 提交、Esc 保留原文、子命令和运行中禁用。
- [ ] 测试 Session 切换时清空旧目录、恢复各自输入草稿，以及恢复 Slash 草稿后重新打开菜单。
- [ ] 测试同一 Session 刷新失败时保留旧快照并显示提示，切换 Session 后不沿用前一个 Session 的目录。
- [ ] 测试非法命令项导致整份快照拒绝、失败后不定时重试、错误不进入全局状态，以及没有最新合法目录时运行中拒绝所有 Slash。
- [ ] 测试查询去重、Session 或 Runtime 改变后的迟到结果丢弃，以及菜单打开时更新快照对当前选中项的保留和回退。
- [ ] 测试 `session_info_update` 触发真实 Session 切换，并覆盖新 Session 继承当前权限和已有 Session 恢复已保存权限。
- [ ] 测试来源英文原值、OMP 原始顺序、别名只参与匹配不显示、别名和前导空白规范化、`input.hint` 只显示不插入，以及子命令的 Tab 和 Enter 行为。
- [ ] 测试别名冲突时保留全部正式候选并使用 OMP 第一项，以及候选固定单行和长描述省略。
- [ ] 测试目录加载期间 Enter 原样提交、鼠标点击只补全、悬停高亮，以及 8 条可见上限和鼠标滚轮/键盘滚动。
- [ ] 测试用户 Prompt、Assistant 最终 Markdown 和“命令结果”的复制内容、按钮常显位置、成功与失败反馈，以及 8 行折叠不截断复制内容。
- [ ] 测试 `builtin`、`skill`、`extension`、`custom`、`mcp_prompt` 和 `file` 六种来源可显示，但 Renderer 不按来源分别加载。
- [ ] 测试未知 Slash 文本仍提交给 OMP，不被菜单或 Renderer 拒绝。

## 完成条件

- [ ] 可以展示当前 Session 真实可用的动态命令目录，并在 Runtime 就绪、Session 切换、OMP 更新事件和菜单重新打开后刷新。
- [ ] 本地 Slash Command 的输出可见，执行结束后不会制造持续运行状态。
- [ ] 会调用 Agent 的 Slash Command 继续复用现有流式 Run。
- [ ] Slash Command 菜单可用键盘完成搜索、补全和子命令选择，不在 Renderer 执行命令。

## 复用重点

- OMP RPC 的 `get_available_commands` 和 `available_commands_update`：作为命令目录的唯一来源。
- 现有 `cmdk`、Radix Popover 和 Composer 候选交互：不要新增命令菜单依赖。

## 核对依据

- OMP RPC 协议：<https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md>
- OMP RPC 类型：<https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-types.ts>
- OMP 命令目录实现：<https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/slash-commands/available-commands.ts>
- OMP Slash Command 发现和执行顺序：<https://github.com/can1357/oh-my-pi/blob/main/docs/slash-command-internals.md>
- Codex TUI 命令菜单：<https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/command_popup.rs>
- Codex TUI Slash 输入处理：<https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/chat_composer/slash_input.rs>
