# POST-MVP-04：对话渲染层级与实时回答

- 状态：已完成
- 优先级：P0
- 前置任务：MVP-04
- 后续任务：无
- 详细决策：`decision/14-conversation-rendering-hierarchy.md`

## 目标

优化 Assistant Turn 的实时回答、Thinking、Tool Call 和 Subagent 展示层级，让用户优先看到当前答案，同时保留完整执行过程和现有流式性能设计。

## 固定方案

- 保留现有 OMP Runtime、RPC、Electron IPC 和 `OmpEventReducer` 主链路，不新增第二套事件协议或状态机。
- 保留 `@assistant-ui/react` 和 `@assistant-ui/react-markdown`，不在本任务迁移到 Streamdown 或重写 Markdown Renderer。
- Active Turn 继续直接渲染，不把每次 token 更新重新转换并 reconcile 全部历史消息。
- `final` 仍只由现有成功结束规则确定；运行中的普通文本只增加展示层 `answer candidate` 语义，不提前修改数据层为 `final`。
- 模型输出格式不作为本任务修改对象；先修 Renderer 的语义层级和 Markdown 排版。
- UI 保持紧凑、白底、少边框；只有 Interaction、错误等需要用户注意的内容使用明显容器。

## 明确不做

- 不修改 OMP 的模型 Prompt 来强制制造标题或重点。
- 不改变 `message_start/update/end`、`tool_execution_*` 和 `agent_end` 的归并语义。
- 不把 Thinking、Tool Call 或 Subagent 拆成独立聊天消息。
- 不为普通 Tool Call 增加多层详情卡片。
- 不在性能测试证明必要前引入新的消息虚拟化或 Markdown AST 缓存。

## 任务清单

### 实时回答

- [x] 在 Active Assistant Turn 中派生展示层 `answer candidate`，不写入 Reducer 持久状态。
- [x] 在整个 Active Assistant Turn 中，将末尾连续的非空普通文本 item 作为 `answer candidate`；没有 Tool Call 的纯问答场景同样适用。
- [x] `answer candidate` 使用与最终回答接近的主文本样式，不继续使用低对比度 `.process-narrative` 样式。
- [x] `answer candidate` 按原 item 分别使用与最终回答相同的 Markdown Renderer，显示在 Process 下方，不自动收起正在运行的 Process。
- [x] `answer candidate` 忽略 Turn 尾部空 Text，使用 `smooth={false}` 和 `defer`，不增加二次平滑打字动画。
- [x] 纯文本回答在运行中和完成后都不显示空 Process Summary；`redactedThinking` 完全隐藏。
- [x] 如果后续出现新的 Tool Call，之前的 `answer candidate` 自动降级回过程文本并恢复原始顺序。
- [x] Thinking 永远保持过程语义，不进入 `answer candidate`。
- [x] `agent_end` 后继续使用现有 `classifyFinalAnswer` 作为最终回答唯一真值，不建立第二套 final 判断。
- [x] 最终回答与实时候选回答切换时不重复显示同一段文本。

### 最终回答 Markdown

- [x] 保留现有 assistant-ui Markdown 渲染链路，补齐标题、段落、列表、粗体、引用、链接、inline code 和 code block 的视觉层级。
- [x] 引入并使用 `@tailwindcss/typography` 的 `prose` 体系，只作用于候选回答和最终回答；按 Desktop UI 缩小标题、段距和列表间距。
- [x] 确保 `h1~h6`、`strong`、`blockquote`、inline code 不再被 Tailwind reset 后表现为接近普通正文的黑字。
- [x] 保持 Assistant 回答无气泡、无头像、白底黑字，不把正文改成博客式大标题排版。
- [x] 保留现有本地文件链接、外部链接和代码块交互能力。
- [x] 引用使用左边线且不斜体；inline code 使用浅灰圆角背景并移除默认反引号装饰；代码块不自动换行，过宽时横向滚动。

