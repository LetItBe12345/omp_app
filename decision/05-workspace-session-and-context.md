# 决策记录 05：Workspace、Session 与上下文引用

- 对应任务：`TODO/in-progress/05-workspace-session-and-context.md`
- 状态：已实施
- 记录日期：2026-07-24
- 上游真相：`decision/04-streaming-conversation-and-run-trace.md`
- 下游约束：`decision/06-session-permissions-and-tool-approvals.md`

## 任务边界

1. MVP-04 负责单个 Session 的实时事件和历史消息如何投影、排序与显示。MVP-05 负责发现、新建、切换、加载和管理 Session，并把 OMP 历史交给 MVP-04 已确定的同一套投影函数。
2. MVP-05 不重新定义 Thinking、Tool Call、Interaction、执行轨迹折叠和最终回答规则。
3. MVP-05 提供 Workspace ID、Session ID、最小 Desktop 配置、Session 切换和短期展示缓存。MVP-06 在此基础上保存 Session 权限并处理权限变化，不由 MVP-05 实现权限按钮和工具审批。

## 从 MVP-04 继承的规则

4. Session 的实时事件与历史消息使用同一个纯投影函数。切换 Session 后，MVP-05 只负责取得 OMP 历史并调用该投影，不增加第二套历史解析逻辑。
5. OMP Session 是消息、Thinking 和 Tool Call 的唯一可信来源。Desktop 不建立聊天数据库，也不持久化完整 RPC 事件流。
6. 历史恢复不保留临时进度、动画、已处理的 Interaction 控件和中间 Lifecycle 状态。成功任务、失败任务和等待 Interaction 的默认展开状态按 MVP-04 恢复。

## 从 MVP-06 继承的规则

7. Workspace 和 Session 必须具有稳定 ID。Desktop 的 Session 级配置以 Workspace ID 和 Session ID 为索引，MVP-06 的审批模式复用该结构。
8. Desktop 配置放在 Electron 的 Desktop 数据目录，使用原子替换，不修改 Workspace 内的 `.omp/config.yml`，也不增加数据库。具体文件名、完整结构和旧配置迁移方式仍由本任务确认。
9. 文字草稿使用按 Workspace ID 和 Session ID 区分的 `localStorage`。附件只在当前 Desktop 运行期间按 Session 保留，不跨 Desktop 重启恢复。
10. Renderer 只短期缓存当前 Session 和最近离开的 1 个 Session 的历史展示投影。缓存不含 RPC 原始事件、Tool 完整输出、图片 Base64、二进制内容、临时动画或进度，也不跨 Desktop 重启保存。
11. 切换到有展示缓存的 Session 时先显示缓存；OMP 恢复后按消息 ID 使用真实历史校正。没有缓存时等待 OMP，超过 150 毫秒后在聊天区域显示“正在打开会话…”。
12. Runtime 正在执行、Follow-up 队列非空或等待 Interaction 时禁止切换 Session，用户需要先 Stop。
13. Session 删除成功后清理该 Session 的权限配置、文字草稿、附件和历史展示缓存；删除失败时全部保留。
14. Session 归档时保留 Session 权限和文字草稿，可以释放附件和历史展示缓存。
15. Session 列表不显示权限标签。权限只在 MVP-06 的当前 Session 输入区中显示和修改。

## 配置职责

16. Desktop 不保存聊天消息，但可以保存 Workspace、Session 管理元数据、Session 级设置、布局和普通设置。因此“Desktop 只保存 Workspace、置顶、归档和界面偏好”应理解为不复制 OMP 会话内容，而不是禁止保存 MVP-06 所需的 Session 权限。
17. 最小配置必须带格式版本，并为后续迁移保留入口。持久化写入采用同目录临时文件写完后原子替换正式文件，避免只写入部分 JSON。

## `grill-me` 已确认规则

