# Ubuntu 安装

正式支持 Ubuntu 22.04 LTS 和 24.04 LTS x64。其他发行版可能可以运行，但不属于本版本的验收范围。

## `.deb`

```sh
sha256sum -c omp-desktop-0.1.1-linux-x64.deb.sha256
sudo apt install ./omp-desktop-0.1.1-linux-x64.deb
omp-desktop --version
```

应用可从桌面启动器或终端运行。卸载使用 `sudo apt remove omp-desktop`；不要手动删除 `~/.config/OMP Desktop`，那里保存用户数据。

## AppImage

```sh
sha256sum -c omp-desktop-0.1.1-linux-x64.AppImage.sha256
chmod +x omp-desktop-0.1.1-linux-x64.AppImage
./omp-desktop-0.1.1-linux-x64.AppImage
```

AppImage 无需安装。若系统的 Chromium sandbox 策略阻止启动，改用 `.deb`，不要用 `--no-sandbox` 作为常规解决方案。

## 首次 Provider 配置

没有凭据时，在当前终端运行：

```sh
omp-desktop --setup-provider
```

内置 OMP 会接管当前终端，按其提示登录 Provider。完成后退出 TUI，再启动 Desktop。Desktop 不读取 `~/.codex/auth.json`，也不会把 Token 写入项目或验收产物。