### Tool Call

- [x] 继续复用 Reducer 已有的 `context`、`command`、`edit`、`subagent`、`external` 分类，不增加新的协议字段。
- [x] Context Tool 不再聚合；`read`、`grep`、`glob`、`find`、`ls`、`web_search` 和 `fetch` 在 Process 展开后按原始顺序逐条紧凑显示。
- [x] Command Tool 使用紧凑命令语义，优先展示命令首行和运行状态。
- [x] Edit Tool 使用文件修改语义，优先展示目标文件或路径和最终状态。
- [x] External Tool 保留通用 Tool Row，未知工具不猜测业务含义。
- [x] Tool 行使用图标、动作词、主要参数和状态建立差异，避免所有调用都表现为相同的“工具名 + 灰字”。
- [x] Tool 行复用 `lucide-react`，采用“左侧工具类型 SVG 图标 + 短文字 + 右侧状态 SVG 图标”的紧凑结构，不新增自绘图标。
- [x] Tool 行按已确认的逐工具动作词和 Lucide 图标映射显示；状态按 pending、running、success、error、rejected、aborted 和 incomplete 分支原位更新，不显示 `partialResult`，正常状态不重复显示文字标签。
- [x] 文件参数优先显示 Workspace 相对路径；Workspace 外路径缩短为末尾两级，完整原值保留在 `title` 和无障碍文本中。
- [x] 普通 Tool Call 保持单行或紧凑多行；错误、拒绝、中止状态提高视觉权重。
- [x] 普通 Tool 成功后不显示结果摘要；复制入口只在悬停或键盘聚焦时出现，错误 Tool 可以一直显示。

### Subagent

- [x] 为 `category === 'subagent'` 增加独立展示组件或专用 Tool Row 变体，不再完全复用普通 Tool Row 外观。
- [x] 继续复用现有 `task`、`subagent`、`delegate` 分类结果，不修改 Runtime。
- [x] 展示 Subagent 的任务名称或主要目标、运行状态和结果摘要；字段不足时回退到原始工具名。
- [x] Subagent 结果摘要只在 Process 展开后显示，最多一行且不提供 Subagent 自身展开入口；批量 `tasks[]` 按一个 Tool Call 显示任务数量和合并摘要。
- [x] Subagent 结果摘要不解析 Markdown，提取第一段有效文字并清理常见 Markdown 标记，最多约 160 个字符。
- [x] Subagent 运行中、完成、失败和中止状态可一眼区分。
- [x] 不在第一版展开完整子 Agent 对话树；只展示当前主 Run 需要理解的摘要。

### Thinking、Interaction 与层级

