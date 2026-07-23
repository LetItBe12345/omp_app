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
7. 最后一条消息停在 Tool Call、没有非空结尾文本、缺少成功的 `agent_end`，或者执行处于失败、中止、重试和等待 Permission 状态时，不猜测最终回答。界面保持原始顺序并展开执行轨迹。
8. 运行中展开完整执行轨迹，所有已经收到的可见内容都在原位置流式更新。成功结束时只重分类一次：最终文本移到轨迹外，剩余内容折叠为摘要；同一段文本不能同时出现在两个位置。
9. 用户手动展开后，过程文本、Thinking、Tool Call 和 Tool Result 必须恢复 OMP 原始顺序。不能只保留最后一段过程文本，也不能把所有 Tool Call 集中到独立区域。
10. Tool Call 的开始、参数更新、结果和错误使用 `toolCallId` 归并到同一个轨迹项。Tool Result 不渲染成独立聊天消息。

## Reducer 与历史恢复

11. `message_update` 携带当前 assistant 消息的累计快照。Reducer 应替换当前消息投影，不把完整快照当成 token 增量追加。
12. `AssistantTurn` 保存一份有序的展示项，并用引用或索引标记哪些文本属于最终回答；执行轨迹和最终回答不各自复制一份完整文本。
13. 实时事件和历史消息调用同一个纯投影函数。历史恢复时，按 assistant 内容顺序重建轨迹，使用 `toolCallId` 配对 Tool Result，再应用相同的最终回答判断规则。
14. `AssistantTurn` 和 `OmpEventReducer` 只能是薄适配层：负责事件归并、字段转换和展示分类，不实现 Agent 状态机、工具调度、重试、持久化或 OMP 已经提供的业务逻辑。

## 复用范围

15. 优先复用 assistant-ui 的 Thread、Message、Composer、自动滚动、流式状态和分组部件；Desktop 只补 OMP 事件到这些部件所需的数据适配。
16. 参考 OMP TUI 对混合 assistant 内容的顺序处理，以及 OMP `collab-web` 按 `toolCallId` 配对工具结果的做法。只移植必要规则，不复制其完整状态架构。
17. 工具摘要和状态显示参考 OpenCode Session UI；长列表继续使用 TanStack Virtual，折叠和 Permission 交互使用 Radix UI。
18. 可以使用与 Runtime 版本一致的公开 `@oh-my-pi/pi-wire` 类型，但必须先用 RPC fixture 验证结构兼容；不能因此让 Renderer 依赖 OMP 的内部包。

## 验收边界

19. 执行成功后，最终回答在视觉上独立于执行轨迹；折叠摘要只显示耗时、工具数和状态。
20. 无法可靠判断最终回答时，宁可展示完整有序内容，也不能丢失过程文本、重复文本或伪造最终回答。

## 折叠、滚动与工具详情

21. 用户手动展开已完成的执行轨迹后，不持久化展开状态。重新打开 Session 时，成功任务恢复为折叠状态；失败和等待 Permission 的任务仍保持展开。
22. 生成过程中，用户主动向上滚动后停止自动跟随，并在底部显示“有新内容”；用户点击后回到底部并恢复自动跟随。
23. 执行轨迹展开时，Tool Call 默认只显示工具名称、状态和一行摘要。输入、完整输出和错误详情需要再次点击工具卡片展开。
24. Permission 请求放在对应 Tool Call 的原始位置，并滚动到该位置；不使用居中模态框。

## Workspace 工具权限

25. 输入框上方的控制栏增加固定文案为“权限”的按钮，位置紧邻模型和 Thinking Level。按钮不使用“盾牌”或“工作区写入”作为名称。
26. 权限按钮管理当前 Workspace 的 OMP 工具审批模式，不表示 Linux 文件系统沙箱，也不表示 Electron 系统权限。
27. Desktop 支持 OMP v17.0.6 的三种模式：`always-ask` 自动允许读取，写入和执行需确认；`write` 自动允许读取和写入，执行需确认；`yolo` 自动允许读取、写入和执行。
28. 当前 Workspace 没有保存过选择时使用 `write`。选择按规范化后的 Workspace 路径保存在 Desktop 数据目录，不修改项目内的 `.omp/config.yml`。
29. Main 启动 OMP 时显式追加 `--approval-mode <mode>`。当前 RPC 没有读取或修改审批模式的命令，`get_state` 也不返回该值，因此 Renderer 显示 Desktop 为该 Runtime 选择的值。
30. 修改权限时重启 OMP Runtime，并恢复原 Session。Agent 正在执行、Follow-up 队列非空或正在等待 Permission 时禁用权限切换，不排队延后修改。
31. 从 `always-ask` 或 `write` 切换为 `yolo` 时显示一次风险确认；拒绝确认则保持原模式，不重启 Runtime。
32. OMP 要求审批时，通过 RPC `extension_ui_request` 的 `select` 请求接收选项，并使用现有 `respondExtensionUi` 返回结果。只显示 OMP 实际提供的选项；v17.0.6 的通用工具审批为 `Approve` 和 `Deny`，Desktop 不自行增加“本次 Session 始终允许”等范围。
33. MVP 的权限按钮只管理三种审批模式，不提供每个工具的 `allow`、`prompt`、`deny` 编辑器。单工具规则以后作为高级设置处理。

## Run 展示投影

34. Renderer 将一次 Agent Run 归一化为五类展示数据：`Narrative`、`Action`、`Interaction`、`Artifact` 和 `Lifecycle`。这是 Desktop 的展示投影，不是新的 RPC 协议，也不能反向承担 Agent 状态机职责。
35. `Narrative` 分为 `reasoning`、`intermediate` 和 `final`。`final` 是成功结束后按本文件第 5–7 条规则得到的分类结果，不是 RPC 直接提供的新消息类型。
36. Tool Call、运行状态、进度、结果和错误属于同一个 `Action` 生命周期，必须用 `toolCallId` 更新同一个对象，不能渲染成互不相关的多张卡片。
37. `Action` 的展示类别为 `context`、`command`、`edit`、`subagent` 和 `external`。类别只用于摘要和分组；无法可靠识别时使用 `external`，不能丢弃原始工具名称和结果。
38. 连续出现且中间没有 Narrative、Interaction 或其他 Action 的 Read、Grep、Glob、List 和 Web Search 等低价值上下文操作，聚合为一个 `context` Action。展开后仍按原始顺序显示每个工具操作。
39. `Interaction` 表示等待用户参与的临时交互。等待期间在对应 Action 的原始位置展开；处理后移除交互控件并保留 Action 的最终状态和历史，不能删除整个 Action。
40. `Lifecycle` 只驱动运行状态、Spinner、Stop、等待提示、完成时间和错误状态，不作为普通聊天消息或独立历史卡片。
41. MVP-04 的 `Artifact` 只保留 RPC 已提供的高价值结果引用或摘要。聊天流不展开完整 Diff，也不在 Renderer 中额外聚合整个 Run 的最终 ChangeSet。
42. Run 级 ChangeSet、多次编辑同一文件后的最终 Diff、非 Edit 工具造成的工作区变化和独立 Review 面板属于 POST-MVP-01。
43. 成功结束后的常驻 UI 只突出最终回答和单行 Process 摘要；文件改动存在时可以显示简短摘要。Interaction 只在等待用户处理时临时展开。
