# 决策记录 07：Slash Command 发现、补全与执行

- 对应任务：`TODO/in-progress/07-slash-command-discovery-and-execution.md`
- 状态：计划已确认
- 记录日期：2026-07-24
- 上游约束：`decision/05-workspace-session-and-context.md`
- 交互参考：OpenAI Codex TUI 当前 `main` 分支

## `grill-me` 已确认规则

1. `command_output` 不写入 Desktop 配置或聊天数据库，只在当前运行期显示。切换 Session 或重启 Desktop 后，可以不从历史中恢复。
2. 同一次 Prompt 产生的多条 `command_output` 按到达顺序合并为一个“命令结果”条目，放在对应用户输入之后，不显示为 Assistant 消息或 Tool Call。结果使用等宽文本并保留换行，较长内容默认紧凑显示并可展开；`agentInvoked: false` 或 `prompt_result` 结束该结果的追加。
3. 命令目录只来自 OMP RPC 的 `get_available_commands` 和 `available_commands_update`。Desktop 不硬编码命令，不扫描 Skill、Extension、MCP Prompt 或命令文件。
4. Session 切换时立即清空当前命令目录，再向 OMP 查询目标 Session 的目录，不能沿用前一个 Session 的命令。正式 Session 的输入草稿继续按 Workspace ID 和 Session ID 隔离；切回 Session 时恢复它自己的普通 Prompt、`@` 引用或 Slash 文本。恢复的草稿仍处于命令名前缀时，自动重新打开命令菜单；目录尚未返回时显示加载状态。
5. 命令菜单参考 Codex TUI：输入内容去除开头空白后以 `/` 开始，且光标位于第一个命令词内时打开。裸 `/` 显示全部命令。候选只按正式名称和别名做不区分大小写的前缀过滤，精确匹配排在前面；描述只显示，不参与搜索。没有匹配时关闭菜单。
6. 上键和下键切换候选。Tab 将当前候选补全为正式名称 `/command `，不提交；Enter 直接把当前高亮候选作为完整 Prompt 提交；Esc 关闭菜单并保留原文。菜单关闭后，Enter 沿用 Composer 的普通发送行为。
7. 一级命令补全并出现空格后关闭一级菜单，用户可以继续输入参数。Desktop 不改写或转义参数内容；已知命令只按后续规则规范化命令词和前导空白，未知 `/...` 保持完整原文并交给 OMP，不采用 Codex TUI 的“未知命令”本地错误。
8. 正式名称和别名都可以构成精确命令。按别名找到或选择候选时，补全结果使用正式名称。命令词既不匹配正式名称也不匹配别名时，按普通文本处理。
9. 命令带有 `subcommands` 时，在一级命令补全并输入空格后显示二级候选。二级候选沿用前缀过滤、上下键、Tab、Enter 和 Esc；选择后插入正式一级名称和子命令名称，并显示 OMP 返回的 `usage`。
10. Agent 运行期间不打开命令菜单。输入的第一个命令词与当前动态目录中的正式名称或别名精确匹配时，Renderer 和 Main 都拒绝提交，包括命令后带参数的情况；不完整前缀和无匹配文本按普通 Follow-up 处理。Desktop 仍原样传输文本，最终语义由 OMP 决定。
11. 同一 Session 再次打开菜单并刷新失败时，继续显示上次成功取得的命令目录，并在菜单内提示“命令列表刷新失败，当前显示上次结果”。切换 Session 时仍立即清空目录，不能显示前一个 Session 的旧结果。
12. Slash Command 导致 `session_info_update` 把当前 Session ID 从 A 改为 B 时，Desktop 按真实 Session 切换处理：当前会话改为 B，清空 A 的命令目录并查询 B，刷新 Session 侧栏和 B 的历史，输入框加载 B 自己的草稿。A 的草稿和状态不能带入 B。
13. Slash Command 创建的全新 Session 没有已保存权限时，继承当前 Runtime 的审批模式并按新 Session ID 保存。Slash Command 切换到已有 Session 时，恢复目标 Session 已保存的权限；与当前 Runtime 不同时，沿用 MVP-06 的规则重启 Runtime。
14. 每条候选显示 OMP 返回的英文 `source` 原值：`builtin`、`skill`、`extension`、`custom`、`mcp_prompt` 或 `file`。不翻译为中文，也不按来源分组。
15. 裸 `/` 的完整列表保留 OMP 返回顺序，不按名称或来源重新排序。输入查询后，精确匹配排在前面；其余前缀候选仍保持 OMP 返回顺序。
16. `input.hint` 只在候选中显示为参数提示，例如 `/compact [custom instructions]`。Tab 只插入 `/compact `，不能把方括号或提示文字写入输入框。
17. 子命令沿用一级菜单的键盘语义：Tab 补全但不提交，Enter 直接提交当前高亮候选。一级命令本身允许直接提交，不强制用户先进入子命令菜单。
18. “命令结果”默认最多显示 8 行。超过 8 行时显示总行数和“展开”，展开后显示完整内容并提供“收起”；只限制默认可见高度，不截断或丢弃原始文本。
19. 复制是顶层消息的通用能力，不是“命令结果”的特例。用户 Prompt、Assistant 最终文本和“命令结果”使用同一种复制入口；命令结果折叠时仍复制完整原文。
20. Thinking、Tool Call、Lifecycle、权限确认和其他过程信息不纳入上述顶层消息复制入口。复制内容为对应条目的完整纯文本，不包含“命令结果”、总行数、“展开”等界面文字。
21. 复制用户 Prompt 时保留可见文字和 `@` 引用路径，不复制图片二进制、Base64 或本地临时地址。图片只有可见说明文字时，只复制该文字。
22. Assistant 最终回答复制 OMP 返回的原始 Markdown，保留代码围栏、行内代码、列表和链接；用户 Prompt 和“命令结果”复制各自的原始文本。
23. 三类复制按钮一直显示，不依赖鼠标悬停。Assistant 最终回答和“命令结果”的复制按钮都放在内容正下方，使用相同位置和布局；用户 Prompt 的复制按钮放在气泡右侧并做成紧凑图标按钮，默认贴近右上角。按钮尺寸小、颜色克制、间距紧凑，但必须清楚可见。
24. 复制成功后，按钮在原位置显示勾约 1.5 秒，再恢复复制图标。不弹 Toast，不改变按钮尺寸或周围布局。
25. 命令菜单只显示正式名称，不显示别名。别名仍参与过滤和精确匹配；输入别名时，候选行只显示对应正式名称，不为别名创建独立候选，也不把别名附在正式名称旁边。
26. 用户直接提交精确别名时，Desktop 在交给 OMP 前将第一个命令词规范化为正式名称，并保留后面的空白和参数。例如 `/clear foo` 规范化为 `/new foo`。未知命令不改写。
27. 输入内容带前导空白时仍可发现已知命令。用户通过 Tab、Enter 或发送精确命令完成规范化时，Desktop 去掉前导空白并使用正式名称；未知命令保留包括前导空白在内的完整原文。
28. 同一 Runtime 和 Session 同一时间最多执行一个 `get_available_commands`。查询仍在进行时，再次打开菜单复用该 Promise，不并发发送重复请求；查询完成后，下次重新打开菜单再发起新查询。
29. 命令目录查询必须绑定发起时的 Runtime 实例和 Session ID。返回时任一标识已变化，就丢弃迟到结果；旧 Runtime 退出后到达的 `available_commands_update` 同样丢弃，不能覆盖新 Runtime 或新 Session 的目录。
30. 菜单打开时收到新的完整命令快照，先按当前过滤条件重新计算候选。当前选中的正式名称仍存在时保持选中；已不存在时选中新的第一项；没有匹配项时关闭菜单并保留输入原文。不能按旧列表索引选择另一条命令。
31. `command_output` 不按终端内容渲染。显示和复制前去掉 ANSI 颜色、光标移动等终端控制序列，保留普通换行、空格和 Tab；Desktop 不为命令结果引入终端模拟器。
32. 只有收到清理后非空的 `command_output` 才创建“命令结果”。仅产生 `config_update`、`session_info_update` 或其他状态变化的本地命令不显示空结果框。
33. 同一次 Prompt 的多段 `command_output` 按原文直接拼接，不在事件之间自动插入空格或换行。只有 OMP 返回文本自身包含换行时才换行。
34. `config_update` 到达后立即用其中的完整 `model` 和 `thinkingLevel` 更新现有模型与 Thinking 控件，不在对话区增加状态消息，也不弹 Toast。命令另有非空 `command_output` 时照常显示。
35. `session_info_update` 只改变当前 Session 标题、Session ID 未变时，立即更新右侧标题和左侧 Session 列表，并保持现有排序规则；不增加“重命名成功”消息或 Toast。
36. 裸 `/` 打开菜单时默认选中第一项。Enter 直接提交该命令；用户要发送原始 `/` 时，先按 Esc 关闭菜单，再按 Enter。
37. 鼠标点击候选等同于 Tab，只补全正式名称，不立即提交。一级命令存在子命令时，点击一级候选后打开二级候选；点击二级候选同样只补全。
38. 命令目录仍在加载且没有候选时不阻塞发送。用户按 Enter 时按 Composer 普通发送规则原样提交当前文本，不等待目录查询完成；目录返回后才启用候选的 Enter 快速提交。
39. 命令菜单最多直接显示 8 条候选，超过后在菜单内部滚动。菜单位于 Composer 上方，宽度不超过输入框，不遮住整个对话区；支持鼠标滚轮上下滚动，方向键移动时自动保证选中项可见。
40. 鼠标悬停候选行时同步改变当前高亮项。鼠标移出菜单后保留最后高亮项；随后点击、Tab 或 Enter 都作用于该项。
41. 本地命令的用户输入和“命令结果”组成一组临时内容。OMP 没有把本地命令写入 Session 历史时，Desktop 不单独持久化该用户输入；切换 Session 或重启后，两者可以一起消失。
42. 会调用 Agent 的 Slash Command 在当前运行期显示用户提交的正式 Slash 文本。OMP 可能只把展开后的 Prompt 写入 Session 历史；Desktop 不持久化“原始 Slash 文本到历史消息”的显示映射，恢复历史时以 OMP 返回的展开后 Prompt 为准。
43. `get_available_commands` 响应或 `available_commands_update` 快照中只要有一项不符合协议，整份快照都拒绝。当前 Session 有上次成功快照时继续显示并标记刷新失败；没有成功快照时显示空列表和错误。协议错误写入诊断日志，不能静默丢弃坏项后展示不完整目录。
44. 多个命令声明相同别名时，菜单保留所有对应的正式名称，并维持 OMP 返回顺序。第一项默认选中；用户直接提交该别名时规范化为 OMP 顺序中的第一项。Desktop 不自行按来源判断优先级。
45. 每条命令候选固定显示一行：正式名称和 `input.hint` 在左，描述在中，英文 `source` 在右。描述空间不足时省略，不换行撑高单条候选。
46. Agent 运行期间，当前 Session 从未成功取得合法命令目录时，Renderer 和 Main 临时拒绝所有去除前导空白后以 `/` 开头的输入，并提示“命令列表不可用，任务结束后再发送”。取得成功快照后才按精确命令和普通文本区分。
47. 同一 Session 刷新失败并显示旧结果时，旧快照只用于菜单补全，不用于运行期间放行 Slash 文本。目录重新刷新成功前，运行中仍拒绝所有 `/...`。
48. 命令目录查询失败后不做后台定时重试。Runtime 就绪或 Session 切换时查询一次；失败后等用户下次打开命令菜单再重试，或由合法的 `available_commands_update` 恢复。
49. Runtime 启动时命令目录查询失败不进入全局错误状态，也不影响 Runtime ready 和普通 Prompt。用户尚未使用 Slash 时只记录诊断日志；打开菜单时在菜单内显示错误；运行期间因目录不可用拒绝 Slash 时，在输入框附近显示原因。
50. 复制失败时，复制按钮原位置短暂显示失败图标和“复制失败”约 1.5 秒，再恢复原状态；不弹 Toast。只有系统剪贴板确认写入成功时才显示成功勾。

## 与 Codex TUI 的差异

- Codex TUI 会拦截未知命令并显示本地错误；OMP Desktop 不拦截，原样交给 OMP。
- Codex TUI 对任务运行期间的 Slash 输入有自己的执行和排队规则；OMP Desktop 保留 Renderer 和 Main 的双重限制，并使用当前 Session 的动态命令目录区分精确命令和普通文本。
- Codex TUI 使用内置命令表；OMP Desktop 的目录必须完全来自 OMP RPC。

## 参考

- <https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/command_popup.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/chat_composer/slash_input.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/chat_composer.rs>
