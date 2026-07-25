# MVP-09：OMP Runtime 环境与网络

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-08
- 后续任务：MVP-10

## 目标

让 Desktop 自动恢复用户终端中的 Runtime 环境，并允许用户在输入框工具栏中控制 OMP Runtime 及 RPC Bash 使用的代理，不依赖独立 Settings 页面。

## 固定方案

- Electron Main 自动探测 Login Shell 环境，失败时退回 Electron 启动环境。
- 全局 Runtime Network 配置独立管理关闭、自动和手动三种代理模式。
- Electron Main 合并普通环境和网络规则，并通过 `spawn` 的 `env` 传入 OMP Runtime。
- RPC Bash 由 OMP Runtime 执行，其子进程继承 Runtime 的最终环境。
- 环境或网络变化后重启 OMP Runtime，并恢复当前 Session。
- 详细交互和范围决策见 `decision/09-runtime-environment-and-network.md`。

## 明确不做

- 不默认继承一个不存在的图形启动终端环境。
- 不在 MVP 中实现内置 Terminal、PTY 或 Chromium Session 代理。
- 不为 Electron Main 的任意 Node 请求建立泛化代理层。
- 不实现独立 Settings 页面或完整 Environment Profile 编辑器。
- 不支持代理认证、SOCKS5、远程代理地址或端口扫描。
- 不控制 Provider 登录使用的系统默认浏览器网络。
- 不保存代理密码和模型密钥。

## 任务清单

### Runtime 环境

- [ ] 从用户 Login Shell 读取完整环境，覆盖从图形入口启动时缺失的 PATH 和普通变量。
- [ ] Shell 探测超时或失败时退回 Electron 启动环境，并记录不含变量值的诊断。
- [ ] 环境来源和网络规则分开解析。
- [ ] 界面可以查看脱敏后的最终环境诊断。

### 环境检测

- [ ] 检测 `omp`、`git`、`node` 和 `python`。
- [ ] 显示 PATH。
- [ ] 显示当前 Shell 和工作目录。
- [ ] 诊断和复制结果只输出 Shell、PATH、Workspace、工具路径与版本、网络模式和脱敏代理来源。
- [ ] 环境异常给出具体错误和重新检测入口。

### Runtime Network Profile

- [ ] 在输入框顶部增加与模型、推理强度和权限同级的代理控件。
- [ ] 工具栏文案使用“代理：关闭 / 自动 / 手动”。
- [ ] 点击手动后，在同一 Popover 中进入二级配置面板。
- [ ] 手动面板只接受本地 HTTP 代理端口，并生成 `http://127.0.0.1:<端口>`。
- [ ] 端口不提供默认值、不扫描，取值范围为 `1–65535`。
- [ ] 自动模式只重新探测 Login Shell；未检测到代理时不注入并正常启动。
- [ ] 自动模式只检测到 SOCKS 代理时不注入，并提示改用本地 HTTP 入站。
- [ ] 自动模式允许临时继承带认证的 HTTP 代理，但不保存、不显示凭据。
- [ ] 手动模式生成 `PI_PROXY` 以及大小写的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 NO_PROXY。
- [ ] 代理模式始终绕过 `localhost`、`127.0.0.1` 和 `::1`，界面不暴露 Bypass 配置。
- [ ] 不注入模式从最终 `env` 中显式移除 OMP 专用变量和所有大小写代理变量。
- [ ] 工具栏按钮只显示当前模式；一级菜单展示本次解析来源、结果和错误。
- [ ] 一级菜单底部提供只读环境诊断入口。
- [ ] 全局保存网络模式和手动端口，切换 Workspace 后继续使用。
- [ ] 离开手动模式后保留上次端口；关闭 Popover 时丢弃未应用草稿。
- [ ] VPN 状态变化后由用户主动重新检测，不做后台轮询。
- [ ] Agent 运行、存在 Follow-up 或 Provider 登录期间禁用代理控件。
- [ ] Runtime 失败或停止时仍可修改代理，用于恢复。
- [ ] 没有 Workspace 时允许保存配置，下次 Runtime 启动时应用。
- [ ] 用户点击“应用并重启”后保存草稿、重启 OMP Runtime 并恢复当前 Session。
- [ ] 应用后 Runtime 启动失败时保留新配置，不自动回退到直连。

### 测试与诊断

- [ ] 测试 OMP 模型接口连通性。
- [ ] 通过 RPC `bash` 验证 PATH、普通环境变量和代理变量确实继承。
- [ ] 通过 RPC `bash` 测试 `git`、`curl` 或等价命令的网络访问。
- [ ] 测试不注入代理时不会意外继承 Desktop 或 Login Shell 的代理变量。
- [ ] 测试端口格式、范围和不可达状态。
- [ ] 端口检测可选，检测失败不阻止保存合法端口。
- [ ] 测试固定回环地址绕过规则。
- [ ] 测试敏感字段不会写入日志。

## 完成条件

- [ ] OMP Runtime 使用探测到的 PATH、普通环境变量、代理和 Workspace。
- [ ] RPC Bash 执行的命令继承 OMP Runtime 的最终环境。
- [ ] 从桌面启动应用时可以找到 Login Shell 中的开发工具。
- [ ] VPN 提供本地 HTTP 入站时，OMP 内部授权 API、模型请求和 RPC Bash 命令都能按配置联网。
- [ ] Provider 授权网页继续使用系统默认浏览器及其自身网络配置。
- [ ] 不注入代理模式下，OMP Runtime 和 RPC Bash 不携带代理环境变量。
- [ ] 环境检测可以定位常见 PATH 和代理问题。
- [ ] 环境和代理变量不会以未脱敏形式写入日志或复制结果。

## 复用重点

- Node.js `child_process.spawn`：为 OMP Runtime 传入独立 `env`。
- OpenCode Desktop `shell-env.ts`：Login Shell 探测、超时和 NUL 分隔环境解析。
