# MVP-05：Workspace、Session 与上下文引用

- 状态：已完成
- 优先级：P0
- 前置任务：MVP-04
- 后续任务：MVP-06

## 目标

让用户可以管理本地 Workspace，发现、新建、切换和恢复 OMP Session，并通过 `@` 引用加入上下文。

## 与 MVP-04、MVP-06 的边界

- MVP-04 负责单个 Session 的实时事件和历史消息如何投影、排序与显示。MVP-05 只负责发现、切换和加载 Session，并把 OMP 历史交给 MVP-04 已确定的同一套投影函数。
- MVP-05 不重复定义 Thinking、Tool Call、Interaction、折叠和最终回答规则。
- MVP-05 提供稳定的 Workspace ID、Session ID、最小 Desktop 配置、Session 切换和短期展示缓存。
- MVP-06 在这些基础上保存每个 Session 的审批模式，并处理权限变化导致的 Runtime 重启。MVP-05 不实现权限按钮和工具审批。
- MVP-05 负责 Session 切换限制、草稿、附件、缓存和清理机制；MVP-06 只复用这些机制并增加权限状态。

## 固定方案

- MVP 同一时间只激活一个 Workspace。
- 一个活动 Workspace 对应一个长期 OMP RPC 进程。
- 单个 OMP Runtime 同一时间只有一个活动 Session 可以生成。
- Session 消息和 Agent 状态由 OMP 持有。
- Desktop 不建立独立聊天数据库，不持久化完整 RPC 事件、Tool 完整输出、图片 Base64、二进制内容、临时动画或运行进度。
- Desktop 可以保存 Workspace、Session 管理元数据、Session 级设置和界面偏好；MVP-06 的审批模式也使用这份最小配置。
- 历史恢复使用 MVP-04 的投影函数。OMP 返回的消息是最终依据。
- Renderer 只短期缓存当前 Session 和最近离开的 1 个 Session 的历史展示投影，且不跨 Desktop 重启保存。
- 文字草稿使用按 Workspace ID 和 Session ID 区分的 `localStorage`；附件只在当前 Desktop 运行期间按 Session 保留。
- Runtime 执行中、Follow-up 队列非空或等待 Interaction 时禁止切换 Session，用户需要先 Stop。
- 首条消息发送前的“新建 Session”只是 Renderer 内的临时输入界面，不属于正式 Session，也不跨切换或重启保留。

## 明确不做

- 不支持多个 Workspace 同时运行 Agent。
- 不为每个 Session 启动进程。
- 不建立复杂文件夹、标签和团队协作系统。
- 不把完整历史会话直接塞入模型上下文。
- 不在本任务实现 MVP-04 的消息投影规则。
- 不在本任务实现 MVP-06 的权限按钮、审批识别和审批交互。

## 任务清单

### Workspace

- [x] 支持选择本地目录作为 Workspace。
- [x] 为 Workspace 定义稳定 ID，并保存最近 Workspace 列表。
- [x] 显示 Workspace 路径和可用状态。
- [x] Workspace 和 Session 的右键菜单支持置顶；只按当前状态显示“置顶”或“取消置顶”，并支持菜单键和 `Shift+F10`。
- [x] 置顶状态写入失败时恢复原顺序并显示错误。
- [x] 切换 Workspace 前检查 Runtime 执行、Follow-up 队列和 Interaction 状态；存在任一活动状态时要求用户先 Stop。
- [x] 切换时有序停止旧 OMP，再以新 `--cwd` 启动。
- [x] 目录失效、无权限和 OMP 启动失败时显示明确错误。

### Session 能力确认

- [x] 从 OMP v17.0.6 源码确认 Session 列表和元数据的唯一可信来源。
- [x] 确认 RPC 是否已有列出和删除 Session 的能力。
- [x] 如果 RPC 没有列表接口，只读取 OMP 现有 Session 元数据，不新建消息存储格式。
- [x] 记录 Session 文件路径、命名规则、稳定 ID、字段含义和兼容边界。
- [x] 实现无版本号 v1、v2、v3 的只读兼容适配；损坏和高于 v3 的 Session 隔离显示且不能打开。
- [x] 为每个支持的 Session 版本加入真实 JSONL fixture、兼容表和测试。
- [x] 明确 Session 删除使用 OMP 能力还是受控文件操作，以及失败时的处理方式。
- [x] 将最终方案补充到项目文档。

### Session UI

