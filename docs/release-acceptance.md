# Ubuntu 发布验收

发布只允许使用当前 commit 的真实验收记录。CI 的 Xvfb/Weston smoke 不能代替真实 GPU 验收。

## 本机自动检查

在 RTX 3090、原生 Wayland、1920x1080/60 Hz、系统全局代理和 TUN 关闭的桌面会话中执行：

```sh
export XDG_SESSION_TYPE=wayland
test -n "$WAYLAND_DISPLAY"
pnpm runtime:check
pnpm build
OMP_SMOKE_SCREENSHOT="$PWD/tests/artifacts/gpu-smoke.png" \
OMP_GPU_ACCEPTANCE_OUTPUT="$PWD/tests/artifacts/gpu-info.json" \
  pnpm smoke
```

检查 `gpu-info.json` 中的 `featureStatus`，必须是硬件加速，不能是 `disabled` 或软件渲染。记录显示协议、GPU Feature Status、Runtime 日志和截图。

首次 Provider 配置入口可用一次性 Profile 验证，避免改动日常 OMP 配置：

```sh
OMP_DESKTOP_SETUP_PROFILE="release-test-$(date +%s)" omp-desktop --setup-provider
```

确认 TUI 能启动并出现 Provider 登录入口后退出。验收 Profile 仅用于测试；普通用户不设置该环境变量。

## 人工签收

在同一 commit 上运行下面的脚本，逐项操作。真实模型验收使用隔离 Workspace、`openai-codex/gpt-5.4-mini`、`medium` 和 Runtime 手动 HTTP 代理；不要使用真实生产 Workspace。

```sh
node scripts/gpu-acceptance.mjs sign \
  --commit "$(git rev-parse HEAD)" --version 0.1.1
```

脚本只有在全部项目输入 `y` 后才生成 `~/.local/state/omp-desktop/release-acceptance/<commit>.json`。该文件包含操作者、时间、Wayland、RTX 3090、版本和 commit，不包含 Token。失败项必须修复后重新签收，不能编辑 JSON 冒充通过。

人工清单包括：启动和 Runtime ready、流式文本/Thinking/Tool/Permission、Stop 和 Ctrl+C、Session 恢复、文件和剪贴板、长对话滚动、弹窗/缩放/黑屏/闪烁/透明窗口、代理切换、退出及遗留进程检查。

## 安装、升级和卸载

在一次性测试用户或已备份的用户数据上依次执行：

1. 校验并直跑 AppImage；Ubuntu 22.04 缺 FUSE 时安装 `libfuse2`，Ubuntu 24.04 使用 `libfuse2t64`。不要使用 `--no-sandbox`。
2. `sudo apt install ./dist/omp-desktop-<版本>-linux-x64.deb`，检查 `omp-desktop --version`、桌面启动器、图标和普通用户启动。
3. 保存一个测试 Workspace、Session 和 Runtime 网络设置，然后同版本重装并向新版本升级，确认数据仍在。
4. `sudo apt remove omp-desktop`，确认应用被移除但用户数据仍在；重新安装并确认恢复。
5. 从桌面启动器启动，验证 Runtime PATH、代理和 bundled OMP 发现。退出后用 `pgrep -af '/runtime/omp|resources/runtime/omp'` 检查没有遗留进程。

## X11 和其他 GPU

RTX 3090 Wayland 是 CD 的必需环境。另行切换到 Ubuntu X11 会话，重复窗口、剪贴板、文件选择器、中文输入、长对话、流式输出和退出检查。X11 结果写入 TODO 发布记录，但不替代 Wayland 签收。

Intel 和 AMD 至少各需要一台真实设备检查默认 GPU 和 `--disable-gpu`。没有设备时必须在 Release Notes 中明确写“未验证”，不能填成通过。

## 性能记录

在 1920×1080、60 Hz、balanced 电源模式下，冷启动和热启动各 5 次。Runtime ready 后静置 60 秒，再连续采样 60 秒 CPU 和 PSS。记录 Main、Renderer、GPU/Utility、OMP，及首事件、首段可见文本、安装包、安装后和 `app.asar` 大小。性能结果写入 TODO 发布记录；持续内存增长、Renderer gzip 超 700 KiB、CPU 平均超过 1% 或重复出现超过 50 ms 的主线程任务时停止发布。

## 失败处理

GPU、Wayland、Runtime ready、模型请求、退出或数据恢复失败时停止发布。黑屏可临时用 `--disable-gpu` 诊断，但不能用它替代默认 GPU 验收。记录日志和复现步骤，修复后重新构建并重新签收。
