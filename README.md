# OMP Desktop

OMP Desktop 是 OMP 的 Linux 桌面客户端。首个发布版只提供 Ubuntu 22.04/24.04、x86-64 的 AppImage 和 `.deb`，内置 OMP `v17.1.0`。

## 使用

1. 从 GitHub Release 下载 `omp-desktop-*-linux-x64.AppImage` 或 `.deb`，按 [Ubuntu 安装说明](docs/ubuntu-installation.md) 校验 SHA-256 并安装。
2. 第一次没有 Provider 凭据时，在终端运行 `omp-desktop --setup-provider`。这会启动内置 OMP 的交互终端；按 OMP 的提示完成 Provider 登录，然后退出。Desktop 不读取或保存 Token。
3. 正常运行 `omp-desktop`，选择 Workspace，新建 Session，在模型选择器中选择模型并发送 Prompt。后续新增 Provider 或重新登录在 GUI 中完成。
4. 图形驱动黑屏时可从终端运行 `omp-desktop --disable-gpu`；该参数只对本次启动生效。
5. 卸载 `.deb` 使用 `sudo apt remove omp-desktop`。卸载不会删除 Workspace、Session、Runtime 设置或日志；重新安装后会继续使用这些数据。

安装包、Runtime 和详细验收步骤见 [发布验收](docs/release-acceptance.md)；维护者发布流程见 [发布流程](docs/releasing.md)。

## 开发

```sh
pnpm install
pnpm runtime:download
pnpm dev
pnpm check
```

`runtime/omp` 不提交到 Git。它由 `runtime/manifest.json` 固定的 URL 和 SHA-256 下载。生产构建使用 `pnpm package:linux`，只在 Linux x64 上生成 AppImage 和 `.deb`。
