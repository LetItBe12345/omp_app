# MVP-34：修复 Desktop 代理、首条消息和会话崩溃

- 状态：进行中
- 优先级：P0

## 目标

修复 deb 安装版无法自动读取 Shell 或 v2rayN 本地 HTTP 代理、新 Session 首条用户消息不显示，以及 Assistant Turn 结束时的 Renderer 崩溃。

## 任务

- [x] 自动代理在 Login Shell 未返回 HTTP 代理时，补充读取交互 Shell 和 v2rayN 配置。
- [x] 新 Session 发送时立即显示用户消息，失败时恢复输入。
- [x] 避免 Agent 运行中扫描正在写入的 Session 文件。
- [x] 修复活动 Assistant Turn 转入历史时的 assistant-ui 索引越界。
- [x] 增加三个问题的回归测试。

## 完成条件

- [x] `pnpm check` 通过。
- [x] `pnpm build` 通过。
- [x] Linux AppImage 和 deb 生成及包检查通过。
- [x] 源码版和解包安装版的真实 Runtime smoke 通过。
- [ ] PR Quality 通过并合并。
