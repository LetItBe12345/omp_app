# POST-MVP-04：对话渲染层级与实时回答

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-04
- 后续任务：无

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

- [ ] 在 Active Assistant Turn 中派生展示层 `answer candidate`，不写入 Reducer 持久状态。
- [ ] 将当前 Assistant Message 中最后一个 Tool Call 之后的普通非 Thinking 文本作为 `answer candidate` 显示。
- [ ] `answer candidate` 使用与最终回答接近的主文本样式，不继续使用低对比度 `.process-narrative` 样式。
- [ ] 如果后续出现新的 Tool Call，之前的 `answer candidate` 自动降级回过程文本并恢复原始顺序。
- [ ] Thinking 永远保持过程语义，不进入 `answer candidate`。
- [ ] `agent_end` 后继续使用现有 `classifyFinalAnswer` 作为最终回答唯一真值，不建立第二套 final 判断。
- [ ] 最终回答与实时候选回答切换时不重复显示同一段文本。

### 最终回答 Markdown

- [ ] 保留现有 assistant-ui Markdown 渲染链路，补齐标题、段落、列表、粗体、引用、链接、inline code 和 code block 的视觉层级。
- [ ] 优先评估并使用 `@tailwindcss/typography` 的 `prose` 体系，避免手写一整套 Markdown CSS；按 Desktop UI 缩小标题、段距和列表间距。
- [ ] 确保 `h1~h6`、`strong`、`blockquote`、inline code 不再被 Tailwind reset 后表现为接近普通正文的黑字。
- [ ] 保持 Assistant 回答无气泡、无头像、白底黑字，不把正文改成博客式大标题排版。
- [ ] 保留现有本地文件链接、外部链接和代码块交互能力。

### Tool Call

- [ ] 继续复用 Reducer 已有的 `context`、`command`、`edit`、`subagent`、`external` 分类，不增加新的协议字段。
- [ ] Context Tool 继续聚合，优先显示“读取 N 个文件 · 搜索 N 次”等已有结构化摘要。
- [ ] Command Tool 使用紧凑命令语义，优先展示命令首行和运行状态。
- [ ] Edit Tool 使用文件修改语义，优先展示目标文件或路径和最终状态。
- [ ] External Tool 保留通用 Tool Row，未知工具不猜测业务含义。
- [ ] Tool 行使用图标、动作词、主要参数和状态建立差异，避免所有调用都表现为相同的“工具名 + 灰字”。
- [ ] 普通 Tool Call 保持单行或紧凑多行；错误、拒绝、中止状态提高视觉权重。

### Subagent

- [ ] 为 `category === 'subagent'` 增加独立展示组件或专用 Tool Row 变体，不再完全复用普通 Tool Row 外观。
- [ ] 继续复用现有 `task`、`subagent`、`delegate` 分类结果，不修改 Runtime。
- [ ] 展示 Subagent 的任务名称或主要目标、运行状态和结果摘要；字段不足时回退到原始工具名。
- [ ] Subagent 运行中、完成、失败和中止状态可一眼区分。
- [ ] 不在第一版展开完整子 Agent 对话树；只展示当前主 Run 需要理解的摘要。

### Thinking、Interaction 与层级

- [ ] Thinking 使用更小字号和低对比度文本，明确低于当前回答和重要状态。
- [ ] 普通过程说明保持原始事件顺序，但视觉权重低于 `answer candidate`。
- [ ] Interaction 保持当前结构化控件，继续在原始事件位置显示。
- [ ] Interaction、Tool Error 和需要用户决策的状态允许使用明显卡片或边框，其余过程信息尽量无卡片化。
- [ ] Run Summary、Context Group、Tool Row、Subagent 和当前回答之间保持稳定的垂直节奏，避免连续灰色文本堆叠。

### 测试与回归

- [ ] 在 `tests/renderer/conversation-thread.test.tsx` 覆盖实时 `answer candidate` 展示。
- [ ] 测试新 Tool Call 到达后旧候选文本自动降级为过程文本。
- [ ] 测试 Thinking 不会进入 `answer candidate`。
- [ ] 测试成功结束后仍由现有最终分类得到唯一最终回答。
- [ ] 测试 Context 聚合行为保持不变。
- [ ] 测试 `task`、`subagent`、`delegate` 都进入 Subagent 专用展示路径。
- [ ] 测试 Command、Edit、External 和错误 Tool 的展示分支。
- [ ] 回归长 Session 流式性能，确认 Active Turn 更新不会触发完整 settled history 重渲染。
- [ ] 运行 `pnpm check` 并通过现有 Renderer、Reducer 和性能测试。

## 完成条件

- [ ] 模型生成时，用户能明显区分“当前回答”“Thinking”“Tool Call”“Subagent”和“需要操作的 Interaction”。
- [ ] 最后一个 Tool Call 后的当前回答在流式阶段已经具有正文层级，不需要等 `agent_end` 才变得可读。
- [ ] 新 Tool Call 到达时，之前的候选回答可以无重复、无丢失地回到过程区域。
- [ ] Markdown 标题、粗体、列表、引用和代码具有稳定视觉层级，不再表现为一整块相近黑字。
- [ ] Context、Command、Edit、Subagent 和 External Tool 在不增加复杂卡片的前提下可快速区分。
- [ ] Subagent 不再与普通 Tool Call 完全同形，但仍保持紧凑。
- [ ] OMP Runtime、IPC、Reducer 事件语义和最终回答分类规则保持不变。
- [ ] 长 Session 的流式性能不低于现有实现。
