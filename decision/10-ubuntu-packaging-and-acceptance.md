# 决策记录 10：Ubuntu 打包与 MVP 验收

- 对应任务：`TODO/in-progress/10-ubuntu-packaging-and-acceptance.md`
- 状态：已确认
- 首次确认日期：2026-07-26
- 定稿日期：2026-07-26

## 第一批确认决策

1. MVP-10 必须产出 AppImage 和 `.deb`，不能只产出其中一种。
2. 最初确认两种格式都支持 Linux x64 和 arm64；该范围已由第 47、48 条调整为只发布 x64。
3. OMP 二进制使用上游 `can1357/oh-my-pi` GitHub Release 的 `omp-linux-x64`；最初考虑的 `omp-linux-arm64` 已随第 47、48 条移出发布范围。
4. OMP 版本固定为 `v17.1.0`；下载后校验 SHA-256，升级时显式更新版本和校验值。
5. 最初确认发布 4 个架构专用产物；该范围已由第 47、48 条调整为只发布 x64 AppImage 和 x64 `.deb`。
6. 支持 Ubuntu 22.04 LTS 及以上；正式发布范围只覆盖 x64，不承诺 Ubuntu 20.04 或更早版本。
7. AppImage 赋予执行权限后直接运行验收；`.deb` 使用 `apt install ./包名.deb` 安装，并验证启动器、卸载和重装。
8. 建立 CD 流程：Pull Request 做打包检查；`main` 推送构建并上传 x64 AppImage 和 x64 `.deb`；手动触发构建同样两个包；不自动创建 Tag 或公开发布。
9. CD 只接收一个 `release_version` 参数，例如 `0.1.0`；应用版本和产物文件名使用该值，OMP 版本继续固定为 `v17.1.0`。
10. 手动触发 CD 后自动创建 GitHub Draft Release，上传 x64 AppImage、x64 `.deb`、SHA-256 文件和构建诊断摘要；公开发布由用户手动确认。

## 第二批确认决策

11. Debian 包名使用 `omp-desktop`，Electron `appId` 使用 `com.omp.desktop`，用户可见名称使用 `OMP Desktop`。
12. MVP 为每个安装包生成 SHA-256 校验文件，暂不建立 GPG、APT 仓库或 AppImage 数字签名。
13. MVP 不做应用内自动更新；用户通过 GitHub Release 获取新版安装包。
14. 安装包拥有 bundled OMP 版本，OMP 不自行更新；升级 OMP 只能通过新的 OMP Desktop Release 完成。
15. Main、Preload 和 Renderer 代码放入 `app.asar`；OMP 作为 `resources/runtime/omp` 的额外资源放在 ASAR 外，并检查架构、文件存在和 `0755` 权限。
16. `.deb` 升级和 AppImage 替换后必须保留 Workspace、Session、Runtime 环境及网络设置，并执行跨版本升级验收。
17. 卸载 `.deb` 只移除应用，不删除用户主目录中的状态、Session、日志或 OMP 配置；重新安装后可以恢复。
18. 正式 Linux 应用图标是 MVP-10 的前置条件；使用 `resources/icons/omp-desktop.png`，不使用 Electron 默认图标。
19. GPU 兼容采用两层验收：CI 自动覆盖默认 GPU 与 `--disable-gpu` smoke，发布前在真实 GPU 上验收；缺少真实 GPU 结果时 MVP-10 不能完成。
20. 最初确认 x64 和 arm64 都做真实设备验收；该范围已由第 47、48 条调整为只正式支持 x64，arm64 不再构建安装包。

## 第三批确认决策

