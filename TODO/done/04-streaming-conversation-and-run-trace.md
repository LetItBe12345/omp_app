# MVP-04：流式对话与执行轨迹

- 状态：已完成
- 优先级：P0
- 前置任务：MVP-03
- 后续任务：MVP-05

## 目标

完成最小聊天闭环，并正确展示文本、Thinking、Tool Call 和通用 Interaction。

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
- 不重新实现 assistant-ui 已提供的 Thread、Message、Composer、自动滚动、工具分组和 Markdown 流式渲染。
- 不解析 Interaction 的 `title` 来猜测 `toolCallId`；OMP v17.0.6 的 `extension_ui_request` 没有结构化的工具关联字段。
- 不在性能测试证明有必要前接入虚拟列表或自建 Markdown AST 缓存。
- 不先实现复杂主题系统和富媒体组件市场。

## 任务清单

### 复用与适配

- [x] 固定使用 `@assistant-ui/react` 0.14.27 和 `@assistant-ui/react-markdown` 0.14.6，不使用范围版本，也不引入 assistant-ui 的整套预制 UI 包。
- [x] 接入 `@assistant-ui/react` 的 `ExternalStoreRuntime`，由现有 OMP 状态持有消息和运行状态，不建立第二份会话存储。
- [x] 使用 assistant-ui 的 Thread、Message、Composer、`MessagePrimitive.GroupedParts`、Reasoning 和 ToolGroup 原语。
- [x] 使用 `@assistant-ui/react-markdown` 的 `defer` 和 memo 能力渲染流式 Markdown，不先编写自定义解析缓存。
- [x] 将 OMP `abort` 接入 assistant-ui 的取消回调，将 OMP `follow_up` 接入运行中 FIFO 队列。
- [x] OpenCode Session UI 只作为 Context Tool 分组、摘要和折叠规则的参考；其组件使用 SolidJS，不直接复制到 React Renderer。
- [x] OMP TUI、`collab-web` 和 ohmypi-craft 只复用与当前 RPC 事件相符的归并规则、类型和测试样例，不复制各自的完整状态管理。

### 数据模型

- [x] 定义统一的 `AssistantTurn` 和有序 `TurnItem` 数据结构，保留 assistant 消息边界与内容顺序。
- [x] 将 Run 展示投影归一化为 `Narrative`、`Action`、`Interaction`、`Artifact` 和 `Lifecycle` 五类；它们只负责展示，不替代 OMP RPC 或 Agent 状态机。
- [x] 将 Narrative 标记为 `reasoning`、`intermediate` 或 `final`；`final` 只能由成功结束后的终止规则得出。
- [x] 最终回答使用有序内容的引用或索引表示，不与执行轨迹重复保存完整文本。
- [x] 建立 `OmpEventReducer`，按原始顺序归并文本、Thinking、Tool Call 和 Tool Result。
- [x] `OmpEventReducer` 只做事件归并和字段转换，不实现 Agent 状态机、消息持久化、工具调度或重试。
- [x] 正确处理 `message_start/update/end`；把 `message_update` 视为累计快照并替换当前消息投影，禁止重复追加。
- [x] 正确处理 Thinking 增量。
- [x] 使用 `toolCallId` 归并 Tool Call 参数、进度、结果和错误。
- [x] 重复 Start 只更新同一 Action；Update 或 End 先到时创建占位 Action，Start 后到时补全字段；End 后忽略更晚的旧 Progress。
- [x] `agent_end` 或历史恢复时仍缺少 Tool End 或 Tool Result 的 Action 标记为“未完整结束”；冲突字段以最新事件为准并记录诊断警告。
- [x] 将 Action 分类为 `context`、`command`、`edit`、`subagent` 和 `external`，无法可靠识别时保留原始工具信息并回退到 `external`。
- [x] Context 白名单固定为 `read`、`grep`、`glob`、`find`、`ls`、`web_search`、`fetch`；只聚合连续且成功的白名单工具，失败、拒绝或中止的工具单独显示，未知工具不做模糊名称匹配。
- [x] Interaction 按 RPC 到达顺序插入投影；只有当前唯一待执行 Tool Call 能够可靠确定时才关联 Action，否则保留为 Run 级 Interaction，不猜测 `toolCallId`。
- [x] Interaction 处理后只收起交互控件；已可靠关联时保留对应 Action 的最终状态和历史。
- [x] Lifecycle 只驱动运行状态和控制组件，不生成普通聊天消息。
- [x] 正确处理 Agent、Turn、Retry、Compaction 和 Notice 状态。
- [x] 实现纯函数形式的最终回答分类规则，覆盖无工具消息和最后一个 Tool Call 后的结尾文本。
- [x] 收到 `agent_end` 后检查本次 Run 最后一条 Assistant Message；只有 `stopReason === "stop"`，且不存在未完成 Interaction 时才执行最终分类。
- [x] `agent_end` 本身不含成功字段；不得只凭事件类型判断成功。`length`、`error`、`aborted`、等待 Interaction 或信息不足时保留完整轨迹。
- [x] 正常 `stop` 但没有非空最终文本时仍按已完成状态折叠，不渲染空的 Assistant 消息区域。
- [x] 历史消息恢复与实时事件使用同一投影函数和最终回答分类规则；重开 Session 时不要求恢复临时进度、动画、已处理的 Interaction 控件和中间 Lifecycle 状态。
- [x] 历史中以可见用户消息划分 Assistant Turn；隐藏合成消息不生成用户气泡也不切断 Turn，历史开头的无用户 Assistant 内容建立独立 Turn。