- [x] 支持新建 Session。
- [x] 新建后先显示临时空输入界面；首条消息发送前不创建 Desktop Session 记录，也不加入 Session 列表。
- [x] 临时新会话在切换 Workspace、切换到其他 Session 或关闭 Desktop 时直接丢弃，不恢复文字、附件和权限。
- [x] 首次 Prompt 被 OMP 接受并形成真实 Session 后，才按真实 Session ID 保存权限和其他设置。
- [x] 真实 Session 没有 OMP 标题时，清理首条用户消息第一行并调用 `set_session_name`；只有图片时使用“图片会话”，不调用模型生成标题。
- [x] 支持切换 Session。
- [x] 调用 `switch_session` 前核对目标 Session 头部 `cwd` 与当前 Workspace 的规范路径一致；跨 Workspace 必须按目标 `--cwd` 重启 Runtime。
- [x] 切换后使用 `get_messages` 恢复历史，并交给 MVP-04 已确定的投影函数。
- [x] OMP 恢复完成后按消息 ID 用真实历史校正短期展示缓存，不自行合并两份消息来源。
- [x] 有缓存时立即显示目标 Session；没有缓存时等待 OMP，超过 150 毫秒后显示“正在打开会话…”。
- [x] 支持重命名 Session。
- [x] 支持搜索 Session。
- [x] 支持置顶和归档；归档时取消置顶，已归档区默认折叠且为空时不显示。
- [x] 归档不修改 OMP JSONL，可以取消归档；归档当前 Session 前先切换，运行中要求先 Stop。
- [x] 补全 MVP-06 所依赖的 Session 删除动作和结果语义。
- [x] 当前 Workspace 内只显示“正在运行”“已置顶”“会话”“已归档”四组，同一 Session 不重复出现。
- [x] “会话”按 `modifiedAt` 倒序扁平排列，不按日期分段，不在行右侧显示时间；旧 Session 每批加载 50 条。
- [x] 运行中的 Session 显示明确状态。
- [x] Runtime 执行中、Follow-up 队列非空或等待 Interaction 时禁用 Session 切换，并提示用户先 Stop。
- [x] Session 列表不显示 MVP-06 的权限标签。
- [x] 恢复历史时不重复消息；Thinking、Tool Call 和最终回答的投影正确性由 MVP-04 的共用投影函数保证。

### `@` 引用

- [x] 使用单层可滚动菜单分块显示文件、文件夹和当前 Workspace 的 Session，不使用二级菜单。
- [x] 裸 `@` 显示最近 5 个有效引用、根目录最多 15 项和最近 5 个非当前、非归档 Session；只读根目录一层，不持久化引用历史。
- [x] 输入查询后按需搜索当前 Workspace；每类最多 20 项，按完全匹配、名称前缀、路径片段前缀和普通包含排序。
- [x] 搜索不建立常驻全量索引；新查询取消旧查询，关闭菜单后释放结果。
- [x] 优先复用当前固定版本 assistant-ui 的 Trigger Popover 和引用标签能力，并最小改造 ohmypi-craft 的按需文件搜索；不复制完整组件体系。
- [x] `@file`、`@folder` 发送 Workspace 相对路径，Desktop 不读取正文；含空格路径使用 OMP 支持的引号形式。
- [x] 文件候选不按扩展名过滤；文档、图片和其他二进制类型由 OMP 现有工具处理，Desktop 不增加解析或转码依赖。
- [x] 注册只读 `omp-session` Host URI；按需返回最新压缩摘要、首条用户消息和最近 10 轮可见对话，每页最多 50 KiB，并提供更早页游标。
- [x] Host URI 只按 Workspace ID 和 Session ID 解析；缓存失效时只重扫所属 Workspace，并核对 JSONL 路径、头部 ID 和 `cwd`。
- [x] 引用标签显示紧凑名称、小型 `×` 和失败状态；完整相对路径、类型、磁盘大小放在悬停或聚焦信息中。
- [x] 引用数量不设固定上限，不由 Desktop 估算或提醒上下文占用；重复引用去重，超限显示 OMP 实际错误。
- [x] 发送前使用 `realpath` 确认文件和文件夹仍在当前 Workspace；排除指向 Workspace 外的符号链接。
- [x] 失效引用从发送内容中跳过且不阻塞其他文字；只剩失效引用时不发送空 Prompt，也不自动替换同名路径。

### 持久化与短期状态

