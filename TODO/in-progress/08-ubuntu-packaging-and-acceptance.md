# MVP-08：Ubuntu 打包与 MVP 验收

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-02、MVP-03、MVP-04、MVP-05、MVP-06、MVP-07
- 后续任务：无

## 目标

生成可安装、可回归、可交付的 Ubuntu MVP，并确认没有超出既定范围。

## 明确不做

- 不在首个安装包中加入 macOS、Windows 二进制。
- 不加入 Browser Use、Computer Use、多窗口和插件市场。
- 不为追求单一体积数字破坏启动速度和稳定性。
- 不关闭 GPU 作为 Linux 默认方案。

## 任务清单

### 打包

- [ ] 使用 `electron-builder` 配置 Linux 构建。
- [ ] 首先产出 AppImage。
- [ ] 根据实际分发需求再增加 deb。
- [ ] 只打包当前平台和架构的 `runtime/omp`。
- [ ] 确保 OMP 二进制具有执行权限。
- [ ] 生产包排除测试、开发依赖、无用 source map 和参考仓库。
- [ ] Main、Preload 和 Renderer 分别 bundle。
- [ ] 使用 ASAR 管理应用代码，并正确解包原生依赖和 OMP。

### Ubuntu 兼容

- [ ] 在 Ubuntu Wayland 测试启动、窗口、剪贴板和文件选择器。
- [ ] 在 Ubuntu X11 测试同一组主链路。
- [ ] 测试 Intel、AMD 和 NVIDIA 常见图形环境。
- [ ] GPU 默认开启。
- [ ] 提供可选兼容模式，不作为默认值。
- [ ] 测试从图形启动器启动时的 Runtime PATH、Network Profile 和 OMP 发现。

### 性能回归

- [ ] 记录 `process_start` 到 `first_paint`。
- [ ] 记录 OMP `ready` 时间。
- [ ] 记录首 token 延迟。
- [ ] 记录首屏 Renderer JS gzip 大小。
- [ ] 记录空闲 CPU 和内存。
- [ ] 记录安装包和解压后大小。
- [ ] CI 保存指标并显示相对上一版本的变化。

### 初始预算

- [ ] 空闲 CPU 小于 1%。
- [ ] 主线程单次任务小于 50 ms。
- [ ] 首屏 Renderer JS 小于 700 KB gzip。
- [ ] 空闲内存不超过空 Electron 基线加 80 MB。
- [ ] 应用增量不超过空 Electron、OMP 二进制之外的 25 MB。
- [ ] 超出预算时记录原因，不允许静默忽略。

### 自动化检查

- [x] CI 执行类型检查。
- [x] CI 执行单元测试。
- [x] GitHub Hosted Runner 覆盖 Ubuntu 22.04、24.04 的 x64、arm64。
- [x] 每个平台和架构分别运行 Xvfb X11 与 Weston headless Wayland smoke，并保存截图和诊断日志；headless Wayland 使用软件渲染并在成功标记后受控终止，不替代真实 GPU 和优雅退出验收。
- [ ] CI 执行 RPC smoke test，无法提供真实凭据时使用明确的测试模式。
- [ ] CI 构建 Linux 安装包。
- [ ] CI 检查打包产物中是否包含错误平台二进制或开发文件。
- [ ] CI 记录构建产物大小。

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

## 完成条件

- [ ] Ubuntu AppImage 可以安装或直接运行。
- [ ] 核心聊天、本地文件、Session、Runtime 环境和 Runtime 网络主链路通过。
- [ ] CI 检查全部通过。
- [ ] 性能指标已记录，超预算项有明确处理结论。
- [ ] 安装包不包含 Browser Use、Computer Use 和无关平台资源。
- [ ] 已知问题写入发布说明。
- [ ] MVP 标签和 Release 只在用户明确授权后创建。

## 发布记录

- 测试 Ubuntu 版本：未填写
- Wayland 结果：未填写
- X11 结果：未填写
- AppImage 大小：未填写
- 空闲内存：未填写
- OMP ready 时间：未填写
- 首 token 延迟：未填写
- 已知问题：未填写
