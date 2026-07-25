# Issue 31：Ubuntu Linux 中文输入法

- 状态：已完成
- GitHub Issue：<https://github.com/LetItBe12345/omp_app/issues/31>

## 目标

- Ubuntu 24.04 Wayland 下启用 Chromium 原生输入法协议。
- Ubuntu 24.04 X11 的 GTK IBus 使用 XIM 桥接。
- 中文输入法组合文字和确认候选时，不把 Enter 误判为发送。

## 完成条件

- [x] Wayland 启动时传入 `enable-wayland-ime` 和 text-input-v3。
- [x] X11 检测到 GTK IBus 时改用 `GTK_IM_MODULE=xim`。
- [x] composition 期间和 `keyCode 229` 的 Enter 不发送任务。
- [x] 不覆盖其他输入法和非 Linux 平台。
- [x] 本地人工输入中文通过。
- [x] 自动化检查及 X11、Wayland smoke 通过。
