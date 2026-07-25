# Issue 31：Ubuntu Wayland 中文输入法

- 状态：已完成
- GitHub Issue：<https://github.com/LetItBe12345/omp_app/issues/31>

## 目标

- Ubuntu 24.04 Wayland 下启用 Chromium 原生输入法协议。
- 中文输入法组合文字和确认候选时，不把 Enter 误判为发送。

## 完成条件

- [x] Wayland 启动时传入 `enable-wayland-ime` 和 text-input-v3。
- [x] composition 期间和 `keyCode 229` 的 Enter 不发送任务。
- [x] X11 行为不变。
- [x] 自动化检查和 Wayland smoke 通过。
