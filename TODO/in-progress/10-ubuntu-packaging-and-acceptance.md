# MVP-10：Ubuntu 打包与 MVP 验收

- 状态：进行中
- 优先级：P0
- 前置任务：MVP-09
- 后续任务：无

## 目标

生成可安装、可回归、可交付的 Ubuntu MVP，并确认没有超出既定范围。

## 已确认方案

- 必须产出 x64 AppImage 和 x64 `.deb`；arm64 不发布安装包。
- 安装包使用上游 OMP `v17.1.0` 的 x64 二进制，并校验 SHA-256。
- 正式支持 Ubuntu 22.04、24.04 x64；arm64 只保留 Electron 界面 CI smoke。
- AppImage 直接运行验收；`.deb` 使用 `apt install ./包名.deb` 验收安装、启动器、卸载和重装。
- CD 通过唯一的 `release_version` 参数手动触发，生成 Draft Release；公开发布仍需人工确认。
- Debian 包名为 `omp-desktop`，Electron `appId` 为 `com.omp.desktop`。
- 每个安装包生成 SHA-256 校验文件；MVP 暂不做数字签名或应用内自动更新。
- bundled OMP 位于 ASAR 外的 `resources/runtime/omp`，只随 Desktop Release 升级。
- 升级和卸载保留用户数据；正式图标使用 `resources/icons/omp-desktop.png`。
- CI GPU smoke 不替代 x64 真实 GPU 验收；arm64 只保留界面兼容性 smoke。
- GitHub Hosted CI 通过即可合并；CD 必须先在本机 NVIDIA RTX 3090 + 原生 Wayland self-hosted runner 上完成与当前 commit 绑定的真实 GPU 验收。
- 本机验收通过后，由 GitHub x64 Hosted Runner 构建安装包；人工签收方式必须写入项目文档。
- Draft Release 使用 `v<release_version>`，人工 Publish 时才创建 Tag；Release Notes 由 CD 生成后人工检查。
- 项目使用 MIT License，并在安装包中保留项目和第三方许可证。
- `runtime/manifest.json` 固定 OMP 版本、x64 下载地址和 SHA-256。
- CI 同时运行 fake 和真实 OMP RPC smoke；本机真实模型验收固定使用 `openai-codex/gpt-5.4-mini` + `medium`。
- 生产包不关闭 Chromium sandbox；安装和首次启动不下载应用组件。
- MVP 不注册文件关联或自定义 URL 协议；命令行支持普通启动、`--version`、`--disable-gpu` 和 `--setup-provider`。
- 首个 Release 版本为 `0.1.0`，只正式支持 Ubuntu 22.04、24.04 x64。
- CD 在临时工作区注入稳定 SemVer 版本，不提交版本修改；不正式支持降级。
- 新建 README，并产出 Ubuntu 安装、发布验收和发布流程三份操作文档。
- 应用图标生成 Linux 多尺寸 PNG；25 MB 增量预算排除 Electron 和 bundled OMP。
- Runtime 默认倾向于 Renderer ready 后启动；空闲 CPU 在稳定 60 秒后连续测量 60 秒。
- 内存使用 PSS；首 token 分别记录首事件和首段可见文本；真实 CD 网络验收必须使用 Runtime 手动代理。
- fake Runtime 压力测试运行 30 分钟且不调用真实模型 API；日志队列上限为 1 MiB，应用整体退出上限为 10 秒。
- 详细决策见 `decision/10-ubuntu-packaging-and-acceptance.md`。

## 明确不做

- 不在首个安装包中加入 macOS、Windows 二进制。
- 不加入 Browser Use、Computer Use、多窗口和插件市场。
- 不为追求单一体积数字破坏启动速度和稳定性。
- 不关闭 GPU 作为 Linux 默认方案。

## 任务清单

### 打包

- [x] 使用 `electron-builder` 配置 Linux 构建。
- [x] 首先产出 AppImage。
- [x] 同时产出 `.deb`。
- [x] 只打包 Linux x64 的 `runtime/omp`。
- [x] 确保 OMP 二进制具有执行权限。
- [x] 实现 `omp-desktop --setup-provider`，在当前终端启动 bundled OMP TUI，并使用全新临时 OMP Profile 验证首次 Provider 配置。
- [x] 生产包排除测试、开发依赖、无用 source map 和参考仓库。
- [x] Main、Preload 和 Renderer 分别 bundle。
- [x] 使用 ASAR 管理应用代码，并正确解包原生依赖和 OMP。
- [x] 检查首屏 chunk 组成，确认模型管理、Markdown 高亮和后续大型能力没有意外进入首屏。