- [x] 定义带版本号的最小 Desktop 配置结构，并为 MVP-06 预留按 Workspace ID、Session ID 保存 Session 级设置的位置。
- [x] 配置只保存 Workspace、Session 管理元数据、Session 级设置、布局和普通设置，不保存聊天消息。
- [x] 配置写入使用同目录临时文件和原子替换，避免文件只写入一部分。
- [x] 版本升级时保留向前迁移入口。
- [x] 不保存模型密钥明文。
- [x] 文字草稿继续使用按 Workspace ID 和 Session ID 区分的 `localStorage`；单草稿最多 256 KiB，全部草稿合计最多 2 MiB，不设置 Session 数量上限。
- [x] 草稿保存文字和 `@` 引用描述，不复制被引用文件内容；最后编辑超过 30 天后在启动或空闲清理。
- [x] 草稿超过单项上限时不截断当前输入；总量超限时先清理过期项，再清理最旧的非当前 Session 草稿。
- [x] 草稿写入失败时保留内存输入，清理旧草稿后重试一次，仍失败则显示未保存状态。
- [x] `localStorage` 草稿只适用于已经形成 OMP Session 的正式 Session；临时新会话不写入。
- [x] 附件只在当前 Desktop 运行期间按 Session 保留，不保存图片 Base64。
- [x] 成功发送后清理对应文字草稿。
- [x] Session 删除成功后清理权限配置、文字草稿、附件和历史展示缓存；删除失败时全部保留。
- [x] Session 归档时保留 Session 级设置和文字草稿，可以释放附件和历史展示缓存。
- [x] Renderer 只缓存当前 Session 和最近离开的 1 个 Session 的历史展示投影，不跨 Desktop 重启保存。

### 测试

- [x] 测试 Workspace 切换时只存在一个 OMP 进程。
- [x] 测试 Session 新建、切换和历史恢复。
- [x] 测试同 Workspace 直接切换和跨 Workspace 使用新 `cwd` 重启；权限差异下保持原 `cwd` 重启由 MVP-06 测试。
- [x] 测试未发送首条消息的新会话不进入列表，并在切换或关闭后丢弃。
- [x] 测试首条 Prompt 成功形成 OMP Session 后才持久化 Session 偏好。
- [x] 测试单 Runtime 不会并行生成两个 Session。
- [x] 测试执行、Follow-up 排队和等待 Interaction 时不能切换 Session。
- [x] 测试 Session 文件缺失和损坏。
- [x] 测试搜索、置顶和归档持久化。
- [x] 测试归档取消置顶、归档恢复、当前 Session 归档前切换和空归档区隐藏。
- [x] 测试 Session 扁平排序、四组互斥、每批 50 条和列表不显示时间。
- [x] 测试首条文字、仅图片、OMP 已有标题和用户手动重命名的命名规则。
- [x] 测试 Session 删除成功与失败时的配置、草稿、附件和缓存清理规则。
- [x] 测试有缓存和无缓存的 Session 恢复，以及 150 毫秒延迟加载提示。
- [x] 测试 OMP 历史按消息 ID 校正展示缓存，且不产生重复消息。
- [x] 测试 Renderer 只保留当前和最近离开的 Session 展示投影。
- [x] 测试三类 `@` 引用的插入和移除。
- [x] 测试裸 `@` 三组候选、查询匹配排序、每类 20 项上限、搜索取消和结果释放。
- [x] 测试路径含空格、同名引用标签、重复引用去重、Workspace 外符号链接和发送前路径失效。
- [x] 测试 `omp-session` URI 的当前 Workspace 限制、缓存失效重扫、分页内容过滤和读取错误。
- [x] 测试 PDF、Office、图片和不受支持二进制文件只交给 OMP，不由 Desktop 展开内容。
- [x] 测试草稿单项和总量上限、30 天过期、最旧项清理、写入失败以及当前输入不被截断。
- [x] 测试 `@` 引用描述可随正式 Session 草稿恢复，粘贴或直接添加的图片附件不跨重启恢复。

## 完成条件

- [x] 应用重启后可以恢复最近 Workspace。
- [x] 可以新建、切换、恢复和管理 Session。
- [x] 多个 Session 可保存和切换，但同一时间只有一个 Session 生成。
- [x] Session 消息只以 OMP 数据为准。
- [x] Workspace 切换不会遗留旧 OMP 进程。
- [x] MVP-06 可以按 Workspace ID 和 Session ID 保存权限，并复用本任务的配置和 Session 切换机制。
- [x] `@file`、`@folder`、`@session` 可以加入输入上下文。
- [x] 需要持久化的管理状态在重启后保持一致，短期缓存和附件不跨重启恢复。