18. 用户首次选择 Workspace 时，Desktop 取得规范绝对路径并生成随机 UUID。同一规范路径再次加入时复用原 UUID；目录移动到新路径后视为新的 Workspace，不自动继承原 Workspace 的管理状态。
19. 一个 Workspace 对应多个 Session，一个 Session 只归属一个 Workspace。Session 通过 OMP 头部的 `cwd` 归属 Workspace，Session ID 本身不编码 Workspace。Workspace 按其 Session 中最大的 `modifiedAt` 排序；没有 Session 时使用 Workspace 加入时间。Desktop 缓存该值并在启动后后台校验，不阻塞首屏。
20. Desktop 在磁盘中保留所有用户明确添加的 Workspace，不设数量上限。侧栏首次只加载当前 Workspace、已置顶 Workspace和最近 7 天活跃的 Workspace；一周以前的记录通过“更多”按每批 50 个加载。路径失效或无权限时保留并标记“不可用”。手动移除只删除 Desktop 管理数据，不删除目录或 OMP Session。
21. 随应用分发的 OMP 版本为 17.0.6。该版本 RPC 没有 Session 列表和删除命令。Session 列表的唯一可信来源是 OMP 在 `~/.omp/agent/sessions/<cwd 编码>/` 下保存的 JSONL；Desktop 只读解析现有头部和文件元数据，不建立新的 Session 存储格式。
22. 删除 Session 时，运行中的 Session 必须先 Stop；删除当前空闲 Session 时先切换或新建另一个 Session。Main 必须校验文件位于当前 Workspace 对应的 OMP Session 目录，并核对头部 Session ID。删除使用系统废纸篓，不直接永久删除，不递归清理共享 Blob。只有放入废纸篓成功后才清理 Desktop 关联状态，失败时全部保留并显示错误。
23. Desktop 配置文件固定为 Electron 用户数据目录下的 `desktop-state.json`，初始格式版本为 1。它保存活动 Workspace、Workspace 列表、按 Workspace ID 和 Session ID 索引的置顶、归档与权限等 Session 偏好，以及 UI 设置；不复制 Session 标题、消息和时间。文件以 `0600` 权限写入同目录临时文件，`fsync` 后原子替换。首次升级读取现有 `runtime-state.json` 并迁移；新配置存在后忽略旧配置，旧文件暂时保留但不再写入。
24. Session 搜索默认只作用于当前 Workspace，匹配 Session 标题、用户消息和可见 Assistant 文本，不搜索 Thinking、Tool 参数、Tool Result 或隐藏消息。Main 按需扫描 OMP JSONL，不建立搜索数据库，也不让全文常驻 Renderer；新查询取消旧查询。结果按 `modifiedAt` 倒序每批返回 50 条，空查询恢复普通扁平列表。
25. 点击“新建 Session”只打开临时输入界面。首条消息发送前不创建 Desktop Session 记录、不加入 Session 列表，也不持久化临时文字、附件或权限。切换 Workspace、切换到其他 Session 或关闭 Desktop 时直接丢弃；再次新建时显示空输入。首次 Prompt 被 OMP 接受并形成真实 Session 后，才按真实 Session ID 保存权限和其他设置。首次发送失败时只在当前界面内保留内容供立即重试。
26. 临时新会话显示“新会话”。形成真实 Session 后，优先使用 OMP 已有标题；没有标题时，Desktop 清理首条用户消息第一行并通过 `set_session_name` 写回 OMP，不启用额外的模型标题生成。只有图片且没有文字时使用“图片会话”。列表只按宽度省略显示，不保存截断副本；用户手动重命名后不再自动覆盖。
27. 保留 Session 归档。归档不是删除，只修改 Desktop 元数据并保留 OMP JSONL、权限和正式 Session 草稿；归档区位于当前 Workspace 底部，默认折叠且为空时不显示，可以取消归档。归档时取消置顶，二者不能同时存在。归档当前 Session 前先切换到其他 Session；没有其他 Session 时打开临时新会话。运行、Follow-up 排队或等待 Interaction 时必须先 Stop。删除仍是独立操作。
28. Workspace 列表不使用日期分组标题：已置顶在前，其余按内部最新 Session 的 `modifiedAt` 倒序。当前 Workspace 内只保留“正在运行”“已置顶”“会话”“已归档”四组；未归档且未置顶的 Session 在“会话”中按 `modifiedAt` 倒序扁平排列，不再拆成“今天、最近 7 天、更早”。旧 Session 每批加载 50 条，空组不显示。同一个 Session 不在多个组重复出现。列表不在 Session 行右侧显示时间，`modifiedAt` 只用于排序。
29. Desktop 的 Session 读取器接受无版本号的 v1、v2 和当前 v3。头部 `id`、`cwd` 或时间字段无效时标记为损坏；高于 v3 的版本标记为与当前 OMP 17.0.6 不兼容，二者都不能打开，但仍在列表中显示文件路径和移入废纸篓入口。使用一个最小通用头部读取器和按版本分支的简单适配器，未知条目类型只在元数据读取时忽略。升级 OMP 时必须加入对应版本的真实 JSONL fixture、兼容表和测试，不跨 OMP 版本自行迁移 Session。
30. Workspace 和 Session 都通过右键菜单置顶。未置顶项只显示“置顶”，已置顶项只显示“取消置顶”；键盘的菜单键或 `Shift+F10` 打开同一菜单，不长期显示额外的省略号按钮。操作后立即关闭菜单并重排，写入失败时恢复原顺序并显示错误。已置顶项显示小型置顶图标；置顶区内部仍按 `modifiedAt` 倒序。
31. `@` 候选使用一个可滚动的单层菜单，只按文件、文件夹和 Session 分块，不进入二级菜单。裸 `@` 显示当前已加载消息中最近引用且仍有效的 5 个文件或文件夹、Workspace 根目录最多 15 项，以及当前 Workspace 最近使用的 5 个非当前、非归档 Session。最近引用按出现时间倒序并按规范路径去重，不额外扫描完整 Session，也不持久化引用历史。根目录只读一层，过滤隐藏项、忽略目录和不可读项；文件夹最多 8 个、文件最多 7 个，一类不足时名额转给另一类，类内按自然名称排序。
32. 用户输入查询后，只按需搜索当前 Workspace，不建立常驻的全量文件索引。文件名、文件夹名、路径片段和 Session 标题使用不区分大小写的包含匹配；完全匹配、名称前缀、路径片段前缀、普通包含依次排序，不做拼音或字符跳跃式模糊匹配。文件、文件夹和 Session 每类最多 20 个；文件和文件夹同级时按自然名称排序，Session 同级时按 `modifiedAt` 倒序。关闭菜单时取消未完成搜索并释放本次结果。
33. `@file` 和 `@folder` 的选择结果在 Renderer 中显示为引用标签，发送时转换为 OMP 可识别的 Workspace 相对路径，含空格的路径使用引号；Desktop 不读取或复制正文。候选不按扩展名过滤。PDF、DOCX、PPTX、XLSX、EPUB 和图片使用 OMP 现有读取能力；音频、视频及其他二进制文件允许引用，但不承诺可以直接理解。MVP 不增加 Desktop 文档解析器、音视频转码流程或语音识别服务。
34. `@session` 使用只读的 `omp-session://<workspace-id>/<session-id>` Host URI。Prompt 只放 Session 标题和 URI；模型调用 `read` 时，Desktop 返回最新 OMP 压缩摘要、首条用户消息和最近 10 轮可见的用户消息及 Assistant 最终回答，不返回 Thinking、Tool 参数、Tool Result 或隐藏消息。每页最多 50 KiB，存在更早内容时返回带游标的上一页 URI，不直接注入完整 JSONL。
35. Host URI 通过当前 Workspace 的 Session 索引解析。缓存路径失效时只重扫该 Workspace 的 OMP Session 目录一次，并核对目标是预期目录下的普通 `.jsonl`、头部 Session ID 和 `cwd`。不得按标题猜测、跨 Workspace 搜索或自动替换。Session 已删除、损坏、不兼容或仍找不到时返回 `isError: true`；只让本次 `read` 失败，不中断整个 Session。
36. 单次 Prompt 的引用数量不设固定上限。Desktop 不估算上下文占用，也不显示预警；重复的相同路径或 Session 只保留一个。上下文提升、预发送压缩和溢出恢复交给 OMP，最终仍超限时显示 OMP 的实际错误。
37. 引用标签默认只显示类型图标和名称，同名时补充最短可区分父目录。完整相对路径、类型和磁盘文件大小放在悬停或键盘聚焦信息中；不长期显示绝对路径、时间或大小。移除入口使用小型 `×`。已删除、无法读取或其他失败状态直接显示在标签上。
38. 文件和文件夹发送前必须通过 `realpath` 再次确认仍位于当前 Workspace 内。指向 Workspace 外的符号链接不进入候选，也不能引用。选择后失效的引用标记失败并从发给 OMP 的内容中跳过，但不阻止其他有效引用和普通文字发送；如果只剩失效引用且没有文字，则不发送空 Prompt。不得自动查找同名路径替代。
39. 正式 Session 保存未发送的文字草稿和 `@` 引用描述，不保存被引用文件的内容。单草稿最多持久化 256 KiB，全部正式 Session 草稿合计最多 2 MiB，均按 UTF-8 字节数计算；不设置 Session 数量上限。超过总量时先清理最后编辑超过 30 天的草稿，再按最后编辑时间清理最旧的非当前 Session 草稿。单草稿超限时不静默截断，当前输入继续保留并显示未保存状态。应用启动或空闲时才执行过期清理，不在用户查看时删除。写入失败时保留内存内容，清理旧草稿后重试一次，仍失败则显示错误。成功发送或 Session 删除成功后清理，归档时保留。
40. Workspace 内的图片文件通过 `@file` 引用时只在草稿中保存相对路径等少量描述，可以随文字草稿恢复并在发送前重新校验。粘贴或直接添加的图片附件不属于持久化草稿，只在当前 Desktop 运行期间按正式 Session 保留，不写入 `localStorage`，也不跨重启恢复。
41. `switch_session` 只用于头部 `cwd` 与当前 Workspace 规范路径一致的 Session。同一 Workspace 内，目标 Session 权限与当前 Runtime 相同时复用进程并直接切换；权限不同时使用同一 Workspace 的 `--cwd` 重启 Runtime，再恢复目标 Session。跨 Workspace 不复用或直接切换旧 Runtime，必须停止旧进程，使用目标 Workspace 的 `--cwd` 启动新进程后再恢复目标 Session。
