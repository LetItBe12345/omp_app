# MVP-03：模型授权、Provider 与模型选择

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-02
- 后续任务：MVP-04、MVP-08

## 目标

复用 OMP RPC、`AuthStorage` 和 `ModelRegistry`，让用户在 Desktop 中完成 Provider 登录、模型选择和 Thinking Level 选择，再进入真实聊天闭环。

## 固定方案

- Electron Main 持有授权和模型相关 RPC 能力，Renderer 只通过类型明确的 Preload API 调用。
- Desktop 不实现 OAuth、Token 刷新、Provider 协议或模型发现。
- OAuth 和 API Key 登录统一复用 OMP `login(providerId)` 流程。
- 登录凭据只由 OMP `AuthStorage` 保存；Desktop 不读取 OMP 数据库，也不保存 Token 副本。
- 模型使用 `provider + modelId` 唯一标识，不只使用模型名称。
- Thinking Level 直接使用模型返回的 `thinking.efforts` 和 `defaultLevel`，不硬编码固定档位。

## 明确不做

- 不在 Electron 中实现 OAuth 或自行刷新 Token。
- 不读取、修改或复制 OMP SQLite 凭据数据库。
- 不维护 Desktop 自有 Provider 或模型目录。
- 不实现 Runtime 当前没有暴露的完整多账号管理。
- 不在本任务实现代理和 Runtime Environment Profile；MVP-07 负责环境与网络。

## 任务清单

### 首次授权启动

- [ ] 解决无可用模型时 OMP 在进入 RPC 主循环前退出的问题，使首次安装可以进入受限的授权状态。
- [ ] 无授权状态只开放 Provider 登录、模型刷新和诊断所需的最小 RPC 能力，不允许发送 Prompt。
- [ ] 优先通过 OMP 上游的最小 RPC 启动能力解决，不在 Desktop 复制授权实现。
- [ ] 授权成功后刷新 Provider 模型，并让 Runtime 进入可选择模型的状态；需要重启时保持流程连续。
- [ ] 无授权、无模型和初始化失败使用不同的结构化状态与提示。

### Provider 与登录

- [ ] 通过 `get_login_providers` 获取 Provider 名称、可用状态和登录状态。
- [ ] 修复或规避 `storeCredentialsAs` 与 `hasAuth(provider.id)` 不一致导致的登录状态误判。
- [ ] 通过 `login(providerId)` 发起 OAuth 或 API Key 登录，不建立第二套 API Key 表单和存储。
- [ ] 将 `open_url` 请求交给 Main 校验后使用系统浏览器打开。
- [ ] 将授权过程中的 `input`、进度、取消、超时和错误映射到 Desktop UI。
- [ ] 对 RPC 不支持的交互式 Provider 明确提示需要使用 OMP TUI 登录，不伪装成可用。
- [ ] 登录成功后重新获取 Provider 状态和可用模型。

### 模型与 Thinking

- [ ] 通过 `get_available_models` 获取 OMP 当前可用模型，不维护本地模型目录。
- [ ] 模型选择器使用 `provider + modelId`，并显示可区分的 Provider 信息。
- [ ] 通过 `set_model` 切换模型，并处理模型失效、授权失效和刷新后消失。
- [ ] 根据所选模型的 `reasoning` 和 `thinking` 元数据决定是否显示 Thinking Level 控件。
- [ ] 只显示模型实际支持的 `thinking.efforts`，通过 `set_thinking_level` 设置。
- [ ] Agent 运行期间禁用模型和 Thinking Level 切换。
- [ ] 应用和 Session 恢复时以 OMP `get_state` 为准恢复当前模型与 Thinking Level。

### Preload 与 UI

- [ ] Preload 提供类型明确的 Provider 列表、登录、模型列表、模型选择和 Thinking 设置接口，不暴露通用 RPC。
- [ ] 提供首次使用、未授权、登录中、登录失败、无模型和已就绪状态。
- [ ] 登录等待期间允许用户取消，不阻塞 Renderer 其他安全操作。
- [ ] 授权错误不显示 Token、API Key、回调凭据或完整敏感 URL。

### 测试

- [ ] 测试零凭据启动后仍能进入授权流程。
- [ ] 测试 Provider 列表、已登录状态和 `storeCredentialsAs` 映射。
- [ ] 测试浏览器 OAuth、手动输入、API Key、取消、超时和登录失败。
- [ ] 测试登录成功后刷新模型并按 `provider + modelId` 选择。
- [ ] 测试不同模型的 Thinking Level 显示、设置和不支持状态。
- [ ] 测试重启后模型与 Thinking Level 恢复，以及授权失效后的降级状态。
- [ ] 测试日志、IPC 错误和 Renderer 状态不泄露凭据。

## 完成条件

- [ ] 全新安装且没有模型凭据时，可以从 Desktop 发起受支持 Provider 的登录。
- [ ] OAuth 或 API Key 凭据由 OMP 保存，Desktop 不保存或读取 Token。
- [ ] 登录成功后可以获取可用模型并选择 `provider + modelId`。
- [ ] Thinking Level 只显示和设置当前模型实际支持的档位。
- [ ] 无授权、登录失败、无模型和授权失效都有明确且可恢复的状态。
- [ ] 授权、模型选择和关键安全测试通过。

## 参考

- `docs/模型权限.md`
- `docs/OMP_RPC.md`
- Oh My Pi `packages/coding-agent/src/modes/rpc/`
- Oh My Pi `packages/coding-agent/src/config/model-registry.ts`
