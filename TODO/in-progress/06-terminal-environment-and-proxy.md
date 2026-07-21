# MVP-06：Terminal、环境与代理

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-01、MVP-02
- 后续任务：MVP-07

## 目标

让 OMP、内置 Terminal 和联网能力使用同一份可检查、可测试的运行环境。

## 固定方案

- Environment Profile 是环境变量的唯一来源。
- OMP 和 Terminal 使用同一份 Environment Profile。
- 应用代理独立于系统全局代理。
- Terminal 按需创建，关闭后释放 PTY。

## 明确不做

- 不复制完整终端应用。
- 不默认继承一个不存在的图形启动终端环境。
- 不把代理设置只注入 OMP，而忽略 Terminal 和 Chromium Session。
- 不保存代理密码和模型密钥明文。

## 任务清单

### Environment Profile

- [ ] 定义系统环境、Login Shell 和自定义环境三种来源。
- [ ] 支持 Shell 路径配置。
- [ ] 支持 PATH 和自定义环境变量。
- [ ] 支持 Workspace 级覆盖。
- [ ] 合并规则明确，界面可以查看最终结果。
- [ ] 变更后提示重启 OMP 或 Terminal。
- [ ] 敏感字段使用系统安全存储。

### 环境检测

- [ ] 检测 `omp`、`git`、`node` 和 `python`。
- [ ] 显示 PATH。
- [ ] 显示 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 NO_PROXY。
- [ ] 显示当前 Shell 和工作目录。
- [ ] 支持复制诊断结果，但自动隐藏密钥和密码。
- [ ] 环境异常给出具体修复入口。

### 内置 Terminal

- [ ] 使用 `xterm.js` 渲染终端。
- [ ] 使用成熟 PTY 实现，不自行模拟终端协议。
- [ ] Terminal 打开时再创建 PTY。
- [ ] 使用当前 Workspace 作为工作目录。
- [ ] 使用当前 Environment Profile。
- [ ] 支持调整大小、复制、粘贴和清屏。
- [ ] 关闭标签时终止对应 PTY。
- [ ] 应用退出时清理全部 PTY。

### 应用级代理

- [ ] 支持不使用代理、系统代理和手动代理。
- [ ] 手动代理支持 HTTP、HTTPS 和 SOCKS5。
- [ ] 支持 Host、Port、可选认证和 Bypass。
- [ ] 向 OMP 子进程注入代理环境变量。
- [ ] 向 Terminal 注入同一组代理环境变量。
- [ ] 为后续 Browser 使用 Electron Session 代理接口预留适配层。
- [ ] 代理切换后明确哪些进程需要重启。

### 测试与诊断

- [ ] 测试 OMP 模型接口连通性。
- [ ] 测试 GitHub 连通性。
- [ ] 测试 Terminal 中的 `git`、`curl` 或等价命令。
- [ ] 测试代理认证失败和端口不可达。
- [ ] 测试 NO_PROXY / Bypass。
- [ ] 测试应用退出后没有遗留 PTY。
- [ ] 测试敏感字段不会写入日志。

## 完成条件

- [ ] OMP 和 Terminal 使用相同 PATH、代理和 Workspace。
- [ ] 从桌面启动应用时可以找到配置好的开发工具。
- [ ] 不开启系统全局代理也可以通过手动代理联网。
- [ ] 环境检测可以定位常见 PATH 和代理问题。
- [ ] Terminal 关闭后不残留进程。
- [ ] 敏感字段不以明文保存或输出。

## 复用重点

- xterm.js：终端渲染。
- node-pty 或成熟等价实现：PTY 生命周期。
- Electron `safeStorage`：敏感配置。
- Electron Session 代理接口：后续 Browser 复用。
