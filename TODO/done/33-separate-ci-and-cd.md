# MVP-33：分离 CI 和 CD

- 状态：已完成
- 优先级：P0

## 目标

PR 只运行快速质量检查。真实 Runtime、Linux 打包和安装包 smoke 只在手动 CD 中运行。

## 任务

- [x] 删除 `main` push 的 CI 触发器。
- [x] CI 只保留 PR Quality。
- [x] 将真实 RPC smoke 放入手动 Release/CD。
- [x] 保留 CD 的单次打包、包检查和安装版 X11/Wayland smoke。
- [x] 同步发布说明。

## 完成条件

- [x] Workflow 和文档格式检查通过。
- [x] PR Quality 通过。
- [x] CI 仅声明 `pull_request` 触发器，不声明 `main` push 触发器。

## 验证记录

- PR：#48
- PR Quality：30338980406