## 实施结果

- 完成日期：2026-07-24
- Main 使用 `desktop-state.json`、OMP JSONL 只读目录和受控 Session 操作；Renderer 提供 Workspace/Session 管理、短期投影缓存、正式 Session 草稿、运行期图片附件和单层 `@` 菜单。
- `pnpm check` 通过，95 个测试通过；`pnpm build` 通过。
- 原始 `pnpm smoke` 被本机 Electron `chrome-sandbox` 的所有者和 `4755` 权限阻止；只在本地验证命令加入 `--no-sandbox` 后成功渲染并输出 `OMP_SMOKE_READY`，应用代码仍保持 `sandbox: true`。

## 已从 MVP-04、MVP-06 确定

- 历史消息与实时事件使用 MVP-04 的同一套投影函数。
- OMP 历史是消息、Thinking 和 Tool Call 的最终依据，Desktop 不复制聊天数据库。
- Workspace 和 Session 必须具有可用于配置索引的稳定 ID。
- Desktop 配置位于 Desktop 数据目录，并使用原子替换。
- 文字草稿按 Workspace ID 和 Session ID 保存在 `localStorage`。
- 附件只在当前 Desktop 运行期间按 Session 保留。
- Renderer 只缓存当前和最近离开的 1 个 Session 展示投影，不跨重启保存。
- 无缓存的 Session 恢复超过 150 毫秒后显示加载状态。
- OMP 恢复后按消息 ID 用真实历史校正展示缓存。
- 执行、Follow-up 排队或等待 Interaction 时禁止切换 Session，用户需要先 Stop。
- Session 删除成功后清理权限、草稿、附件和缓存；失败时全部保留。
- Session 归档保留权限和草稿，可以释放附件和缓存。

## 已通过 grill-me 确定

- Workspace 使用规范绝对路径匹配，并由 Desktop 生成和保存随机 UUID；目录移动后视为新 Workspace。
- 一个 Workspace 对应多个 Session；Session 通过 OMP 头部 `cwd` 归属 Workspace。
- `switch_session` 只切换当前 Workspace 的 Session；跨 Workspace 使用目标 `--cwd` 重启 Runtime。
- Workspace 按其最新 Session 的 `modifiedAt` 排序，无 Session 时使用加入时间；启动后后台校验。
- 所有已添加 Workspace 都保存在磁盘；侧栏先加载当前、置顶和最近 7 天的 Workspace，旧记录通过“更多”每批加载 50 个。
- 失效 Workspace 保留并标记；手动移除不删除目录和 OMP Session。
- OMP v17.0.6 没有 Session 列表和删除 RPC；列表只读扫描 OMP 现有 JSONL。
- Session 删除使用系统废纸篓，成功后才清理 Desktop 状态，不清理共享 Blob。
- Desktop 配置使用版本化的 `desktop-state.json`，原子替换并迁移现有 `runtime-state.json`。
- Session 搜索当前 Workspace 的标题、用户消息和可见 Assistant 文本，按需扫描并每批返回 50 条。
- 空的新会话不属于正式 Session，不保存、不进列表、不跨切换或重启恢复。
- Session 标题不调用模型生成；没有 OMP 标题时使用首条用户消息第一行并写回 OMP。
- 保留可恢复的 Session 归档；归档不是删除，默认折叠且与置顶互斥。
- Workspace 和 Session 列表使用扁平倒序，不显示日期分组标题或 Session 行右侧时间。
- Session v1、v2、v3 只读兼容；损坏和未来版本隔离显示，升级 OMP 时补真实 fixture。
- Workspace 和 Session 都使用右键菜单置顶，菜单项随当前状态变化。
- `@` 使用当前 Workspace 内的单层分块候选和按需搜索，不建立常驻全量索引。
- `@file`、`@folder` 只发送路径并复用 OMP 读取能力；`@session` 使用只读 Host URI 按需分页读取。
- 引用不设固定数量上限，失效项不阻塞其他文字，Workspace 外符号链接不能引用。
- 正式 Session 草稿保存文字和 `@` 引用描述；单项最多 256 KiB、合计最多 2 MiB、30 天过期，附件不跨重启恢复。