### Ubuntu 兼容

- [ ] 在 Ubuntu Wayland 测试启动、窗口、剪贴板和文件选择器。
- [ ] 在 Ubuntu X11 测试同一组主链路。
- [ ] 测试 Intel、AMD 和 NVIDIA 常见图形环境。
- [x] GPU 默认开启。
- [ ] 提供重启后生效的图形兼容模式，不作为默认值。
- [x] 支持 `--disable-gpu` 作为黑屏时不依赖设置界面的救援入口。
- [ ] 记录显示协议、兼容模式、GPU Feature Status 和 GPU 进程异常。
- [ ] 在真实 GPU 上测试长对话滚动、流式输出、弹窗、缩放、黑屏、闪烁和透明窗口；Headless 软件渲染结果不代替该项。
- [x] 增加与当前 commit、版本和本机环境绑定的 `gpu-acceptance.json` 生成与校验脚本。
- [x] 在 `docs/` 中记录真实 GPU 人工签收清单、操作步骤和失败处理。
- [x] CD 在本机原生 Wayland、RTX 3090 和硬件加速检查通过后才允许进入 Hosted Runner 构建阶段。
- [ ] 测试从图形启动器启动时的 Runtime PATH、Network Profile 和 OMP 发现。

### 性能回归

- [ ] 记录 `process_start` 到 `first_paint`。
- [ ] 记录 `interactive_ready` 和 `runtime_start`。
- [ ] 记录 OMP `ready` 时间。
- [ ] 记录首 token 延迟。
- [x] 记录首屏 Renderer JS gzip 大小。
- [ ] 记录空闲 CPU 和内存。
- [x] 记录安装包和解压后大小。
- [x] 分别记录排除 Electron、bundled OMP 后的应用增量，以及完整安装包和安装后大小。
- [ ] 对比“创建窗口后立即启动 OMP”和“`renderer_ready` 后启动 OMP”的首屏、OMP ready、峰值 CPU 和内存，固定默认策略。
- [ ] 冷启动和热启动分开测量，多次运行记录中位数。
- [ ] 分别记录 Main、Renderer、GPU/Utility 和 OMP Runtime 的内存。
- [ ] 分别记录流式开始、持续输出、结束和恢复空闲后的内存。
- [ ] 使用 PSS 测量空 Electron、Desktop 各进程和 bundled OMP，稳定 60 秒后连续采样 60 秒。
- [ ] 分别记录 `prompt_to_first_event` 和 `prompt_to_first_visible_text`，固定模型与 Prompt 运行 5 次。
- [ ] CI 保存指标并显示相对上一版本的变化。

### 稳定性与资源边界

- [x] Runtime 日志写入队列设置待写字节上限，过载时丢弃并记录汇总，不让内存无界增长。
- [x] 应用退出等待日志写入使用有限超时，不因日志积压无限阻塞。
- [ ] 长 Session、高频 Tool 输出和 stderr 洪泛压力测试不会导致持续内存增长或主线程长时间阻塞。
- [x] 日志待写队列上限为 1 MiB，单条最多 4 KiB，磁盘保留 3×5 MB；队列恢复后写入丢弃汇总。
- [ ] 使用 fake Runtime 连续压力测试 30 分钟，产生至少 10,000 个流事件、1,000 次 Tool 更新和 100 MB stderr，不调用真实模型 API。
- [ ] 应用整体退出不超过 10 秒，日志最多等待 2 秒，并确认没有遗留 OMP 进程组。

### 初始预算

- [ ] 空闲 CPU 小于 1%。
- [ ] 主线程单次任务小于 50 ms。
- [x] 首屏 Renderer JS 小于 700 KB gzip。
- [ ] 空闲内存不超过空 Electron 基线加 80 MB。
- [x] 应用增量不超过空 Electron、OMP 二进制之外的 25 MB。
- [ ] 超出预算时记录原因，不允许静默忽略。
- [ ] Renderer JS、空闲 CPU、主线程长任务或持续内存增长超过阻断门槛时停止发布；其他例外必须由用户人工批准。
- [ ] 空闲 CPU 在 Runtime ready 后静置 60 秒，再连续采样 60 秒并统计进程组平均值和峰值。

