# MVP-04：流式对话与执行轨迹

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-02、MVP-03
- 后续任务：MVP-05、MVP-08

## 目标

完成最小聊天闭环，并正确展示文本、Thinking、Tool Call 和 Permission。

## 核心交互

- Thinking、工具调用和最终文本属于同一个 Assistant Turn。
- 普通 assistant 文本在运行中按 OMP 原始位置显示，不预先认定为最终回答。
- 运行中默认展开执行轨迹。
- 成功完成后，按 `decision/04-streaming-conversation-and-run-trace.md` 的终止规则划出最终回答，并自动折叠其余执行轨迹。
- 失败、等待确认和用户手动展开时保持展开。
- 无法可靠划出最终回答时保持原始顺序，不猜测、不丢失文本。
- 最终回答始终比过程信息更突出。

## 明确不做

- 不把 Thinking 和每次 Tool Call 渲染成独立聊天消息。
- 不展示模型未提供的隐藏推理。
- 不在每个 token 到达时触发一次完整 React 更新。
- 不先实现复杂主题系统和富媒体组件市场。

## 任务清单

### 数据模型

- [ ] 定义统一的 `AssistantTurn` 和有序 `TurnItem` 数据结构，保留 assistant 消息边界与内容顺序。
- [ ] 最终回答使用有序内容的引用或索引表示，不与执行轨迹重复保存完整文本。
- [ ] 建立 `OmpEventReducer`，按原始顺序归并文本、Thinking、Tool Call 和 Tool Result。
- [ ] `OmpEventReducer` 只做事件归并和字段转换，不实现 Agent 状态机、消息持久化、工具调度或重试。
- [ ] 正确处理 `message_start/update/end`；把 `message_update` 视为累计快照并替换当前消息投影，禁止重复追加。
- [ ] 正确处理 Thinking 增量。
- [ ] 使用 `toolCallId` 归并 Tool Call 参数、进度、结果和错误。
- [ ] 正确处理 Agent、Turn、Retry、Compaction 和 Notice 状态。
- [ ] 实现纯函数形式的最终回答分类规则，覆盖无工具消息和最后一个 Tool Call 后的结尾文本。
- [ ] 只有成功的 `agent_end` 才执行最终分类；失败、中止、等待 Permission 或信息不足时保留完整轨迹。
- [ ] 历史消息恢复与实时事件使用同一投影函数和最终回答分类规则。

### 流式性能

- [ ] 将高频增量写入内存 buffer。
- [ ] 每 16–33 ms 合并一次 UI 更新。
- [ ] 为单个 IPC 事件批次同时设置事件数量和累计字节数上限，达到任一上限立即发送。
- [ ] 只更新当前 Assistant Turn。
- [ ] 原始 RPC 事件处理后释放，Reducer、React 和 assistant-ui 不重复保存完整消息。
- [ ] 已完成 Markdown 结果使用有上限的缓存，不重复解析完整历史。
- [ ] 长对话使用虚拟列表或等价方案。
- [ ] Tool Call 进度更新限频。
- [ ] Tool Call 大输出只渲染受控窗口或摘要，不在多个状态中保留完整副本。
- [ ] 图片数据处理完成后释放重复 Base64 副本。

### UI

- [ ] 用户消息靠右，使用紧凑的极浅灰背景。
- [ ] Assistant 消息靠左，白底黑字，不使用头像和气泡。
- [ ] 当前执行轨迹在生成时展开，普通文本、Thinking 和工具信息按 OMP 原始顺序流式更新。
- [ ] 成功结束时只重分类一次：把最终文本移到轨迹外，其余内容折叠为“耗时、工具数、状态”的单行摘要。
- [ ] 展开已完成轨迹后恢复全部过程内容的原始顺序，不把工具集中到独立区域。
- [ ] 同一段最终文本只渲染一次，移动到最终回答区域后不在轨迹中保留副本。
- [ ] Tool Call 默认只显示名称、状态和一行摘要，可以再次展开查看输入、完整输出和错误。
- [ ] Permission 请求显示在对应 Tool Call 的原始位置，并滚动到该位置，不打开居中模态框。
- [ ] Permission 只显示 OMP RPC 实际提供的选项；v17.0.6 通用工具审批使用 `Approve` 和 `Deny`，不自行增加授权范围。
- [ ] 文件改动只显示简短摘要，不在对话流展开完整 Diff。
- [ ] 自动滚动只在用户位于底部附近时生效。
- [ ] 用户主动向上滚动后停止自动跟随，并显示“有新内容”；点击后回到底部并恢复自动跟随。
- [ ] 已完成轨迹的手动展开状态不持久化；重新打开 Session 时，成功任务折叠，失败和等待 Permission 的任务展开。

### 输入区

