# 决策记录 04：流式对话与执行轨迹

- 对应任务：`TODO/in-progress/04-streaming-conversation-and-run-trace.md`
- 状态：已确认
- 确认日期：2026-07-23

## 消息顺序与展示层级

1. Desktop 继续使用 OMP RPC 原始事件，不为区分过程文本和最终回答修改 OMP 二进制。
2. 一次 `agent_start` 到对应 `agent_end` 视为一个 Assistant Turn。Turn 内的普通文本、Thinking、Tool Call 和 Tool Result 按 OMP 原始顺序保存，不先拆成互不相关的数组。
3. 普通文本是模型可见的 assistant 文本，不等于天然的最终回答。运行期间先按原始位置显示；执行成功后，才把满足终止规则的文本移到最终回答区域。
4. OMP RPC 没有 Codex 协议中的 `Commentary` 和 `FinalAnswer` 标记。Desktop 只做保守推断，不能把所有普通文本直接合并成最终回答。
5. 正常结束时，从最后一条含有非空可见文本的 assistant 消息判断最终回答。该消息不含 Tool Call 时，其中的可见文本作为最终回答。
6. 最后一条 assistant 消息同时含有 Tool Call 时，只把最后一个 Tool Call 之后连续出现的非空普通文本作为最终回答。Tool Call 之前的普通文本、Thinking 和工具信息仍属于执行轨迹。
7. 最后一条消息停在 Tool Call、缺少成功的 `agent_end`，或者执行处于失败、中止、重试和等待 Interaction 状态时，不猜测最终回答。正常 `stop` 但没有非空最终文本时不伪造空消息，仍按已完成状态折叠，用户可以从摘要查看过程。
8. 运行中展开完整执行轨迹，所有已经收到的可见内容都在原位置流式更新。成功结束时只重分类一次：最终文本移到轨迹外，剩余内容折叠为摘要；同一段文本不能同时出现在两个位置。
9. 用户手动展开后，过程文本、Thinking、Tool Call 和 Tool Result 必须恢复 OMP 原始顺序。不能只保留最后一段过程文本，也不能把所有 Tool Call 集中到独立区域。
10. Tool Call 的开始、参数更新、结果和错误使用 `toolCallId` 归并到同一个轨迹项。Tool Result 不渲染成独立聊天消息。

## Reducer 与历史恢复

11. `message_update` 携带当前 assistant 消息的累计快照。Reducer 应替换当前消息投影，不把完整快照当成 token 增量追加。
12. `AssistantTurn` 保存一份有序的展示项，并用引用或索引标记哪些文本属于最终回答；执行轨迹和最终回答不各自复制一份完整文本。
13. 实时事件和历史消息调用同一个纯投影函数。历史恢复时，按 assistant 内容顺序重建轨迹，使用 `toolCallId` 配对 Tool Result，再应用相同的最终回答判断规则。Desktop 不额外持久化完整 RPC 事件流；重开 Session 时不恢复临时进度、动画、已处理的 Interaction 控件和中间 Lifecycle 状态。
14. `AssistantTurn` 和 `OmpEventReducer` 只能是薄适配层：负责事件归并、字段转换和展示分类，不实现 Agent 状态机、工具调度、重试、持久化或 OMP 已经提供的业务逻辑。

## 复用范围

15. 优先复用 assistant-ui 的 Thread、Message、Composer、自动滚动、流式状态和分组部件；Desktop 只补 OMP 事件到这些部件所需的数据适配。
16. 参考 OMP TUI 对混合 assistant 内容的顺序处理，以及 OMP `collab-web` 按 `toolCallId` 配对工具结果的做法。只移植必要规则，不复制其完整状态架构。
17. 工具摘要和状态显示参考 OpenCode Session UI；长列表先使用 assistant-ui 默认的 `content-visibility`，只有性能测试不满足本文件预算时才接入 TanStack Virtual。折叠和 Interaction 交互使用 Radix UI。
18. 可以使用与 Runtime 版本一致的公开 `@oh-my-pi/pi-wire` 类型，但必须先用 RPC fixture 验证结构兼容；不能因此让 Renderer 依赖 OMP 的内部包。
19. MVP-04 固定使用 `@assistant-ui/react` 0.14.27 和 `@assistant-ui/react-markdown` 0.14.6，不使用范围版本。暂不引入 assistant-ui 的整套预制 UI 包；后续升级单独验证。

## 验收边界

20. 执行成功后，最终回答在视觉上独立于执行轨迹；其上方保留一行低对比度摘要，只显示耗时、工具数和状态，整行可点击。
21. 无法可靠判断最终回答时，宁可展示完整有序内容，也不能丢失过程文本、重复文本或伪造最终回答。

## 折叠、滚动与工具详情