### 流式性能

- [x] 复用现有 `runtime-ipc.ts` 的内存事件批次和 24 ms 定时刷新，不另建第二套批处理。
- [x] 单个 IPC 批次最多 100 个事件或 256 KiB 的 JSON 估算大小，达到任一上限立即发送；单个超限事件单独发送，不拆分 RPC 事件。
- [x] 只更新当前 Assistant Turn。
- [x] 原始 RPC 事件处理后释放，Reducer、React 和 assistant-ui 不重复保存完整消息。
- [x] 使用 assistant-ui 默认的 `content-visibility`、稳定消息 ID 和 Markdown `defer`/memo，避免重复渲染屏幕外历史和阻塞流式更新。
- [x] 先用长 Session 性能测试确认 React 挂载成本；只有默认方案不能满足预算时，才按 assistant-ui 官方示例接入 TanStack Virtual。
- [x] 每个 `toolCallId` 的进度最多每 100 ms 更新一次；新进度覆盖未渲染的旧进度，结束、错误和 Interaction 立即刷新，最终结果丢弃旧进度。
- [x] Tool 原始输出不在过程区域另设详情层；只显示结构化结果摘要和完整错误，完整结果从 OMP Session 提供复制，不全部挂载到 DOM。
- [x] 图片数据处理完成后释放重复 Base64 副本。

### UI

