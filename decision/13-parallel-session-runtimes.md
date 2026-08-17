# 决策记录 13：多 Session 并行 Runtime

- 对应任务：`TODO/done/13-parallel-session-runtimes.md`
- 状态：已确认
- 首次确认日期：2026-08-16
- 定稿日期：2026-08-16

## 已确认决策

1. 一个 OMP Desktop 应用实例内支持多个 Session 并行运行 Agent。
2. 一个正在生成的 Session 对应一个独立 OMP Runtime；不使用同一 Runtime 同时执行多个 Session。
3. 闲置 Session 不长期占用 OMP Runtime，Session 文件仍是历史恢复的可信来源。
4. Runtime Pool 提供全局最大并行数量，首次使用时默认为 5。
5. 用户可以在 UI 中修改最大并行数量，该设置需要持久化。
6. Runtime Pool 达到最大并行数量后，不能静默创建超出上限的 OMP 进程。
7. 每个正在运行的 Session 在会话列表中显示独立的转圈状态，不再只显示当前可见 Session 的全局运行状态。
8. 最大并行 Session 数量只允许 `1–10` 的整数，默认值为 `5`。Settings 使用带加减按钮的数字输入框。Renderer 做即时校验，Main 做最终校验；超出范围时拒绝保存并显示错误，不静默截断。
9. 全部 Runtime 正在运行时，新 Session 的首条 Prompt 自动进入全局等待队列。用户可以取消等待；取消后移除乐观消息，并把文字和附件恢复到输入框。Runtime 分配前不允许发送后续消息，避免在正式 Session ID 形成前维护另一套消息队列。
10. 会话列表中，正在执行的 Session 在行尾显示 Spinner，正在等待 Runtime 的 Session 显示静止时钟图标，不在列表中写“等待”。图标需有悬停提示和无障碍标签。打开排队中的 Session 时，在输入框上方显示队列位置和取消按钮；输入框允许编辑并保存下一条草稿，发送按钮在 Runtime 分配前不可用。队列和执行状态不渲染为聊天消息。
11. 所有 Workspace 共用一个全局 FIFO 等待队列，严格按首条 Prompt 被 Main 接收的时间排序。不因当前可见 Session、置顶状态或 Workspace 而插队，不做 Workspace 分组轮转。取消排队后，后续任务依次前移。
12. Runtime 只有在进程已 `ready`、已收到当前执行链的 `agent_end` 或 `prompt_result(agentInvoked: false)`、没有待执行 Follow-up、没有待处理 Tool Approval 或 Extension UI 请求，且没有正在进行的 Stop、Session 切换、配置变更或重启时才算空闲。等待用户交互和正在停止仍占用并行名额。崩溃或已停止的 Runtime 释放名额，但不标记为可复用的空闲 Runtime。
13. 正在运行或等待用户交互的 Runtime 不因 Session 是否可见而回收。排队中的 Session 尚未分配 Runtime。有新任务等待时，任何空闲 Runtime 都必须立即让出容量。没有等待任务时，优先回收后台空闲 Session 的 Runtime，最后回收当前可见但空闲的 Runtime。Session 删除、Runtime 停止或崩溃时立即移出进程池。
14. 后台 Session 的空闲 Runtime 保留 60 秒，当前可见 Session 的空闲 Runtime 保留 5 分钟。保温时间从进入空闲的时刻起算；切换 Session 只改变适用期限，不重置计时器。有排队任务、应用退出、Session 删除或配置变化时不等待保温期限。保温进程计入最大并行数量，进程总数不得超过该设置。
15. 用户调低最大并行数量后立即按新上限调度。已经运行或等待用户交互的任务不强制停止，可以暂时超出新上限；在运行数量低于新上限前不再启动排队任务。空闲 Runtime 按“后台优先、当前可见最后”的顺序立即回收。已排队任务保持 FIFO 顺序。保存前提示当前运行数量和调低后的影响。
16. 空闲 Runtime 只有在没有未完成 RPC 或交互请求，且目标 Session 属于同一 Workspace、最终环境变量和网络配置相同、Approval Mode 相同、OMP Runtime 版本相同时才可以复用。已有 Session 调用 `switch_session`，临时新 Session 调用 `new_session`。不满足条件或切换失败时，关闭旧进程并按目标配置重新启动。每次分配新的 Runtime Instance ID 或等价 generation，用于忽略上一次 Session 租约的迟到事件。
17. 同一 Workspace 的多个 Session 可以直接并行。Desktop 不弹确认框，不显示额外风险提示，不做文件锁，不因检测到相同文件而停止或排队任务，也不自动回滚文件。文件变化继续按现有刷新规则显示。
18. 全局等待队列只保存在内存中。正常退出时静默取消所有尚未开始的排队任务，不弹提示；应用崩溃后不恢复排队任务。已被 OMP 接收的任务以 Session 文件为准，启动后不自动重发 Prompt。
19. 排队任务获得名额后，如果 Runtime 启动或 Session 切换在 Prompt 被 OMP 接收前失败，使用全新进程自动重试一次。第二次仍失败时，将该 Session 标记为失败，恢复首条 Prompt，释放名额并继续下一个 FIFO 任务。Prompt 已被 OMP 接收后崩溃时不自动重放。用户手动重试时作为新队列项排到队尾。
20. 用户取消正在从排队切换到启动的任务时，以 Main 是否已收到 `prompt` 成功接收响应为边界。Prompt 尚未被 OMP 接收时，取消有效，停止启动或 Session 切换、恢复输入并释放名额。Prompt 已被 OMP 接收时，任务转为正在执行，用户需要调用 Stop。Renderer 只发送取消请求，由 Main 返回“已取消”或“已经开始”。每个队列项使用唯一 ID，取消、分配和 Prompt 接收对同一 ID 串行更新。
21. 后台 Session 等待 Tool Approval 或 Extension UI 输入时，Main 为对应 Session 标记 `waitingForInteraction`。Session 行尾用琥珀色感叹号替换 Spinner；对应 Workspace 未展开时，Workspace 行尾显示聚合圆点。点击后打开该 Session 并定位到交互位置。不自动切换 Session，不发送系统通知。处理完成或超时后恢复 Spinner。
22. Session 行尾同一时刻只显示一个状态图标，优先级依次为：等待用户交互的琥珀色感叹号、Runtime 失败的红色感叹号、等待 Runtime 的静止时钟、正在启动或执行或停止的 Spinner。空闲时不显示运行状态图标。悬停提示说明具体阶段，打开 Session 后在输入框上方显示详细状态和可用操作。
23. 多 Runtime 阶段将 Runtime Network 配置改为“全局默认值 + Session 独立配置”。全局值只是新 Session 的默认值；正式 Session 保存自己的网络配置，Runtime 在启动时根据目标 Session 解析并注入最终环境。临时新 Session 的选择在首条 Prompt 形成正式 Session 后再持久化。修改某个 Session 的网络配置不影响其他 Session。该规则在多 Runtime 范围内取代决策 09 中“所有 Session 共用一份全局网络配置”的旧模型。
24. 当前 Settings 暂时只包含“新会话默认网络”和“最大并行 Session 数量”两项。全局 Settings 入口放在 Conversations 标题栏，打开后在 Runtime 分区显示这两项。输入框控制栏保留“当前会话网络”，只修改当前 Session。正式 Session 可以执行“改为当前默认值”，该操作只复制一次当前全局默认配置，不建立动态跟随关系。修改全局默认值不影响已有 Session，不重启它们的 Runtime。
25. 空闲 Runtime 在 Workspace、最终环境、Session 网络配置、Approval Mode 和 OMP 版本都与目标 Session 相容时，优先通过 `new_session` 或 `switch_session` 复用，不新增进程。配置不同时，可以关闭该空闲进程后在同一池名额中按目标配置启动替代进程。正在执行的 Runtime 不得切换 Session；目标 Session 只能获得另一个 Runtime 或进入全局队列。
26. Renderer 始终保留当前可见 Session，以及所有排队、启动、执行、等待交互和正在停止 Session 的独立对话投影。投影不保留 RPC 原始事件、完整大型 Tool 输出、图片 Base64 和临时动画数据。后台任务结束后，空闲投影仍只保留最近离开的一个；重新打开已释放投影的 Session 时，以 OMP Session 文件重新加载。投影只存在当前 Desktop 运行期间，不持久化。
27. 后台 Session 执行完成后，行尾显示小蓝点，表示本次运行结束后尚未查看；当前可见 Session 完成时不显示。打开 Session 后清除蓝点。Workspace 未打开时在 Workspace 行尾显示聚合蓝点。等待交互和失败图标的优先级高于蓝点。不发送系统通知，不自动切换 Session。
28. Session 列表只在用户成功提交 Prompt 或 Follow-up 时更新该 Session 的 `lastModified` 并重新排序一次。排队、Runtime 启动、流式输出、工具事件和执行完成不再改变列表顺序。后台完成只显示未查看蓝点。进入队列后取消 Prompt 时，恢复取消前的 `lastModified` 和列表位置。
29. 正在执行、等待交互或存在 Follow-up 的后台 Session，在会话行的右键菜单或更多菜单中显示“停止任务”。点击后直接 Stop，不再弹确认框，且只影响目标 Session 的 Runtime。状态图标本身不执行 Stop。停止完成或 5 秒超时强制结束后释放名额并继续全局队列。
30. 排队中的新 Session 由 Main 生成 Temporary Session ID，会话列表立即显示临时行和时钟图标。用户切换到其他 Session 后，临时行和排队任务继续保留。Prompt 被 OMP 接收并返回真实 Session ID 后原地绑定为正式 Session，不新增第二行。取消等待后临时行保留并恢复草稿；之后切换 Session 或 Workspace 时按现有临时新会话规则丢弃。启动失败时临时行保留并显示失败状态。应用退出时不持久化 Temporary Session ID。
31. 升级到 Session 独立网络配置时，把旧的全局 Runtime Network 配置同时保存为新 Session 默认值和旧 Session 迁移基准值。旧 Session 缺少独立网络配置时使用迁移基准值，第一次打开或运行时再补存为它的独立配置。新 Session 直接复制创建时的全局默认值。使用配置版本或迁移标记区分升级前缺字段的旧 Session 和升级后的新 Session。
32. 目标 Session 优先直接复用仍与自身绑定的空闲 Runtime。用户修改网络设置时，以解析后的最终 Runtime 环境是否变化判定相容性；配置名称变化但最终环境完全相同时可继续复用当前进程。最终环境不同时，旧 OMP 进程不能复用；可以复用同一 Supervisor 或池槽位，但必须重新创建底层操作系统进程。
33. 池中有多个相容的空闲 Runtime 时，优先级依次为：仍绑定目标 Session 的保温 Runtime、同 Workspace 中最早进入空闲的后台 Runtime、当前可见 Session 的空闲 Runtime。空闲时间相同时按 Runtime Instance ID 稳定排序。
34. 多 Runtime 阶段不再对 Prompt 已被 OMP 接收后崩溃的进程立即自动重启，也不重放 Prompt。对应 Session 标记为失败，恢复 Prompt，释放名额并继续全局队列；用户手动重试后再按正常调度创建或复用 Runtime。Prompt 被接收前的启动失败仍按决策 19 自动重试一次。空闲保温 Runtime 崩溃时直接移出池，不重启，不标记 Session 任务失败。该规则在多 Runtime 范围内取代决策 02 的首次崩溃立即自动重启规则。
35. 应用退出时先停止接收新 Prompt 并静默清空全局等待队列，再并行向池内全部 Runtime 发出正常关闭请求。所有 Runtime 共用一个 5 秒退出期限，不按进程逐个累计。到期后统一强制结束仍存活的进程组。关闭期间取消所有未完成的 Tool Approval 和 Extension UI 请求。Electron Main 只在全部进程退出或被强制清理后结束。
36. Renderer 刷新或崩溃重载不停止 Runtime，不清空 Main 中的队列。Runtime Pool、队列、Temporary Session ID 和每个 Session 的运行状态均由 Main 持有。新 Renderer 就绪后先取得完整 Pool Snapshot，再重新订阅事件；对所有正在运行或等待交互的 Session 并行调用对应 Runtime 的 `get_state` 和 `get_messages`，补齐重载期间的历史和交互请求。正式 Session 草稿从现有 `localStorage` 恢复；临时新 Session 的下一条未发送草稿允许丢失，但已进入 Main 队列的首条 Prompt 不能丢失。
37. RPC Request ID、Tool Approval ID 和 Extension UI ID 都只在所属 Runtime Instance 内唯一。Main 内部使用 `Runtime Instance ID + generation + 原始 ID` 作为复合键。发往 Renderer 的事件外层必须携带 Workspace ID、Session ID、Runtime Instance ID 和 generation；Renderer 回传交互响应或 Stop 时必须携带目标 Session 和 Runtime Instance ID。Main 核对当前绑定和 generation，忽略旧 Runtime 或旧租约的迟到响应并记录诊断，不修改 OMP 原始 ID。
38. 需要发给 OMP 的 Slash Command 与普通 Prompt 使用同一套 Runtime 分配和全局 FIFO 队列，不得绕过最大并行数。OMP 返回 `prompt_result(agentInvoked: false)` 后立即标记 Runtime 空闲并推进队列。不需要 OMP 进程的纯 Desktop 本地命令可立即执行，不占 Runtime 名额。Session 已在运行时的 Slash 输入继续使用现有命令分类和限制。Slash 的排队、取消、失败和 Temporary Session ID 规则与普通 Prompt 相同。
39. 后台任务正常完成时，在对应 Session 偏好中持久化 `unreadCompletion: true`；用户打开该 Session 后清除并持久化为 `false`。当前可见 Session 完成和 Runtime 崩溃时不写入未查看完成状态。Session 删除时一并清理，归档时保留。除这个布尔值外，不持久化 Runtime 运行状态、队列或对话投影。
40. Runtime 失败的红色状态只存在当前 Desktop 运行内存中，不跨重启保留。用户打开 Session 查看错误时不自动清除；手动重试成功进入排队或启动状态，或新 Prompt 被 OMP 接收时清除。Session 删除时直接清理。Desktop 重启后以 Session 文件和已保存草稿恢复，详细错误仍保留在诊断日志中。Temporary Session 的失败状态随临时行在退出时丢弃。
41. 整个 Desktop 同一时间只允许一个 Provider 登录流程。登录记录发起它的 Session 和 Runtime Instance ID；期间其他 Session 可以继续运行，但所有 Session 的 Provider 登录入口暂时禁用。发起 Runtime 崩溃、被停止或被回收时取消登录。登录成功后刷新全局 Provider 和模型目录，但不自动重放失败的 Prompt。Provider 登录不算 Agent 并行任务，但承载登录 RPC 的 Runtime 在结束前不得切换 Session。
42. Provider 登录只允许从空闲 Session 发起，优先使用该 Session 已绑定的相容空闲 Runtime；没有绑定 Runtime 时可占用一个空闲池名额启动进程。全部名额已被运行或等待交互的任务占用时，禁用登录按钮并提示等待 Runtime 可用后重试。Provider 登录不进入全局任务队列，不创建时钟图标、Temporary Session 行或队列位置。登录使用发起 Session 的网络配置；期间对应 Runtime 计入进程总数。
43. Main 对最终 `cwd`、Runtime 路径和版本、Approval Mode、解析后的网络配置以及最终环境变量生成不可逆的相容性指纹。环境变量按键名排序后计算 SHA-256，只在内存中保存指纹。`PWD`、`OLDPWD`、`SHLVL`、`_` 等会随 Shell 启动变化的值不参与环境指纹，Workspace 规范路径单独比较。日志、诊断和 Renderer API 只显示相容结果和不敏感的原因分类，不输出原始环境变量、代理凭据或指纹输入。Desktop 重启后重新解析，不持久化指纹。
44. 当前版本不实现独立的 Runtime 管理器或全局队列面板，不在日常 UI 中展示 Runtime Instance ID、PID 或完整进程列表。排队 Session 在自身状态条显示队列位置，Session 和 Workspace 行图标表示各类状态。Settings 的最大并行输入框下方可显示“正在运行 N / M，等待 K”的只读摘要，但不增加第三个设置项。Runtime 详细信息只进入诊断日志。
45. 取消排队时，当前输入框为空则直接恢复已取消 Prompt；已有下一条草稿时不覆盖，在输入框上方显示“已取消的消息”恢复条。点击“恢复到输入框”时交换两份内容，文字、引用和附件一起交换。恢复条只存在当前 Desktop 内存中，切换 Session 时保留，关闭应用时丢弃。不弹确认框，不自动合并两条消息。该规则补充决策 9 的恢复行为。
46. 取消排队、Runtime 启动连续失败和 Prompt 被接收后 Runtime 崩溃都使用决策 45 的统一恢复逻辑。恢复条标明“已取消”、“启动失败”或“Runtime 崩溃”。文字、`@` 引用和当前 Desktop 运行内仍存在的附件一起恢复。不自动重发，不自动合并，不写入 Session 历史。
47. 全局 Runtime 等待队列最多保存 20 个任务，排队任务的文本、图片和引用序列化后合计最多占用 64 MiB。任一上限达到后，Main 拒绝新的排队请求；被拒绝的 Prompt 保留在输入框，不创建 Temporary Session 行，不更新 `lastModified`，并在输入框附近显示队列已满。正在运行的 Prompt、Follow-up 队列和普通草稿不计入这个字节上限。上限固定，不加入 Settings。
48. 每个 Session 最多保留 5 条尚未执行的 Follow-up，所有 Runtime 的待执行 Follow-up 在 Desktop 内存中合计最多占用 64 MiB。任一上限达到后拒绝新的 Follow-up，内容保留在输入框并提示队列已满。Follow-up 开始执行后从待执行字节数中移除，但仍作为当前活动输入保留到完成。正在执行的 Prompt、全局 Runtime 等待队列和普通草稿不计入这个字节上限。上限固定，不加入 Settings。
49. 本任务先建立可重复的多 Runtime 性能基线，不预设 CPU、内存或延迟的硬门槛。在同一台 Ubuntu 验收机上分别测试并行数 1、5、10，记录 Electron Main、Renderer、每个 OMP 及子进程的 RSS，以及全部运行、保温空闲和回收后的总内存。记录 Runtime 启动到 `ready`、Session 切换完成、Prompt 到首个可见文本的时间。每组运行 5 次，记录中位数和最大值，并固定 Prompt、模型和 Thinking 等级。完成条件是没有持续增长、进程能按时回收且结果可复现；获得基线后再决定是否单建性能优化任务。
50. 多 Runtime 继续使用一份 Desktop 诊断日志，不为每个 Runtime 建立独立文件。每条 Runtime 记录和 OMP `stderr` 行统一带 Runtime Instance ID、generation、Workspace ID、Session ID 和事件类型前缀。Temporary Session ID 绑定到真实 Session ID 时记录一次映射事件。日志继续执行现有脱敏和大小限制，不记录 Prompt 正文、完整环境变量、代理凭据或模型密钥。Runtime 回收后保留关联 ID。错误详情 UI 只展示目标 Session 对应 Runtime 的最近日志，不混入其他 Runtime。
51. Runtime Pool 分阶段实现：先建立 Pool 接口和按 Session 路由，强制 `maxParallel = 1` 验证现有单 Runtime 行为；再接入 Runtime Instance ID、generation、Pool Snapshot 和 Renderer 重载恢复，仍保持上限 1；然后开启多进程和 FIFO 队列；最后接入 Settings、Session 独立网络、状态 UI 和性能基线。发布时直接使用新 Pool，不保留用户可见的旧单 Runtime 模式或实验开关。