22. 用户手动展开已完成的执行轨迹后，不持久化展开状态。重新打开 Session 时，成功任务恢复为折叠状态；失败和等待 Interaction 的任务仍保持展开。`stop` 但 Action 记录不完整也按成功任务折叠。
23. 生成过程中，用户主动向上滚动后停止自动跟随，并在底部显示“有新内容”；用户点击后回到底部并恢复自动跟随。回复结束时，只有用户位于底部附近才立即自动折叠；用户正在上方阅读时暂不折叠。
24. 点击摘要后一次性显示完整过程顺序，不再为 Thinking、过程说明、Context 子项或 Tool Call 增加第二层展开。Tool Call 在过程内以名称、主要参数、最终状态和结构化结果摘要占一行；不把无界原始载荷铺进对话。
25. Interaction 按 RPC 到达顺序显示并滚动到该位置；只有当前存在唯一待执行 Tool Call 时才关联对应 Action，存在多个候选或没有候选时显示为 Run 级 Interaction。不解析 `title` 猜测 `toolCallId`，不使用居中模态框。

## Run 展示投影

26. Renderer 将一次 Agent Run 归一化为五类展示数据：`Narrative`、`Action`、`Interaction`、`Artifact` 和 `Lifecycle`。这是 Desktop 的展示投影，不是新的 RPC 协议，也不能反向承担 Agent 状态机职责。
27. `Narrative` 分为 `reasoning`、`intermediate` 和 `final`。`final` 是成功结束后按本文件第 5–7 条规则得到的分类结果，不是 RPC 直接提供的新消息类型。
28. Tool Call、运行状态、进度、结果和错误属于同一个 `Action` 生命周期，必须用 `toolCallId` 更新同一个对象，不能渲染成互不相关的多张卡片。
29. `Action` 的展示类别为 `context`、`command`、`edit`、`subagent` 和 `external`。类别只用于摘要和分组；无法可靠识别时使用 `external`，不能丢弃原始工具名称和结果。
30. 连续出现且中间没有 Narrative、Interaction 或其他 Action 的 Read、Grep、Glob、List 和 Web Search 等低价值上下文操作，聚合为一个 `context` Action。摘要折叠时只计入聚合统计；点击 Run 摘要后，不需要再次点击 Context 分组，直接按原始顺序显示每个内部工具操作。
31. `Interaction` 表示等待用户参与的临时交互。它按 RPC 到达顺序插入投影；能够可靠关联时在 Action 内展开，否则作为 Run 级 Interaction。处理后移除交互控件并保留已关联 Action 的最终状态和历史。
32. `Lifecycle` 只驱动运行状态、Spinner、Stop、等待提示、完成时间和错误状态，不作为普通聊天消息或独立历史卡片。
33. MVP-04 的 `Artifact` 只保留 RPC 已提供的高价值结果引用或摘要。聊天流不展开完整 Diff，也不在 Renderer 中额外聚合整个 Run 的最终 ChangeSet。
34. Run 级 ChangeSet、多次编辑同一文件后的最终 Diff、非 Edit 工具造成的工作区变化和独立 Review 面板属于 POST-MVP-01。
35. 成功结束后的常驻 UI 只突出最终回答和单行浅色 Process 摘要；文件改动存在时可以显示简短摘要。Interaction 只在等待用户处理时临时展开。

## 流式性能与异常事件

36. IPC 复用现有 24 ms 批处理。单批最多 100 个事件或 256 KiB 的 JSON 估算大小，达到任一上限立即发送；单个超限事件单独发送，不拆分 RPC 事件。
37. 长 Session 基准为载入 1,000 条历史消息后，以每秒 100 个 RPC 事件持续输出 60 秒。事件进入 Renderer 到文本可见的延迟 P95 不超过 100 ms，流式期间不出现超过 100 ms 的主线程长任务。
38. 性能测试不规定跨机器不稳定的绝对内存值；输出结束并执行测试环境可用的 GC 后，内存不得继续增长。
39. 每个 `toolCallId` 的进度最多每 100 ms 刷新一次。新进度覆盖尚未渲染的旧进度；结束、错误和 Interaction 立即刷新。最终结果到达后丢弃尚未刷新的旧进度。
40. Tool 原始输出不在展开过程里另设详情层。过程只显示结构化结果摘要和完整错误信息；完整结果仍由 OMP Session 持有并可复制，但不全部挂载到 DOM。图片、Base64 和二进制内容不进入过程区域。
41. 相同 `toolCallId` 的重复 Start 不创建新 Action。Update 或 End 先到时创建占位 Action，Start 后到时补全字段；End 到达后忽略更晚的旧 Progress。
42. `agent_end` 或历史恢复时仍缺少 Tool End 或 Tool Result 的 Action 标记为“未完整结束”，不伪造成功或错误。冲突字段以最新事件为准并记录诊断警告，不能导致 Renderer 崩溃。

## 执行摘要与一次展开

