# 发布流程

CI 和 CD 分开：PR 只做快速质量检查。合并到 `main` 不重复运行 CI，也不打包。手动触发 Release/CD 后，才运行真实 Runtime、打包和安装包测试，并发布同一个候选产物。

## CI

- PR 只运行 `CI / Quality`：依赖安装、类型检查、Lint、格式检查、测试、fake RPC smoke 和生产构建。
- `main` 没有 CI 触发器。合并后不重复运行 Quality，也不下载 Runtime 或构建安装包。
- CI 不运行真实 Runtime、打包、GPU 或显示矩阵。

## Release

1. 确认目标 commit 已在 `main`，并在本机原生 Wayland + RTX 3090 完成 [人工发布验收](release-acceptance.md)，生成 `~/.local/state/omp-desktop/release-acceptance/<commit>.json`。
2. 在 GitHub Actions 运行 `Release`，输入不带 `v` 的版本，例如 `0.1.2`。构建、安装包测试和 Draft Release 创建全部由 Workflow 完成，不在本地手工执行 CD。
3. `Build release candidate` 在 Hosted Runner 上下载并校验真实 Runtime，运行真实 RPC smoke，然后只构建一次 AppImage、deb、SHA-256 和构建指标，并上传为 artifact。
4. 四组 Hosted 测试（Ubuntu 22.04/24.04 × X11/Wayland）都下载并测试这个 artifact；测试安装后的 `.deb`，不重新构建。
5. `RTX 3090 Wayland candidate acceptance` 使用标签 `[self-hosted, Linux, X64, rtx3090, wayland]`，下载同一个 AppImage，检查真实 GPU、WebGL/WebGL2、窗口、截图和 RPC。不在真机重新打包。
6. 全部通过后，Workflow 创建 Draft Release `v<version>` 并上传同一批文件。人工检查产物、SHA-256、截图和 GPU 证据，在 GitHub 页面点击 **Publish**。

版本参数只接受 `X.Y.Z`。已有正式 Tag 时 Workflow 会停止，避免覆盖。发布 artifact 不得包含 Token、认证文件或本机日志。
