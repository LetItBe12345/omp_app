# 决策记录 14：对话渲染层级与实时回答

- 对应任务：`TODO/done/14-conversation-rendering-hierarchy.md`
- 状态：已实现
- 首次确认日期：2026-08-12

## 第一批确认决策

1. `answer candidate` 在整个 Active Assistant Turn 内派生，不局限于当前 Assistant Message。查找和降级都以 Turn 中的原始 item 顺序为准。
2. Active Turn 尚未出现 Tool Call 时，Turn 末尾符合条件的非 Thinking 普通文本直接作为 `answer candidate`，纯问答场景不等待 `agent_end` 才显示正文层级。
3. `answer candidate` 独立显示在 Process Summary 和展开的 Process Contents 下方，保持“过程在前、当前回答在后”的界面顺序。
4. 流式阶段的 `answer candidate` 直接使用与最终回答相同的 Markdown Renderer、组件映射和安全限制；保留 `skipHtml`、本地路径和外部链接处理，不增加纯文本临时渲染链路。
5. 候选范围包含多个普通文本 item 时，按原 item 分别交给 Markdown Renderer，并使用各自的稳定 ID，不先拼接字符串或主动插入换行。复制时仍可沿用现有原始文本拼接规则。
6. `answer candidate` 只取 Active Turn 末尾连续的非空普通文本 item。最后一个 Tool Call 后如果又出现 Thinking、Interaction 或其他过程 item，该过程 item 之前的普通文本仍留在过程区域，只有末尾连续文本进入候选区域。
7. `answer candidate` 出现时不自动收起正在运行的 Process。保留现有展开、用户手动收起、Interaction 到达时展开和 Turn 完成后自动收起规则。
8. 引入 `@tailwindcss/typography`。`prose` 只用于 `answer candidate` 和 `classifyFinalAnswer` 确定的最终回答，不影响 Thinking、过程说明、Tool Call、Subagent、Interaction 和用户消息。
9. Assistant Markdown 使用紧凑标题层级：正文 14px；h1 20px/650，h2 18px/650，h3 16px/600，h4 14px/600，h5 14px/600 且颜色稍弱，h6 12px/600 且颜色稍弱。标题间距按 Desktop 对话界面缩小，不使用博客式大标题。
10. Tool 行采用“SVG 工具类型图标 + 短文字 + SVG 状态图标”的结构。图标复用现有 `lucide-react`，不新画图标或复制外部 SVG；工具类型图标位于左侧，状态图标位于右侧，整体使用小尺寸线性图标、中性颜色和紧凑间距。

## 第二批确认决策

11. 已知工具使用逐工具动作词：`read` 为“读取”，`grep` 为“搜索”，`glob` 为“匹配文件”，`find` 为“查找”，`ls` 为“浏览目录”，`web_search` 为“搜索网页”，`fetch` 为“获取网页”，`bash/shell/exec/command` 为“运行”，`edit` 为“修改”，`write` 为“写入”，`apply_patch` 为“应用修改”，`create_file` 为“创建”，`delete_file` 为“删除”，`task/subagent/delegate` 为“子任务”。External Tool 保留原始工具名。
12. 工具类型图标按具体动作映射：`read` 使用 `FileText`，`grep/find` 使用 `Search`，`glob` 使用 `FileSearch`，`ls` 使用 `Folder`，`web_search/fetch` 使用 `Globe`，Command 使用 `SquareTerminal`，`edit/write` 使用 `FilePenLine`，`apply_patch` 使用 `FileDiff`，`create_file` 使用 `FilePlus2`，`delete_file` 使用 `Trash2`，Subagent 使用 `Bot`，External 使用 `Wrench`。
13. Tool 状态显示规则固定为：pending 显示时钟图标和“等待执行”；running 显示 Spinner 和“运行中”；success 只显示绿色勾；error 显示红色警告图标和错误摘要；rejected 显示停止图标和“已拒绝”；aborted 显示停止图标和“已中止”；incomplete 显示灰色警告图标和“未完整结束”。状态图标提供中文无障碍说明。
14. Tool 状态由现有 OMP 事件驱动，并按 `toolCallId` 原位更新同一个 ActionItem；不增加轮询、定时调度、debounce 或节流。`tool_execution_update.partialResult` 第一版不显示，避免把不稳定输出误作结构化进度。
15. Tool 行优先显示 Workspace 相对路径。Workspace 外部路径缩短为末尾两级并加 `…/`；单行空间不足时省略；`title` 和无障碍文本保留完整原始路径；不能只显示文件名。
16. 一个 Assistant Turn 在界面上保持一个整体，只包含一个可折叠 Process 和一个候选或最终回答。Process 展开后显示多个原始 item，但不把每个 Text 或 Tool 拆成顶层聊天消息。
17. 普通过程 Text 使用低权重、紧凑的 Markdown 渲染，避免候选回答降级后暴露 `##`、`-` 等原始标记；不使用回答正文的 `prose` 标题层级。Thinking 继续按纯文本显示。
18. 候选回答回退只在 Renderer 派生 item ID：Process 跳过当前候选 ID，候选区域渲染这些 ID。新 Thinking、Tool、Interaction 或 Artifact 到达后重新派生，旧候选按原索引回到 Process。不得移动、复制或修改 Reducer item；降级后关闭平滑打字动画，避免整段重新播放。
19. 完全移除 Context Group。一个 Turn 只保留 Process 一级展开；Process 展开后，所有 Context Tool 与其他 Tool 一样逐条紧凑渲染，并保持原始顺序，不增加二级展开。
20. Process Summary 不显示“Process 摘要”字样，使用动态文案：“正在处理 / 已完成 / 执行失败 / 已中止 · N 次工具调用 · 时长”；没有 Tool 时省略调用次数；等待状态继续显示剩余处理时间。摘要文字 12px、字重 500、行高 18px，状态使用次要文字色，次数和时间使用弱文字色，失败使用低饱和红色，箭头 14px，整行约 36px。