43. 最后一条 Assistant Message 为 `stop` 时属于正常结束。即使某个 Action 的展示记录不完整，也默认折叠；摘要显示“已完成 · 记录不完整”，用户点击后可以看到对应 Action。
44. 摘要耗时从 `agent_start` 计算到 `agent_end`，包含模型生成和工具执行，不包含等待 Interaction 的时间。显示整数秒，不足 1 秒显示“少于 1 秒”。
45. 工具数按唯一 `toolCallId` 计数。成功、失败、拒绝和中止的 Tool Call 都计入；Context 聚合和重复事件不改变数量，Interaction 不计入。工具数为零时省略该字段。
46. 状态文案固定为“进行中”“重试中”“等待操作”“已完成”“已完成 · 记录不完整”“输出不完整”“失败”和“已中止”，分别对应运行、重试、Interaction、正常 `stop`、带不完整 Action 的 `stop`、`length`、`error` 和 `aborted`。
47. 运行开始时轨迹默认展开，用户可以手动折叠。后续普通事件不强制展开；需要用户操作的 Interaction 到达时自动展开并滚动到交互位置，用户仍可再次折叠。正常结束后按本文件滚动规则自动折叠，运行期间的手动状态不保留。
48. 用户位于底部附近时，正常结束后立即折叠。用户已向上滚动时保持展开并显示“已完成”，用户回到底部或点击“收起”后折叠；重新打开 Session 时仍默认折叠。
49. 展开过程显示 OMP 明确提供的完整 `thinking` 文本，不摘要改写，也不再嵌套折叠。`redactedThinking` 和模型未提供的隐藏推理不显示原始数据，只显示“思考内容不可用”。
50. OMP 在工具前后输出的普通 Assistant 文本称为“过程说明”。运行时按原始位置和较浅样式显示；正常结束后仅将满足终止规则的文本移到最终回答，其余过程说明保留在展开轨迹中。
51. Tool Call 的一行摘要只从结构化参数和结构化结果字段生成，优先显示文件路径、搜索词、命令首行或目标名称。摘要按可用宽度省略，不设置固定字符上限。无法可靠生成时只显示工具名称和状态，不调用模型总结，也不解析大段输出。
52. 浅色摘要整行可点击，不显示“展开全文”等额外文案。点击一次后，在原位置显示全部 Thinking、过程说明和每一次 Tool Call，不隐藏中间项，也不提供第二层展开。过程区域最大高度为 `min(60vh, 640px)`，超出后在区域内滚动，以免撑长整个对话页面。

## Context、滚动与历史恢复

53. Context 工具使用固定白名单：`read`、`grep`、`glob`、`find`、`ls`、`web_search`、`fetch`。只聚合连续且成功的白名单工具；失败、拒绝或中止的工具单独显示。未知工具不做模糊名称匹配。
54. 运行中，连续 Context 工具聚合为一行实时摘要。查看完整过程时，分组标题下直接列出每次实际操作，不再要求点击。文件数按结构化参数中的规范化路径去重；搜索数按实际调用次数统计；字段不足时显示“执行了 N 次上下文操作”，其中 N 是运行时数字变量。
55. 浅色摘要使用原生 `button` 语义，支持 Enter 和空格，设置 `aria-expanded`、`aria-controls` 和清晰的键盘焦点样式。展开后焦点留在摘要；收起时若焦点位于过程区域，先移回摘要。
56. 过程区域位于底部附近时自动跟随。用户向上滚动后停止跟随，右下角显示低对比度的悬浮向下箭头；不显示“有新内容”、未读数量或弹窗。点击箭头回到底部并恢复跟随，优先复用 assistant-ui `ScrollToBottom`。
57. 运行中的摘要显示“思考中 8 秒 · 3 个工具 · 进行中”。耗时每秒更新一次，工具数只在出现新的唯一 `toolCallId` 时更新；等待 Interaction 时计时暂停并显示“等待操作”，自动重试时继续计时并显示“重试中”。
58. 正常 `stop` 但没有非空最终文本时仍视为已完成并默认折叠，只显示浅色摘要，不渲染空的 Assistant 消息区域。`length`、`error`、`aborted` 和等待 Interaction 仍默认展开。
59. Desktop 不为历史摘要增加新的数据库。重开 Session 后，只有能够从可靠字段计算时才显示耗时；否则省略耗时。工具数和状态从 OMP 历史消息重建，不能用不准确的时间戳伪造耗时。
60. 历史中，一条可见用户消息开始一个 Assistant Turn，后续 Assistant Message 和 Tool Result 归入该 Turn，直到下一条可见用户消息。隐藏合成消息不生成用户气泡，也不切断 Turn；历史开头无对应用户消息的 Assistant 内容建立独立 Turn。
61. 流式 Markdown 禁止原始 HTML。`http`、`https` 链接经 Main 校验后用系统浏览器打开；拒绝 `javascript:`、`data:`、`file:` 等未允许协议。Markdown 远程图片不自动加载，只显示链接；只渲染 OMP RPC 明确提供的图片。代码块只允许复制，不提供直接执行。
62. 已完成任务点击摘要后，过程区域从顶部开始。正在运行的任务默认停在底部并按第 56 条跟随；滚到内部区域边界后，继续滚轮操作可以带动外层聊天页面。收起后再次展开回到顶部，不保存内部滚动位置。
