# MVP-03：模型授权、Provider 与模型选择

- 状态：已完成
- 优先级：P0
- 前置任务：MVP-02
- 后续任务：MVP-04、MVP-08

## 2026-07-22 执行记录

- 已实现 Main、Preload 和 Renderer 的 Provider 列表、RPC 登录、模型选择与 Thinking Level 选择。
- 已实现登录输入遮挡、授权 URL 仅保留在 Main、取消登录、输入超时、Renderer 重载恢复未回答步骤和模型最小字段投影。
- 已实现运行中暂存“下次使用”、Stop/正常结束/崩溃恢复后应用，以及当前模型失效时阻止发送并打开模型选择器。
- fake OMP 已覆盖模型目录、Provider 目录、Extension UI 登录输入和零模型启动。
- `pnpm check` 通过，共 8 个测试文件、57 个测试；`pnpm build` 通过；使用 `ELECTRON_DISABLE_SANDBOX=1 pnpm smoke` 通过。
- 实际 OMP RPC 只读检查通过：`get_login_providers` 返回 57 项，`get_available_models` 返回 19 项，响应外层结构与当前实现一致。
- 真实 Provider 人工验收已完成：`openai-codex` 和 `perplexity` 均由 OMP RPC 报告为已授权；Desktop 登录、授权持久化和后续复用正常。
- 登录、模型、Thinking、Session 恢复、Renderer 重载和凭据脱敏专项测试均已补齐。

## 目标

复用 OMP RPC、`AuthStorage` 和 `ModelRegistry`，让用户在 Desktop 中完成 Provider 登录、模型选择和 Thinking Level 选择，再进入真实聊天闭环。

## 固定方案

- Electron Main 持有授权和模型相关 RPC 能力，Renderer 只通过类型明确的 Preload API 调用。
- 模型选择器和 Provider 登录弹窗使用 Radix Dialog、Radix Popover 和 `cmdk`，样式继续使用现有 Tailwind。
- Desktop 不实现 OAuth、Token 刷新、Provider 协议或模型发现。
- OAuth 和 API Key 登录统一复用 OMP `login(providerId)` 流程。
- MVP 不修改或自建 OMP 二进制；假定用户已在 Desktop 之外配置好 OMP。
- 首次外部配置完成且 Runtime 可以正常启动后，Desktop 仍允许通过 `login(providerId)` 添加其他 Provider。
- OMP 在当前用户的 `~/.omp` 中持久化凭据；Desktop 复用授权但不读取该目录，只在 OMP 判定凭据失效时要求重新登录。
- 登录凭据只由 OMP `AuthStorage` 保存；Desktop 不读取 OMP 数据库，也不保存 Token 副本。
- 模型使用 `provider + modelId` 唯一标识，不只使用模型名称。
- Thinking Level 直接使用模型返回的 `thinking.efforts` 和 `defaultLevel`，不硬编码固定档位。
- Model 和 Thinking Level 是相邻的独立控件，Thinking Level 选项始终由当前或待切换模型决定，不使用模型与强度矩阵。

## 明确不做

- 不在 Electron 中实现 OAuth 或自行刷新 Token。
- 不读取、修改或复制 OMP SQLite 凭据数据库。
- 不维护 Desktop 自有 Provider 或模型目录。
- 不实现 Runtime 当前没有暴露的完整多账号管理。
- 不在本任务实现代理和 Runtime Environment Profile；MVP-07 负责环境与网络。

## 任务清单

### 首次授权启动

- [x] OMP 在 `ready` 前退出且 stderr 精确包含 `No models available.` 时，提示“OMP 尚未配置”，不在 Desktop 内启动或指导 TUI 登录；其他启动错误不做此推断。
- [x] 用户在 Desktop 之外完成 OMP 配置后，允许重启 Runtime 并重新检查可用模型。
- [x] 无授权、无模型和其他初始化失败使用不同的结构化状态与提示。

### Provider 与登录