## 第三批确认决策

21. Subagent 结果摘要只在 Turn 的 Process 展开时显示；Process 收起时不单独暴露 Subagent。Subagent 行显示任务名、状态和最多一行结果摘要，过长时省略并在 `title` 中保留完整内容；Subagent 自身不提供展开入口。
22. 一次 `task` Tool Call 包含批量 `tasks[]` 时，仍按一个 `toolCallId` 显示一条 Subagent 行，主信息显示任务数量，结束后显示一条合并结果摘要；不把批量任务拆成多行或子树。
23. Thinking 不增加图标或“思考”标签，使用 12px 弱灰色普通字重；普通过程 Text 使用 13px 次要文字色；Tool 行使用 12px；候选和最终回答使用 14px 主文字色。中文 Thinking 不使用斜体。
24. Tool Error 不使用独立大卡片，继续在 Tool 行内显示红色警告图标、“执行失败”和最多 3 行错误摘要；超出后省略，完整错误保留在 `title`，并保留复制完整结果入口。
25. 对话区只在用户位于底部时自动跟随流式更新；用户向上滚动后保持当前位置并显示“回到底部”按钮，点击后恢复自动跟随。
26. Process 展开后不设置内部最大高度或内部滚动，不提供“回到过程底部”按钮；完整内容撑高对话，统一使用外层对话滚动。历史 Process 默认收起，Active Turn 由外层对话跟随底部。
27. 流式 `answer candidate` 不显示复制按钮；只有 `agent_end` 后确定为最终回答，才显示现有复制入口。
28. 完成的 Turn 只有最终普通文本、没有 Thinking、过程 Text、Tool、Subagent、Interaction 或错误时，不显示 Process Summary，直接显示最终回答。
29. Process Summary 只显示一个总时长，包含 Agent 处理时间和等待用户操作的时间；不扣除或单列等待时长。
30. 并行 Tool 不做特殊分组。Renderer 不推断 OMP 未提供的并行关系；多个 Tool 按原始声明顺序逐条显示，各自独立显示当前状态，不增加连线、并行组或串行组。

## 第四批确认决策

31. Turn 失败或中止时，当前 `answer candidate` 降回 Process，不作为最终回答留在 Process 外；Process 保持展开，未完成文本和错误继续按原始位置显示。
32. `completed-incomplete` 在用户界面按正常完成处理：Process Summary 显示完成图标并自动收起，不显示“记录不完整”。用户手动展开后，未收到结束事件的 Tool 只显示灰色 `CircleEllipsis` 图标，不显示“状态未知”文字；诊断详情只写日志。
33. 整个流式输出统一采用“能用 UI 表达就不重复写状态文字”的原则。正常状态优先使用图标、动画、颜色、位置和层级；不显示“运行中”“成功”“状态未知”“执行失败”等可由 UI 表达的标签。文字只保留动作、目标、实际错误、结果摘要和需要用户操作的提示。纯图形状态必须保留 `aria-label`。本条覆盖第 13、20、24 条中的重复状态文字规则。
34. Process Summary 中的计数文案保留精确表述“N 次工具调用”，不简化为“N 个操作”。
35. Process Summary 使用可点击的浅色圆角条：1px 浅边框、白色或极浅灰背景、8px 圆角、无阴影、高度约 36px。
36. Process Summary 不占满 Assistant 消息宽度，使用 `width: min(100%, 32rem)`，最大约 512px。
37. Process 展开内容保留 1px 浅灰色左侧竖线，用于表示内容属于当前 Process；不增加完整外框或背景。
38. Process 与候选回答之间不显示“回答”标签或分割线，只保留约 12px 垂直间距，由字号和文字颜色区分层级。
39. 已结束 Tool 的复制图标默认隐藏，只在 Tool 行悬停或键盘聚焦时显示；错误 Tool 的复制入口可以一直显示。
40. 普通 Tool 成功后不显示结果摘要，只显示工具图标、动作、主要参数和成功图标。Subagent 可以显示结果摘要；错误 Tool 显示实际错误内容。