21. 首屏 Renderer JS 超过 700 KB gzip、空闲 CPU 持续超过 1%、可重复主线程长任务超过 50 ms 或内存持续增长时阻止发布；安装包体积和稳定但略超预算的内存可以记录原因后由用户人工批准。
22. 指定本机作为 x64 主性能基准机；固定显示协议、分辨率、GPU 模式、电源模式和 Workspace，冷启动、热启动至少各测 5 次并记录中位数。GitHub Runner 只观察趋势，arm64 单独记录。self-hosted runner 自动执行 `LetItBe12345` 从本仓库分支创建的 PR，并保留手动入口；其他 PR 不执行。
23. GitHub Hosted CI 通过后即可合并 PR，普通 PR 不以本机 GPU 验收作为必需检查；CD 必须先在本机 self-hosted runner 完成真实 GPU 验收，失败或离线时不生成 Draft Release。
24. 本机只负责真实 GPU 和性能验收；通过后由 GitHub x64 Hosted Runner 构建安装包并创建 Draft Release。arm64 Hosted Runner 只保留界面构建和 headless smoke。
25. 本机 CD 以 NVIDIA RTX 3090 和原生 Wayland 作为真实 GPU 自动验收环境；X11 由用户切换会话后手动验收。
26. CD 开始前必须检查 `XDG_SESSION_TYPE=wayland`、`WAYLAND_DISPLAY` 存在、GPU 为 RTX 3090，并确认 Electron GPU Feature Status 使用硬件加速；不符合时立即失败。
27. 真实 GPU 验收必须绑定 CD 触发时的 commit SHA；源码、Desktop 版本或 OMP 版本变化后必须重新验收。
28. 本机生成 `gpu-acceptance.json`、主日志、GPU Feature Status、显示协议和关键截图并上传为 CI artifact；日志保留 90 天，Draft Release 长期保留脱敏摘要。
29. 自动验收负责环境、GPU、启动、首屏截图、Runtime ready、退出和日志；人工验收负责长对话滚动、流式输出、Thinking、Tool Call、Permission、弹窗、缩放、黑屏、闪烁、透明窗口、Stop 和退出。自动失败或人工未签收时 CD 停止。
30. 人工签收使用固定清单和本地记录文件；脚本记录 commit、版本、操作者、时间、逐项结果和已知问题，全部必检项通过后才生成 `gpu-acceptance.json`。完整操作和失败处理必须写入 `docs/`。

## 第四批确认决策

31. `release_version=0.1.0` 对应 Draft Release 的 `v0.1.0`；草稿阶段不创建 Tag，用户点击 Publish 时才创建 Tag。同名 Tag 指向其他 commit 时 CD 失败；同版本、同 commit 的草稿允许更新。
32. CD 自动生成基础 Release Notes，包含 Desktop 和 OMP 版本、Ubuntu 支持范围、x64 AppImage、x64 `.deb`、SHA-256、真实 GPU 验收摘要、性能指标和已知问题；commit 列表只作附录，Publish 前由用户人工检查。
33. OMP Desktop 使用 MIT License；安装包保留项目许可证及 OMP、Electron 和其他生产依赖的第三方许可证。项目主页使用 `https://github.com/LetItBe12345/omp_app`。
34. 许可证版权信息使用 `Copyright (c) 2026 LetItBe12345`；Debian Maintainer 使用 `LetItBe12345 <guanghaojin56@gmail.com>`。
35. 目前固定 OMP 二进制版本；仓库不提交大型二进制。下载、SHA-256 或架构校验失败时构建立即失败，不回退到 `latest` 或本机未知版本；Actions 按版本、架构和校验值缓存。
36. OMP 版本、x64 下载地址和 SHA-256 集中保存在 `runtime/manifest.json`，下载脚本、CI、打包和诊断统一读取。
37. CI 同时运行 fake Runtime RPC smoke 和真实 OMP 的无凭据 RPC smoke；真实 OMP 无法进入 `ready` 或完成 `get_state` 时禁止打包。
38. 本机 CD 使用 OMP 当前已经配置并可用的模型令牌；不读取 Codex 认证文件，不把令牌上传到 GitHub或写入验收产物。
39. 真实模型验收使用一次性测试 Workspace，固定安全 Prompt，只允许读取测试文件和执行无副作用命令；结束后删除临时目录并确认没有遗留 OMP 进程。
40. 真实模型验收固定使用 `openai-codex/gpt-5.4-mini`，Thinking 等级固定为 `medium`；模型不可用或登录失效时 CD 失败，不自动切换模型。

## 第五批确认决策

41. 生产包保持 Chromium sandbox，不自动添加或公开推荐 `--no-sandbox`；AppImage 因系统 sandbox 策略无法运行时给出明确诊断并建议使用 `.deb`。
42. `.deb` 允许 `apt` 解析系统库依赖，但安装脚本和 AppImage 首次启动不得下载 OMP、Electron 或其他应用组件；离线时应用仍应能启动并进入 OMP `ready`，模型请求除外。
43. `.deb` 使用标准系统级安装布局，安装和卸载需要管理员权限，应用日常运行不使用 root；每个系统用户使用独立用户数据目录。
44. MVP 不注册文件关联或 `omp://` 自定义协议，只提供桌面启动器和 `omp-desktop` 命令。
45. 命令行支持普通启动、`--version`、`--disable-gpu` 和后续确认的 `--setup-provider`；暂不接受 Workspace、Session、文件或 URL 参数。未知参数返回非零退出码。
46. 正式支持只写 Ubuntu 22.04 LTS 和 24.04 LTS；其他 Debian/Ubuntu 系发行版不阻止运行，但不列入 MVP 完成条件。
47. 首个 MVP Release 只发布 x64，不再发布 arm64 安装包；产物为 x64 AppImage 和 x64 `.deb`。
48. 保留 arm64 的 Electron 界面构建和 headless smoke，但不下载 arm64 OMP、不构建 arm64 安装包，也不把 arm64 列为正式支持。
49. 本机性能基准固定为 1920×1080、60 Hz、`balanced` 电源模式；切换到 Wayland 后保持相同设置。
50. 首个 MVP Release 版本定为 `0.1.0`，Draft Release 使用 `v0.1.0`；bundled OMP 版本独立固定为 `v17.1.0`。

