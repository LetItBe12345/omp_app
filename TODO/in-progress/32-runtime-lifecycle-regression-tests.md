# MVP-32：Runtime 生命周期回归测试

- 状态：进行中
- 优先级：P0
- 前置任务：MVP-02、MVP-10

## 目标

防止 Workspace 恢复、Workspace 切换和 Runtime 重启并发时产生 RPC 超时或遗留进程。

## 任务

- [x] 为不同 Workspace 的并发 `start()` 增加单元测试。
- [x] 为重复 `restart()` 增加单元测试。
- [x] 修正 Runtime Supervisor 的跨 Workspace single-flight 和重复重启竞争。
- [x] 扩展安装包 smoke，等待真实 Runtime ready 后正常退出。
- [x] 安装包连续启动两次，并检查 Electron 和 OMP 没有遗留进程。
- [x] 将快速测试接入 PR Quality，将安装包测试接入 Linux display smoke。

## 完成条件

- [x] `pnpm test` 通过。
- [x] 本地类型检查、Lint 和格式检查通过。
- [ ] PR Quality 通过。
- [ ] `main` 的 Linux 安装包与 X11/Wayland smoke 通过。