## 第五批确认决策

41. 流式 `answer candidate` 不增加 assistant-ui 的平滑打字动画，使用 `smooth={false}` 直接显示 OMP 实际到达的文本；保留 `defer`，降低 Markdown 解析对紧急更新的影响。
42. 候选和最终回答的 `blockquote` 使用 2px 左边线、次要文字色且不使用斜体；inline code 使用浅灰背景、4px 圆角、12px 等宽字体且无边框，并移除 `prose` 默认添加的反引号装饰。本条不作用于 Thinking。
43. 候选和最终回答的代码块不自动换行，保留代码格式；内容过宽时由代码块内部横向滚动。
44. Active Turn 尾部的空字符串或纯空白 Text item 不打断候选范围；派生候选 ID 时忽略空 Text 并继续向前查找末尾普通文本。
45. 实时 Turn 完成后的展示与重新加载 Session 历史后的展示必须同形：使用相同的 item 顺序、图标、文案、Markdown、折叠和 Tool 状态规则，并共用同一个展示派生函数。
46. Process Summary 时长只使用准确的 Turn 生命周期边界，即当前运行期收到 `agent_start` 到 `agent_end` 的总时间。重新加载历史后，`get_messages` 没有保存准确生命周期边界时省略时长；不使用消息时间近似，也不新增持久化时间记录。
47. Process Summary 的 Tool 数量按唯一 `toolCallId` 计数，成功、失败、拒绝和中止都计入；一次批量 Subagent 调用只有一个 `toolCallId`，因此计为一次。
48. 总时长不显示小数：小于 1 秒显示“少于 1 秒”，小于 1 分钟显示“N秒”，小于 1 小时显示“N分N秒”，达到 1 小时后显示“N小时N分”并省略秒。
49. 普通过程 Text 的 Markdown 文件链接和行内有效路径继续支持 `Ctrl+点击`，复用最终回答现有的本地路径校验和打开逻辑；Thinking 不提供该交互。
50. 等待用户确认期间，Process Summary 只显示必要的“等待确认 · N秒”倒计时，暂时省略 Tool 数量和总时长；用户处理后恢复图形状态、“N 次工具调用”和总时长。

## 计划结束时确认的剩余决策

51. 纯文本回答在流式生成期间如果没有 Thinking、过程 Text、Tool、Subagent、Interaction 或错误，也不显示 Process Summary，只显示 `answer candidate` 和输入区现有 Stop 控件。
52. OMP 返回 `redactedThinking` 时完全隐藏该 item，不显示“思考内容不可用”，也不因此创建 Process Summary。
53. 失败的 Process Summary 继续使用普通浅灰边框，不把整条边框改成红色；只有状态警告图标和实际错误文字使用低饱和红色。
54. Process Summary 左侧状态图标固定为：运行使用 `LoaderCircle`，完成使用 `Check`，失败使用 `CircleAlert`，中止使用 `CircleStop`，等待使用 `CircleHelp`。实际界面只显示 SVG，不显示对应状态文字；所有图标保留 `aria-label`。
55. 等待状态文案按交互类型区分：Tool Approval 显示“等待确认 · N秒”，输入或选择类 Interaction 显示“等待操作 · N秒”；没有截止时间时只显示“等待操作”。
56. 本任务不新增图片或自绘 SVG。图标全部来自仓库已有的 `lucide-react 1.25.0`；Markdown 继续使用 `@assistant-ui/react-markdown 0.14.6`；圆角、边框、颜色、间距和 Spinner 使用项目 CSS；字体使用系统字体栈；`@tailwindcss/typography` 只提供排版 CSS。不得从 ChatGPT 或外部参考项目复制美术资源。
57. Subagent 结果摘要不解析 Markdown。提取第一段有效文字，压成单行，最多约 160 个字符，并去掉标题、列表等常见 Markdown 标记；完整原始结果仍通过复制入口取得。
58. 系统 `prefers-reduced-motion: reduce` 生效时，通过 CSS 停止 Tool 和 Process Spinner 动画，但保留图标及 `aria-label`；不增加应用内设置、React 状态或 IPC。