- [x] Thinking 使用更小字号和低对比度文本，明确低于当前回答和重要状态。
- [x] Thinking 不增加图标、标签或斜体，使用 12px 弱灰色普通字重；过程 Text 13px，Tool 行 12px，回答正文 14px。
- [x] 普通过程说明使用紧凑、低权重 Markdown，保持原始事件顺序；Thinking 继续使用纯文本。
- [x] 过程 Text 复用本地路径校验和 `Ctrl+点击` 打开能力；Thinking 不提供路径交互。
- [x] Interaction 保持当前结构化控件，继续在原始事件位置显示。
- [x] Interaction、Tool Error 和需要用户决策的状态允许使用明显卡片或边框，其余过程信息尽量无卡片化。
- [x] Tool Error 保持在 Tool 行内，显示最多 3 行实际错误、完整内容 `title` 和复制完整结果入口，不重复显示“执行失败”，不增加独立大卡片。
- [x] Process Summary 使用“状态图标 · N 次工具调用 · 时长”的紧凑结构；只有等待用户操作时保留状态文字。
- [x] Process Summary 按运行、完成、失败、中止和等待使用已确认的 Lucide 状态图标；失败时边框仍保持浅灰。
- [x] Process Summary 使用最大宽度 32rem 的浅色圆角条；展开内容只保留左侧浅灰竖线，不增加完整外框或背景。
- [x] Process 使用外层对话统一滚动，不设置内部最大高度、内部滚动或“回到过程底部”按钮；用户离开底部时不被流式更新强制拉回。
- [x] Process Summary 时长包含 Agent 处理和等待用户操作的总时间；纯文本回答没有过程内容时不显示摘要。
- [x] Process Summary 按唯一 `toolCallId` 计数；时长只使用当前运行期准确的 `agent_start` 到 `agent_end`，历史缺少边界时省略，不做近似或额外持久化。
- [x] 等待用户确认时，摘要只显示“等待确认 · N秒”；处理后恢复状态图标、Tool 数量和总时长。
- [x] Tool Approval 使用“等待确认”，输入或选择类 Interaction 使用“等待操作”；没有截止时间时省略倒计时。
- [x] `completed-incomplete` 在界面上按正常完成处理；缺少结束事件的 Tool 只使用灰色 `CircleEllipsis` 图标，诊断详情写日志。
- [x] 并行 Tool 不做特殊分组或连线，按原始声明顺序逐条显示并独立更新状态。
- [x] 图标只使用现有 `lucide-react`，不新增图片、自绘 SVG 或复制外部美术资源；减少动态效果时通过 CSS 停止 Spinner 动画。

### 测试与回归

- [x] 在 `tests/renderer/conversation-thread.test.tsx` 覆盖实时 `answer candidate` 展示。
- [x] 测试新 Tool Call 到达后旧候选文本自动降级为过程文本。
- [x] 测试 Thinking 不会进入 `answer candidate`。
- [x] 测试成功结束后仍由现有最终分类得到唯一最终回答。
- [x] 测试 Process 展开后 Context Tool 不聚合，并按原始顺序逐条显示。
- [x] 测试 `task`、`subagent`、`delegate` 都进入 Subagent 专用展示路径。
- [x] 测试 Command、Edit、External 和错误 Tool 的展示分支。
- [x] 测试纯文本回答不显示 Process Summary、候选回答不显示复制按钮、总时长包含等待时间。
- [x] 测试失败或中止时候选文本回到 Process，`completed-incomplete` 不显示诊断文案，正常 Tool 不显示结果摘要。
- [x] 测试 Process 无内部滚动，用户离开对话底部后流式更新不强制滚动。
- [x] 测试实时完成与历史恢复共用展示规则，历史缺少准确生命周期时不显示时长。
- [x] 测试空 Text 不打断候选、Tool 按唯一 ID 计数、等待确认时摘要隐藏数量和总时长。
- [x] 测试纯文本运行态和 `redactedThinking` 不产生摘要、等待文案按 Interaction 类型区分、减少动态效果时 Spinner 不旋转。
- [x] 回归长 Session 流式性能，确认 Active Turn 更新不会触发完整 settled history 重渲染。
- [x] 运行 `pnpm check` 并通过现有 Renderer、Reducer 和性能测试。

## 完成条件

- [x] 模型生成时，用户能明显区分“当前回答”“Thinking”“Tool Call”“Subagent”和“需要操作的 Interaction”。
- [x] 最后一个 Tool Call 后的当前回答在流式阶段已经具有正文层级，不需要等 `agent_end` 才变得可读。
- [x] 新 Tool Call 到达时，之前的候选回答可以无重复、无丢失地回到过程区域。
- [x] Markdown 标题、粗体、列表、引用和代码具有稳定视觉层级，不再表现为一整块相近黑字。
- [x] Read、Search、Command、Edit、Subagent 和 External Tool 在不增加复杂卡片的前提下可快速区分。
- [x] Subagent 不再与普通 Tool Call 完全同形，但仍保持紧凑。
- [x] OMP Runtime、IPC、Reducer 事件语义和最终回答分类规则保持不变。
- [x] 长 Session 的流式性能不低于现有实现。