- [x] 每次打开“添加 Provider”弹窗时，通过 `get_login_providers` 重新获取并显示 OMP 返回的全部 Provider，不维护 Desktop 允许列表。
- [x] Provider 列表可搜索名称和 Provider ID，并保持 OMP 返回顺序；不自行维护 OAuth、API Key 或本地模型分类。
- [x] `available: false` 的 Provider 仍显示，但禁用登录并标注“当前不可用”；Desktop 不自行探测或修改 `available`。
- [x] Provider 页面不显示可能受 `storeCredentialsAs` 误判影响的“已登录/未登录”徽标；是否可用以模型列表为准。
- [x] 通过 `login(providerId)` 发起 OAuth 或 API Key 登录，不建立第二套 API Key 表单和存储。
- [x] 将 `open_url` 请求交给 Main 校验后自动使用系统浏览器打开；弹窗只显示状态和“重新打开”，不显示或记录完整授权 URL。打开失败时保持登录等待，显示“无法打开浏览器”、重试和取消。
- [x] 将授权过程中的 `input`、进度、取消、超时和错误映射到 Desktop UI；所有登录输入默认隐藏，允许临时显示，并在提交、取消或失败后立即清空。
- [x] `open_url.instructions` 作为长度受限的纯文本显示，不解析 Markdown，不允许其中链接点击。
- [x] 登录弹窗只显示最新一条脱敏进度，不展示历史时间线；登录进行中按 Esc、点击遮罩或关闭弹窗都执行同一取消流程。
- [x] 对 RPC 不支持的交互式 Provider 明确提示需要使用 OMP TUI 登录，不伪装成可用。
- [x] 同一时间只允许一个 Provider 登录，并且只能在 Runtime 空闲时发起；登录期间允许用户取消。
- [x] 取消登录后等待 OMP 结束请求；5 秒内未结束则重启 Runtime，并恢复原 Workspace 和 Session。
- [x] Desktop 不设登录总超时；只遵守 OMP 交互事件自带的超时，没有事件超时时等待用户取消。
- [x] 登录成功后重新获取 Provider 状态和可用模型；不维护 `storeCredentialsAs` 别名映射，不按登录 Provider ID 过滤，而是打开完整模型选择器由用户选择。
- [x] 登录成功后模型列表没有新增项仍视为成功，不额外报错。
- [x] 已知登录错误区分已取消、输入超时、需要 OMP Terminal 和授权失败；未知错误脱敏并限制长度，详细脱敏信息写入 Runtime 日志。

### 模型与 Thinking

- [x] Runtime `ready` 后同时获取 Provider 列表和可用模型，不维护本地模型目录；打开“添加 Provider”弹窗时再刷新 Provider 列表。
- [x] 模型选择器使用 `provider + modelId`，按 Provider 分组并保持 OMP 返回顺序；能匹配到 OMP Provider 名称时显示“名称 + Provider ID”，否则只显示 Provider ID。
- [x] 模型名称为主文字，`modelId` 始终作为辅助文字。
- [x] 模型搜索同时匹配 Provider 名称、Provider ID、模型名称和 `modelId`。
- [x] 重新获取模型列表失败时，保留本次应用运行期间最后一次成功的内存列表，显示“刷新失败”和“重试”，不写入磁盘。
- [x] 通过 `set_model` 切换模型；当前模型失效、授权失效或刷新后消失时，阻止发送并打开模型选择器，不自动切换或静默 fallback。
- [x] 根据所选模型的 `reasoning` 和 `thinking` 元数据决定是否显示 Thinking Level 控件。
- [x] Model 和 Thinking Level 使用两个相邻的独立下拉框；只显示所选模型实际支持的 `thinking.efforts`。
- [x] 切换模型时，有 `thinking.defaultLevel` 就使用它，否则使用 `thinking.efforts` 第一项；用户仍可手动选择其他受支持档位。
- [x] Thinking Level 已知值显示中文名称：“最低、低、中、高、超高、最高”；未知值原样显示，可用档位仍完全以 OMP 元数据为准。
- [x] `get_state` 返回的当前 Thinking Level 不在最新 `thinking.efforts` 中时，显示实际值和“当前档位已不受支持”；不阻止发送，不自动修改。
- [x] Agent 运行期间允许选择待切换的 `provider + modelId + thinkingLevel`，但不立即发送 RPC；当前回复和全部 Follow-up 结束后再按模型、Thinking Level 的顺序应用，用于下一次手动发送。
- [x] 模型切换成功但 Thinking Level 设置失败时，不回滚模型；通过 `get_state` 恢复 OMP 真实状态并提示用户重新选择。
- [x] Runtime 空闲时选择模型立即调用 `set_model`；失败时通过 `get_state` 恢复原状态，不增加“应用”按钮。
- [x] Runtime 空闲时手动修改 Thinking Level 立即调用 `set_thinking_level`；失败时通过 `get_state` 恢复实际值。
- [x] 模型和 Thinking Level 按 Session 管理；应用恢复和 Session 切换后以 OMP `get_state` 为准恢复当前值。
- [x] 新建 Session 后完全以 OMP `get_state` 返回的模型和 Thinking Level 为准，Desktop 不复制旧 Session 配置。
- [x] 运行期间存在待切换配置时，用户确认切换 Session 后，先停止旧 Session 执行链，再应用待切换配置，最后进入新 Session；配置应用失败仍继续切换并显示提示。
- [x] 运行期间存在待切换配置时，Stop、Runtime 崩溃恢复或用户确认切换 Workspace 都先在恢复的原 Session 上尝试应用该配置；Workspace 切换时应用后再关闭旧 Runtime。