## 第六批确认决策

51. CD 只在 GitHub Hosted Runner 的临时工作区注入 `release_version`，不提交版本修改；构建后验证应用内部版本、`.deb` 元数据和文件名一致。
52. `release_version` 只接受不带 `v` 的稳定 SemVer `X.Y.Z`，首版不支持 beta、rc 或其他预发布版本。
53. 支持同版本重装和向新版本升级，不正式支持降级；强制降级时不删除用户数据，旧版无法读取新数据时必须报错而不是重置。
54. MVP-10 固定产出 `docs/ubuntu-installation.md`、`docs/release-acceptance.md` 和 `docs/releasing.md` 三份操作文档。
55. 由 `resources/icons/omp-desktop.png` 生成 16、32、48、64、128、256、512 和 1024 像素的 Linux PNG，并单独检查 16、32 像素的可辨识度。
56. 25 MB 应用增量只计算 `app.asar`、生产依赖、Main/Preload/Renderer bundle、图标和应用资源，排除 Electron 与 bundled OMP；安装包总大小单独记录，不设单一硬上限。
57. Runtime 默认倾向于在 Renderer 首屏 ready 后立即启动；最终策略由两种方案的冷、热启动各 5 次中位数决定，优先保护首屏显示。
58. 完全没有 Provider 凭据时，用户通过 `omp-desktop --setup-provider` 在当前终端启动 bundled OMP TUI 完成首次配置；后续新增或重新登录 Provider 使用 GUI。Desktop 不读取或保存 Token。
59. 新建 `README.md`，其中“使用”一栏必须写清安装、首次 Provider 配置、正常启动、Workspace/Session/模型基本操作、后续 GUI 登录、`--disable-gpu`、卸载、用户数据、SHA-256 和详细文档链接。
60. 空闲 CPU 在应用和 OMP ready 后等待 60 秒，再连续采样 60 秒；合计 Main、Renderer、GPU/Utility 和 OMP Runtime 的平均 CPU，要求低于 1%，并记录峰值。测试期间不进行交互。

## 第七批确认决策

61. 空闲内存使用 PSS 测量；空 Electron 与 Desktop 在同一台本机、同一 Wayland 和显示设置下比较。Runtime ready 后静置 60 秒，再连续采样 60 秒并记录中位数和峰值；bundled OMP 单独列出。持续增长阻止发布，稳定但略超 80 MB 可以人工批准。
62. 首 token 同时记录 `prompt_to_first_event` 和 `prompt_to_first_visible_text`；Runtime 已 ready，固定 `openai-codex/gpt-5.4-mini`、`medium` 和短 Prompt，新建 Session 运行 5 次并记录中位数和最大值。`v0.1.0` 先建立基线，不设硬毫秒门槛。
63. 真实 CD 验收必须在系统全局代理和 TUN 关闭时，使用 Desktop Runtime 手动 HTTP 代理；验证模型请求和 RPC Bash 继承代理，再切换为不使用代理并确认变量清除。测试使用隔离配置，不覆盖日常设置。fake Runtime 压力测试不要求代理。
64. 压力测试只使用 fake Runtime，不调用真实模型 API；连续流式输出 30 分钟，至少产生 10,000 个流事件、1,000 次 Tool 状态更新和 100 MB stderr。结束后等待 2 分钟，PSS 必须停止增长并明显回落，Stop 和退出保持响应。
65. 应用整体退出上限为 10 秒；Runtime 沿用 5 秒正常等待、2 秒 SIGTERM 和 0.5 秒 SIGKILL，日志最多等待 2 秒。超时后强制结束剩余进程组，并检查没有遗留 OMP 进程。
66. Runtime 日志待写队列上限为 1 MiB；过载时丢弃新的普通日志，只累计条数和字节数，队列恢复后写一条汇总。单条日志最多 4 KiB；磁盘日志每份 5 MB，最多 3 份。
67. 数据丢失、秘密泄露、支持系统无法安装或启动、核心主链路不可用、GPU 黑屏且兼容模式无效、退出后遗留进程、持续资源增长、主线程持续阻塞、日志无界增长或安装包包含错误资源时阻止发布。轻微且有规避方式的问题写入 Release Notes 后仍需用户人工批准。
