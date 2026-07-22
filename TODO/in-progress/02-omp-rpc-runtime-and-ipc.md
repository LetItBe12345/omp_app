# MVP-02：OMP RPC 与 IPC 主链路

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-01
- 后续任务：MVP-03、MVP-04、MVP-07

## 目标

让 Electron Main 稳定启动 OMP，并通过安全 IPC 向 Renderer 提供最小 RPC 能力。

## 固定方案

```text
Renderer
  ↓ Electron IPC
Preload
  ↓ Electron IPC
Main / Runtime Supervisor
  ↓ JSONL over stdin/stdout
runtime/omp --mode rpc
```

MVP 只运行一个长期 OMP RPC 进程。

## 明确不做

- 不修改 OMP 核心。
- 不解析 TUI 文本。
- 不新增 WebSocket、gRPC 或 HTTP 服务。
- 不为每个 Session 启动独立进程。
- 不在 Renderer 重建 Agent 状态机。
- 不在本任务实现 Runtime Environment / Network Profile 的解析策略，该策略属于 MVP-06。

## 任务清单

### Runtime Supervisor

- [ ] 从应用资源中解析 `runtime/omp` 路径。
- [ ] 使用活动 Workspace 作为 `--cwd` 启动 OMP。
- [ ] Runtime Supervisor 接收已解析的 Runtime `env`，并原样传入 `spawn`。
- [ ] 逐行解析 stdout JSONL，保留不完整行缓冲区。
- [ ] 等待 `ready` 后再允许发送命令。
- [ ] 记录 stderr、退出码、信号和启动耗时。
- [ ] 应用退出、Workspace 切换和异常重启时正确终止子进程。
- [ ] 防止无意启动多个 OMP 进程。

### 请求与响应

- [ ] 为每个请求生成唯一 `id`。
- [ ] 维护请求表，按 `id` 关联响应。
- [ ] 区分立即响应、流式事件和 Agent 完成事件。
- [ ] 为启动、普通命令和关闭设置明确超时。
- [ ] 正确处理 `bash` 并发响应顺序。
- [ ] Prompt 完成以 `agent_end`、`prompt_result` 或未触发 Agent 为准。

### 最小命令集

- [ ] `get_state`
- [ ] `get_messages`
- [ ] `prompt`
- [ ] `abort`
- [ ] `steer`
- [ ] `follow_up`
- [ ] `new_session`
- [ ] `switch_session`
- [ ] `set_model`
- [ ] `set_thinking_level`
- [ ] `get_available_models`
- [ ] `get_available_commands`

### Preload 与 IPC

- [ ] 定义最小、类型明确的 IPC channel。
- [ ] Preload 暴露命令调用和事件订阅接口。
- [ ] 事件订阅支持取消，避免重复监听。
- [ ] Main 校验 Renderer 传入的路径和参数。
- [ ] 不把原始 Node 对象、ChildProcess 或文件句柄暴露给 Renderer。

### 测试

- [ ] 为 JSONL 分包、粘包和空行编写单元测试。
- [ ] 为请求 ID、超时和进程退出编写单元测试。
- [ ] 使用假 OMP 进程测试 `ready → get_state → response`。
- [ ] 保留并扩展 `scripts/rpc-smoke.mjs`。
- [ ] 测试应用关闭后没有遗留 OMP 进程。
- [ ] 用测试环境变量验证 Runtime `env` 注入有效；完整 Profile 和 RPC `bash` 继承验收由 MVP-06 完成。

## 完成条件

- [ ] Main 可以稳定启动和关闭 OMP。
- [ ] Renderer 可以通过 Preload 调用 `get_state`。
- [ ] Renderer 可以接收原始 OMP 事件流。
- [ ] 请求失败、超时和进程崩溃都有明确错误状态。
- [ ] 重复启动不会产生第二个长期 OMP 进程。
- [ ] RPC smoke test 和相关单元测试通过。

## 参考

- `docs/OMP_RPC.md`
- `docs/desktop-architecture.md`
- `scripts/rpc-smoke.mjs`
- Oh My Pi `docs/rpc.md`
- ohmypi-craft 的 Electron/RPC 连接代码