### Preload 与 UI

- [x] Preload 提供类型明确的 Provider 列表、登录、模型列表、模型选择和 Thinking 设置接口，不暴露通用 RPC。
- [x] Main 将 OMP 模型对象投影为 Renderer 所需的最小字段：`provider`、`id`、`name`、`reasoning`、`thinking.efforts` 和可选 `thinking.defaultLevel`，不传递完整模型对象。
- [x] “添加 Provider”入口放在模型下拉框底部，打开 Provider 登录弹窗；不新增独立工具栏按钮或 Settings 页面。
- [x] Provider 登录使用居中模态弹窗：先选 Provider，再在同一弹窗内显示浏览器授权、输入、进度和错误，不把多步登录塞入模型下拉框。
- [x] Provider 登录成功后关闭登录弹窗并打开完整模型选择器；用户直接关闭选择器时保持当前模型，不影响已保存的 Provider 授权。
- [x] 当前模型不支持手动调节 Thinking Level 时保留控件位置并禁用：非推理模型显示“不支持”，会推理但不能调档的模型显示“自动”。
- [x] Agent 运行期间底部控件显示用户最后一次选择的待切换模型和 Thinking Level，并标注“下次使用”；只保留最后一次选择，同时提供“取消下次切换”。
- [x] Provider 登录期间 Renderer 重载时保持 OMP 登录请求；Renderer 恢复后重新显示未回答步骤，但不恢复任何已输入内容。
- [x] 提供首次使用、未授权、登录中、登录失败、无模型和已就绪状态。
- [x] 登录等待期间允许用户取消，不阻塞 Renderer 其他安全操作。
- [x] 授权错误不显示 Token、API Key、回调凭据或完整敏感 URL。

### 测试

- [x] 测试零凭据启动时会提示“OMP 尚未配置”，不会误报为普通 Runtime 崩溃。
- [x] 测试 Provider 列表不展示登录徽标，并以可用模型列表判断授权是否生效。
- [x] CI 使用 Fake OMP 测试浏览器 OAuth、手动输入、API Key、取消、超时和登录失败，不使用真实凭据。
- [x] 发布前人工验证当时可用的一个 OAuth Provider 和一个 API Key Provider；本次实际 Provider ID 为 `openai-codex` 和 `perplexity`。
- [x] 测试登录成功后打开完整模型选择器，以及模型列表未变化时仍判定登录成功。
- [x] 测试模型搜索、Provider 分组、OMP 顺序保持和 `modelId` 显示。
- [x] 测试不同模型的 Thinking Level 显示、设置和不支持状态。
- [x] 测试无 `thinking.defaultLevel` 时使用 `thinking.efforts` 第一项，以及非推理模型和不可调档模型的禁用文案。
- [x] 测试 Thinking Level 中文标签、未知值回退和已不受支持档位的非阻断警告。
- [x] 测试登录说明纯文本显示、最新进度、浏览器打开失败重试，以及 Esc、遮罩和关闭按钮取消。
- [x] 测试当前模型失效时阻止发送，以及模型已切换但 Thinking Level 设置失败时的真实状态恢复。
- [x] 测试按 Session 恢复模型与 Thinking Level、Session 切换前应用待切换配置，以及授权失效后的降级状态。
- [x] 测试待切换标记、最后一次选择覆盖、取消待切换，以及正常结束、Stop、Runtime 崩溃和 Workspace 切换后的应用。
- [x] 测试 Renderer 重载后恢复未完成登录步骤，但不恢复登录输入内容。
- [x] 测试日志、IPC 错误和 Renderer 状态不泄露凭据。

## 完成条件

- [x] 没有可用模型凭据时，Desktop 显示“OMP 尚未配置”，不负责首次授权。
- [x] OAuth 或 API Key 凭据由 OMP 保存，Desktop 不保存或读取 Token。
- [x] 登录成功后可以获取可用模型并选择 `provider + modelId`。
- [x] Thinking Level 只显示和设置当前模型实际支持的档位。
- [x] 无授权、登录失败、无模型和授权失效都有明确且可恢复的状态。
- [x] 授权、模型选择和关键安全测试通过。

## 参考

- `docs/模型权限.md`
- `docs/OMP_RPC.md`
- Oh My Pi `packages/coding-agent/src/modes/rpc/`
- Oh My Pi `packages/coding-agent/src/config/model-registry.ts`