- [ ] 支持普通 Prompt。
- [ ] 生成开始后，发送按钮原位切换为圆圈内方块的 Stop 图标；执行链结束后恢复。
- [ ] 运行中普通发送使用逐条 Follow-up，不提供 Steer。
- [ ] 只要 Runtime 正在执行或 Follow-up 队列非空，持续显示 Stop。
- [ ] 鼠标点击 Stop 和无选中文本时的 `Ctrl+C` 使用同一操作；有选中文本时保留复制。
- [ ] Stop 后恢复当前被中止的用户消息，并清空未执行的 Follow-up。
- [ ] 运行中的 Slash Command 禁止发送。
- [ ] 显示连接、生成、重试和错误状态。
- [ ] 禁止重复提交同一输入。

### 权限

- [ ] 在模型和 Thinking Level 旁增加固定文案为“权限”的控制按钮，不使用“盾牌”或“工作区写入”作为按钮名称。
- [ ] 权限 Popover 显示 `always-ask`、`write`、`yolo` 三种 OMP 审批模式及各自会自动允许的工具等级。
- [ ] 当前 Workspace 没有保存值时使用 `write`；按规范化 Workspace 路径将选择保存到 Desktop 数据目录，不修改项目 `.omp/config.yml`。
- [ ] 在 `RuntimeSnapshot` 和受控 IPC 中加入 Desktop 当前使用的权限模式，不把 Renderer 显示值建立在无法读取的 OMP 内部状态上。
- [ ] 启动 Runtime 时追加 `--approval-mode <mode>`；权限修改后重启 Runtime，并恢复原 Session。
- [ ] Runtime 正在执行、Follow-up 队列非空或等待 Permission 时禁用权限切换。
- [ ] 切换到 `yolo` 前显示风险确认，取消后不修改配置、不重启 Runtime。
- [ ] 将 OMP `extension_ui_request: select` 审批请求接入对应 Tool Call，并通过 `respondExtensionUi` 回传选择。
- [ ] MVP 不实现单工具 `allow`、`prompt`、`deny` 规则编辑器。

### 测试

- [ ] 为事件乱序、重复和缺失结束事件编写 reducer 测试。
- [ ] 测试连续 `message_update` 累计快照不会造成文本重复。
- [ ] 测试“过程文本 → 工具 → 最终文本”和单条混合 assistant 消息都保持原始顺序。
- [ ] 测试多个 Tool Call 按 `toolCallId` 配对结果，且中间普通文本不会被移到错误位置。
- [ ] 测试无工具的正常结尾、最后一个工具后的结尾文本和无法判断最终回答三类分类结果。
- [ ] 测试成功重分类后最终文本只出现一次，稳定 key 不因折叠产生重复节点。
- [ ] 测试运行中展开、成功折叠、失败保持展开。
- [ ] 测试历史恢复和实时事件生成相同的 Assistant Turn，且不会重复消息。
- [ ] 测试主动向上滚动时停止跟随、“有新内容”恢复跟随和底部附近自动滚动。
- [ ] 测试 Tool Call 摘要默认折叠，输入、输出和错误可以独立展开。
- [ ] 测试成功轨迹的展开状态不会跨 Session 重开保留，失败和等待 Permission 仍展开。
- [ ] 测试三个权限模式的启动参数、Workspace 隔离、默认 `write` 和 Runtime 重启后的 Session 恢复。
- [ ] 测试执行中、Follow-up 排队和等待 Permission 时不能切换权限。
- [ ] 测试切换到 `yolo` 的确认与取消路径。
- [ ] 使用 Fake OMP 测试 Permission 请求的显示、允许、拒绝、取消和 Renderer 重载恢复。
- [ ] 测试长文本和高频 token 下的更新次数。
- [ ] 测试事件批次达到时间、数量和字节数任一上限时都会发送。
- [ ] 测试长 Session 持续输出后内存不会无界增长，并能在结束后稳定。
- [ ] 测试 Markdown 缓存淘汰后可以按需重新生成。
- [ ] 测试 Stop、逐条 Follow-up、队列清空、快捷键冲突和控件禁用状态。

## 完成条件

- [ ] 用户发送 Prompt 后可以看到连续流式文本。
- [ ] Thinking 和 Tool Call 在运行中可实时更新。
- [ ] 成功完成后执行轨迹自动折叠。
- [ ] 失败或等待 Permission 时执行轨迹保持展开。
- [ ] 重新打开 Session 后消息结构和折叠状态正确。
- [ ] 每个 Workspace 可以选择权限模式，重启 Desktop 后选择仍正确，实际 OMP 启动参数与界面一致。
- [ ] 需要确认的工具会在原位置等待用户允许或拒绝，拒绝时不会执行工具。
- [ ] 高频输出时界面无明显卡顿。
- [ ] reducer 和关键交互测试通过。

## 复用重点

- assistant-ui：Thread、Message、Composer、自动滚动、流式原语和内容分组部件。
- OMP TUI 与 `collab-web`：混合内容的原始顺序、`toolCallId` 配对和最小事件归并规则。
- `@oh-my-pi/pi-wire`：只复用与当前 Runtime 版本一致并经 RPC fixture 验证的公开类型。
- OpenCode Session UI：工具分组和状态摘要。
- TanStack Virtual：长对话虚拟化。
- Radix UI：Permission、菜单和折叠交互。