- [x] 用户消息靠右，使用紧凑的极浅灰背景。
- [x] Assistant 消息靠左，白底黑字，不使用头像和气泡。
- [x] 当前执行轨迹在生成时展开，普通文本、Thinking 和工具信息按 OMP 原始顺序流式更新。
- [x] 成功结束时只重分类一次：把最终文本移到轨迹外，其余内容折叠为低对比度的“思考了多久、工具数、状态”单行摘要。
- [x] 摘要耗时为 `agent_start` 到 `agent_end` 的时间减去等待 Interaction 的时间；显示整数秒，不足 1 秒显示“少于 1 秒”。
- [x] 摘要工具数按唯一 `toolCallId` 统计，包含失败、拒绝和中止的调用；工具数为零时省略。
- [x] 状态文案固定为“进行中”“重试中”“等待操作”“已完成”“已完成 · 记录不完整”“输出不完整”“失败”和“已中止”。
- [x] 运行中摘要的耗时每秒更新一次，工具数只在出现新 `toolCallId` 时更新；等待 Interaction 时暂停计时，自动重试时继续计时。
- [x] 重开 Session 后只在能够可靠计算时显示耗时，否则省略；工具数和状态从 OMP 历史消息重建，不增加摘要数据库。
- [x] 浅色摘要整行可点击，不显示“展开全文”等文案；点击一次后恢复全部过程内容的原始顺序，不把工具集中到独立区域。
- [x] 浅色摘要使用原生 `button` 语义，支持 Enter、空格、`aria-expanded`、`aria-controls` 和键盘焦点；收起前将区域内焦点移回摘要。
- [x] 展开过程不隐藏中间项，也不为 Thinking、Context 子项或 Tool Call 增加第二层展开；过程区域最大高度为 `min(60vh, 640px)`，超出后在区域内滚动。
- [x] 同一段最终文本只渲染一次，移动到最终回答区域后不在轨迹中保留副本。
- [x] 展开过程显示 OMP 提供的完整 Thinking 和过程说明；`redactedThinking` 只显示“思考内容不可用”，不显示原始数据。
- [x] Tool Call 在过程内以名称、主要参数、最终状态和结构化结果摘要占一行，不提供第二层卡片展开。
- [x] Tool Call 摘要只使用结构化字段，优先显示文件路径、搜索词、命令首行或目标名称；摘要只占一行，按可用宽度省略，不设置固定字符上限；无法可靠生成时只显示名称和状态。
- [x] 运行中 Context Action 聚合为一行实时摘要；文件数按结构化规范化路径去重，搜索数按实际调用次数统计，字段不足时显示实际操作次数，不解析工具输出补数字。
- [x] 点击 Run 摘要后直接恢复 Context Action 内部每个工具操作的原始顺序，不要求再次点击 Context 分组。
- [x] `extension_ui_request: select` 统一按通用 Interaction 渲染，原样显示 OMP 的 `title` 和 `options`，不根据标题或方法生成审批语义。
- [x] Interaction 显示在事件到达时的原始位置并滚动到该位置，不打开居中模态框；只有当前唯一待执行 Tool Call 能够可靠确定时才显示在对应 Action 内。
- [x] 文件改动只显示 RPC 原始结果能够可靠提供的简短摘要，不在 MVP 聚合 Run 级 ChangeSet，也不在对话流展开完整 Diff。
- [x] 使用 assistant-ui `ThreadPrimitive.Viewport` 的自动跟随；只在用户位于底部附近时跟随新内容。
- [x] 使用 assistant-ui 的 Viewport 状态和 `ScrollToBottom`；用户主动向上滚动后停止跟随并显示“有新内容”，点击后回到底部。
- [x] 过程区域向上滚动后停止内部跟随，右下角只显示悬浮向下箭头；不显示“有新内容”文字、未读数或弹窗，点击后回到底部并恢复跟随。
- [x] 已完成任务展开后从过程顶部开始；运行中默认停在底部。收起后再次展开回到顶部，不保存内部滚动位置。
- [x] 过程区域滚到顶部或底部后，继续滚轮操作可以自然带动外层聊天页面。
- [x] 用户可以在运行中手动折叠；后续普通事件不强制展开，Interaction 到达时自动展开并滚动到交互位置。
- [x] 用户位于底部附近时，正常结束后立即折叠；用户已向上滚动时保持展开，回到底部或点击“收起”后再折叠。
- [x] 已完成轨迹的手动展开状态不持久化；重新打开 Session 时，成功任务折叠，失败和等待 Interaction 的任务展开。
- [x] `stop` 但 Action 记录不完整时仍默认折叠，摘要显示“已完成 · 记录不完整”。
- [x] Markdown 禁止原始 HTML；网页链接经 Main 校验后用系统浏览器打开，拒绝未允许协议，远程图片不自动加载，代码块不提供直接执行。

### 输入区

- [x] 支持普通 Prompt。
- [x] 生成开始后，发送按钮原位切换为圆圈内方块的 Stop 图标；执行链结束后恢复。
- [x] 运行中普通发送使用逐条 Follow-up，不提供 Steer。
- [x] 只要 Runtime 正在执行或 Follow-up 队列非空，持续显示 Stop。
- [x] 鼠标点击 Stop 和无选中文本时的 `Ctrl+C` 使用同一操作；有选中文本时保留复制。
- [x] Stop 后恢复当前被中止的用户消息，并清空未执行的 Follow-up。
- [x] 运行中的 Slash Command 禁止发送。
- [x] 显示连接、生成、重试和错误状态。
- [x] 禁止重复提交同一输入。

### 通用 Interaction