### 自动化检查

- [x] CI 执行类型检查。
- [x] CI 执行单元测试。
- [x] GitHub Hosted Runner 覆盖 Ubuntu 22.04、24.04 的 x64、arm64。
- [x] 每个平台和架构分别运行 Xvfb X11 与 Weston headless Wayland smoke，并保存截图和诊断日志；headless Wayland 使用软件渲染并在成功标记后受控终止，不替代真实 GPU 和优雅退出验收。
- [x] CI 执行 RPC smoke test，无法提供真实凭据时使用明确的测试模式。
- [x] CI 使用真实 OMP 执行不需要模型凭据的 `ready` 和 `get_state` smoke。
- [x] CI 构建 x64 AppImage 和 x64 `.deb`。
- [x] CI 检查打包产物中是否包含错误平台二进制或开发文件。
- [x] CI 记录构建产物大小。
- [x] CI 记录 Renderer 各 chunk 的原始大小和 gzip 大小。

### 人工验收主链路

- [ ] 安装并启动应用。
- [ ] 选择 Workspace。
- [ ] OMP 成功进入 ready。
- [ ] 新建 Session 并发送 Prompt。
- [ ] 查看流式文本、Thinking 和 Tool Call。
- [ ] 测试鼠标 Stop、`Ctrl+C`、逐条 Follow-up、队列清空和 Permission。
- [ ] 切换 Session 并恢复历史。
- [ ] 浏览和搜索文件，将文件或目录加入上下文，并用 `Ctrl+点击` 在系统文件管理器中定位。
- [ ] 在不开启系统全局代理和 TUN 的条件下，配置 Runtime 手动代理并测试模型请求。
- [ ] 通过 RPC `bash` 验证命令继承 Runtime 的 PATH、普通环境变量和代理变量。
- [ ] 切换为不使用代理，重启 Runtime 后确认代理变量已移除。
- [ ] 重启应用并恢复 Workspace、Session 和设置。
- [ ] 退出后确认没有遗留 OMP 进程。
- [ ] 在一次性测试 Workspace 中使用 `openai-codex/gpt-5.4-mini` 和 `medium` 完成固定 Prompt 验收。
- [ ] 真实 CD 验收使用隔离配置和 Runtime 手动 HTTP 代理，完成后切换为不使用代理并确认代理变量清除。

## 完成条件

- [ ] Ubuntu AppImage 可以安装或直接运行。
- [ ] 核心聊天、本地文件、Session、Runtime 环境和 Runtime 网络主链路通过。
- [ ] CI 检查全部通过。
- [ ] 性能指标已记录，超预算项有明确处理结论。
- [ ] 安装包不包含 Browser Use、Computer Use 和无关平台资源。
- [ ] 已知问题写入发布说明。
- [ ] 不存在数据丢失、秘密泄露、核心主链路失败、无法救援的 GPU 黑屏、遗留进程、持续资源增长或错误打包资源等发布阻断问题。
- [ ] MVP 标签和 Release 只在用户明确授权后创建。

## 发布记录

- 测试 Ubuntu 版本：未填写
- Wayland 结果：未填写
- X11 结果：未填写
- 真实 GPU 结果：未填写
- 图形兼容模式结果：未填写
- AppImage 大小：211,309,029 bytes（本地构建，尚未完成 Ubuntu/FUSE 人工直跑验收）
- `.deb` 大小：176,347,304 bytes；安装后 Installed-Size 约 455 MiB
- 应用增量：`app.asar` 2,147,041 bytes（排除 Electron 和 bundled OMP）
- 首屏 Renderer JS gzip：353,524 bytes
- 空闲内存：未填写
- OMP ready 时间：未填写
- 首 token 延迟：未填写
- 已知问题：当前开发机未安装 `libfuse.so.2`，AppImage 直跑尚未验收；解包目录不能代替安装后的 sandbox/AppArmor 环境。
