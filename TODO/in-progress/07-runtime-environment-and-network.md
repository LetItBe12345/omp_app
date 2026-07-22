# MVP-07：OMP Runtime 环境与网络

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-01、MVP-02
- 后续任务：MVP-08

## 目标

让用户在 Desktop 中精确控制 OMP Runtime 以及 RPC Bash 命令使用的环境和代理，不依赖系统全局代理。

## 固定方案

- Runtime Environment Profile 管理 Shell、PATH、普通环境变量和 Workspace。
- Runtime Network Profile 独立管理 OMP Runtime 的代理策略。
- Electron Main 合并两个 Profile，并通过 `spawn` 的 `env` 传入 OMP Runtime。
- RPC Bash 由 OMP Runtime 执行，其子进程继承 Runtime 的最终环境。

## 明确不做

- 不默认继承一个不存在的图形启动终端环境。
- 不在 MVP 中实现内置 Terminal、PTY 或 Chromium Session 代理。
- 不为 Electron Main 的任意 Node 请求建立泛化代理层。
- 不保存代理密码和模型密钥明文。

## 任务清单

### Runtime Environment Profile

- [ ] 定义系统环境、Login Shell 和自定义环境三种来源。
- [ ] 支持 Shell 路径配置。
- [ ] 支持 PATH 和自定义环境变量。
- [ ] 支持 Workspace 级覆盖。
- [ ] 合并规则明确，界面可以查看最终结果。
- [ ] 不将代理模式和代理凭据混入 Runtime Environment Profile。
- [ ] 敏感字段使用系统安全存储。

### 环境检测

- [ ] 检测 `omp`、`git`、`node` 和 `python`。
- [ ] 显示 PATH。
- [ ] 显示当前 Shell 和工作目录。
- [ ] 支持复制诊断结果，但自动隐藏密钥和密码。
- [ ] 环境异常给出具体修复入口。

### Runtime Network Profile

- [ ] 支持不使用代理、系统代理和手动代理。
- [ ] 手动代理支持 HTTP、HTTPS 和 SOCKS5。
- [ ] 支持 Host、Port、可选认证和 Bypass。
- [ ] 手动模式生成大小写的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 NO_PROXY。
- [ ] 不使用代理时，从最终 `env` 中显式移除所有大小写代理变量。
- [ ] 系统代理模式的取值来源和无可用配置时的错误提示明确。
- [ ] 展示最终生成的代理变量，但自动隐藏认证信息。
- [ ] Profile 切换后重启 OMP Runtime，并恢复当前 Session。

### 测试与诊断

- [ ] 测试 OMP 模型接口连通性。
- [ ] 通过 RPC `bash` 验证 PATH、普通环境变量和代理变量确实继承。
- [ ] 通过 RPC `bash` 测试 `git`、`curl` 或等价命令的网络访问。
- [ ] 测试不使用代理时不会意外继承 Desktop 进程的代理变量。
- [ ] 测试代理认证失败和端口不可达。
- [ ] 测试 NO_PROXY / Bypass。
- [ ] 测试敏感字段不会写入日志。

## 完成条件

- [ ] OMP Runtime 使用配置好的 PATH、普通环境变量、代理和 Workspace。
- [ ] RPC Bash 执行的命令继承 OMP Runtime 的最终环境。
- [ ] 从桌面启动应用时可以找到配置好的开发工具。
- [ ] v2rayN 只开启本地 HTTP/SOCKS5 入站时，OMP 模型请求和 RPC Bash 命令都能按配置联网。
- [ ] 不使用代理模式下，OMP Runtime 和 RPC Bash 不携带代理环境变量。
- [ ] 环境检测可以定位常见 PATH 和代理问题。
- [ ] 敏感字段不以明文保存或输出。

## 复用重点

- Electron `safeStorage`：敏感配置。
- Node.js `child_process.spawn`：为 OMP Runtime 传入独立 `env`。