- [x] 将 OMP `extension_ui_request` 接入 Run 投影，并通过受控 IPC 和 `respondExtensionUi` 原样回传用户选择。
- [x] `select` 原样显示 OMP 的 `title` 和 `options`；Interaction 按 RPC 原始位置渲染，不生成工具审批语义。
- [x] 只有当前唯一待执行 Tool Call 能够可靠确定时才关联对应 Action，否则保留为 Run 级 Interaction。
- [x] Main 持有未处理 Interaction；Renderer 重载后从 `RuntimeSnapshot` 恢复，不重复响应已经结束的请求。

### 测试

- [x] 为事件乱序、重复和缺失结束事件编写 reducer 测试。
- [x] 测试连续 `message_update` 累计快照不会造成文本重复。
- [x] 测试“过程文本 → 工具 → 最终文本”和单条混合 assistant 消息都保持原始顺序。
- [x] 测试多个 Tool Call 按 `toolCallId` 配对结果，且中间普通文本不会被移到错误位置。
- [x] 测试连续 Context Action 能够聚合；遇到普通文本、Interaction、命令或编辑操作时正确切断分组。
- [x] 测试 Context Action 在结构化文件信息缺失时回退为操作数，不解析结果文本。
- [x] 测试未知工具回退为 `external`，并保留工具名称、输入、结果和错误。
- [x] 测试 Interaction 能可靠确定唯一 Tool Call 时建立关联，存在多个候选或没有候选时保留为 Run 级 Interaction。
- [x] 测试 Interaction 处理后移除控件但不删除已关联的 Action，Lifecycle 不生成聊天卡片。
- [x] 测试无工具的正常结尾、最后一个工具后的结尾文本和无法判断最终回答三类分类结果。
- [x] 测试正常 `stop` 且没有非空最终文本时只显示已完成摘要，不产生空消息。
- [x] 测试 `agent_end` 携带 `stop`、`length`、`error` 和 `aborted` Assistant Message 时，只对 `stop` 执行最终分类。
- [x] 测试成功重分类后最终文本只出现一次，稳定 key 不因折叠产生重复节点。
- [x] 测试运行中展开、成功折叠、失败保持展开。
- [x] 测试运行中手动折叠不会被普通事件重新打开，Interaction 会自动展开并滚动到原始位置。
- [x] 测试用户位于底部时成功后立即折叠，向上滚动阅读时延后折叠。
- [x] 测试摘要耗时排除 Interaction 等待时间、唯一 `toolCallId` 计数、零工具省略和全部固定状态文案。
- [x] 测试运行中摘要每秒更新、工具数按新 ID 更新、等待时暂停和重试时继续计时。
- [x] 测试历史耗时可恢复与不可恢复两条路径，确认不可恢复时省略且不伪造数值。
- [x] 测试可见用户消息、隐藏合成消息和历史开头无用户消息的 Turn 划分。
- [x] 测试 `stop` 且 Action 记录不完整时默认折叠，并显示“已完成 · 记录不完整”。
- [x] 测试历史恢复和实时事件生成相同的 Assistant Turn，且不会重复消息。
- [x] 测试主动向上滚动时停止跟随、“有新内容”恢复跟随和底部附近自动滚动。
- [x] 测试过程区域停止跟随时只显示悬浮向下箭头，点击恢复底部跟随；完成态展开从顶部开始，重新展开重置位置。
- [x] 测试过程区域滚到边界后滚轮可以继续驱动外层聊天页面。
- [x] 测试摘要的 button 语义、键盘操作、ARIA 状态和收起时的焦点恢复。
- [x] 测试点击摘要一次即可显示全部 Thinking、过程说明和 Tool Call，Context 子项恢复原始顺序且不存在第二层展开控件。
- [x] 测试过程区域不超过 `min(60vh, 640px)`，超出后区域内滚动，最终回答仍位于摘要和过程区域之后。
- [x] 测试 Tool Call 的结构化摘要、按可用宽度省略、未知字段回退、完整错误显示和原始结果复制。
- [x] 测试 Context 白名单、成功连续聚合、失败项切断、路径去重、调用次数和字段缺失回退。
- [x] 测试成功轨迹的展开状态不会跨 Session 重开保留，失败和等待 Interaction 仍展开。
- [x] 使用 Fake OMP 测试通用 `select` 的显示、选择、取消和 Renderer 重载恢复。
- [x] 测试长文本和高频 token 下的更新次数。
- [x] 测试事件批次达到时间、数量和字节数任一上限时都会发送。
- [x] 测试每个 Tool Call 的 100 ms 进度限频、覆盖旧进度、结束立即刷新和完成后不发生状态倒退。
- [x] 测试超大 Tool 输出不挂载到过程 DOM，图片、Base64 和二进制内容不进入过程区域，完整结果仍可复制。
- [x] 测试长 Session 持续输出后内存不会无界增长，并能在结束后稳定。
- [x] 测试 Markdown `defer` 下流式文本最终内容完整，历史消息更新不会触发无关消息重复渲染。
- [x] 测试 Markdown 原始 HTML、危险链接协议和远程图片不会在 Renderer 执行或自动加载，允许的网页链接由 Main 打开。
- [x] 记录默认 `content-visibility` 方案的长 Session 性能；只有不满足预算时才增加并测试虚拟列表。
- [x] 测试 Stop、逐条 Follow-up、队列清空、快捷键冲突和控件禁用状态。

## 完成条件

- [x] 用户发送 Prompt 后可以看到连续流式文本。
- [x] Thinking 和 Tool Call 在运行中可实时更新。
- [x] 成功完成后执行轨迹自动折叠。
- [x] 失败或等待 Interaction 时执行轨迹保持展开。
- [x] 点击浅色摘要一次可以按原始顺序查看完整过程，且长过程不会把聊天页面无限撑高。
- [x] 重新打开 Session 后消息结构和折叠状态正确。
- [x] 通用 Interaction 会在事件原位置等待用户选择；能够可靠关联时显示在对应 Action 内。
- [x] 载入 1,000 条历史消息后，以每秒 100 个 RPC 事件持续输出 60 秒；事件到可见延迟 P95 不超过 100 ms，且没有超过 100 ms 的主线程长任务。
- [x] 输出结束并执行测试环境可用的 GC 后，内存不再持续增长。
- [x] reducer 和关键交互测试通过。

## 复用重点

- assistant-ui `ExternalStoreRuntime`：连接现有 OMP 消息状态、运行状态、取消和 Follow-up 队列。
- assistant-ui Thread、Message、Composer、GroupedParts、Reasoning、ToolGroup、Viewport 和 ScrollToBottom：直接作为 React UI 基础。
- `@assistant-ui/react-markdown`：流式 Markdown、`defer` 和 memo。
- OMP TUI 与 `collab-web`：混合内容的原始顺序、`toolCallId` 配对和最小事件归并规则；优先复用当前 Runtime 版本对应的实现。
- `@oh-my-pi/pi-wire`：只复用与当前 Runtime 版本一致并经 RPC fixture 验证的公开类型。
- ohmypi-craft：参考纯函数事件处理、工具结果缺失和乱序时的容错，不复制其消息模型。
- OpenCode Session UI：只参考 Context Tool 的分类、分组终止条件和状态摘要，其 SolidJS 组件不直接复制。
- TanStack Virtual：仅在默认 `content-visibility` 经测试仍不满足性能预算时接入。
- Radix UI：Interaction、菜单和折叠交互。

## 实现记录

- 完成日期：2026-07-24
- 使用 `@assistant-ui/react` 0.14.27 的 External Store Runtime、Thread、Message、Composer、GroupedParts、Viewport 和 ScrollToBottom。
- 使用 `@assistant-ui/react-markdown` 0.14.6 的 `defer` 渲染流式 Markdown。
- OMP 累计消息快照、Thinking、Tool Call、Tool Result、Interaction 和历史消息统一经过 `OmpEventReducer`。
- IPC 事件批次限制为 24 ms、100 个事件或 256 KiB；Tool 进度按 `toolCallId` 限制为每 100 ms 最多一次。
- 1,000 条历史消息和 6,000 个流式事件的 Reducer 与 React 提交性能测试通过，P95 低于 100 ms。
- 使用暴露 GC 的 Node 测试验证连续累计快照在 GC 后不持续增长。
- `pnpm check`、`pnpm build`、`git diff --check` 和临时无沙箱 Electron smoke 通过。
- 普通本地 `pnpm smoke` 因当前机器的 Electron SUID sandbox 文件权限失败；GitHub CI 会按工作流修正权限后执行 X11/Wayland smoke。
