# MVP 执行总表

- 状态：进行中
- 阶段：Ubuntu MVP
- 更新时间：2026-07-22
- 目标：把现有产品、架构和 RPC 文档转成可执行任务

## 已确定的实现边界

- [x] 首发平台为 Ubuntu / Linux。
- [x] 技术栈使用 Electron、React、TypeScript。
- [x] Agent 能力直接复用 OMP RPC。
- [x] MVP 只保留一个活动 Workspace 和一个长期 OMP RPC 进程。
- [x] Session 通过 OMP 的会话能力切换，不为每个会话启动进程。
- [x] Browser Use、Computer Use、多窗口和插件市场不进入 MVP。
- [x] Changes / Review / Diff 和内置 Terminal 不进入 MVP。
- [x] 不 Fork OMP，不新增第二套 Agent 协议，不解析 TUI 输出。

## 执行顺序

- [x] [MVP-01：Electron 工程骨架](../done/01-electron-project-scaffold.md)
- [x] [MVP-02：OMP RPC 与 IPC 主链路](../done/02-omp-rpc-runtime-and-ipc.md)
- [ ] [MVP-03：模型授权、Provider 与模型选择](./03-model-authorization-provider-and-selection.md)
- [ ] [MVP-04：流式对话与执行轨迹](./04-streaming-conversation-and-run-trace.md)
- [ ] [MVP-05：Workspace、Session 与上下文引用](./05-workspace-session-and-context.md)
- [ ] [MVP-06：文件树与上下文引用](./06-files-preview-and-edit.md)
- [ ] [MVP-07：OMP Runtime 环境与网络](./07-runtime-environment-and-network.md)
- [ ] [MVP-08：Ubuntu 打包与 MVP 验收](./08-ubuntu-packaging-and-acceptance.md)

## MVP 之后

- [ ] [POST-MVP-01：Changes、Review 与 Diff](./09-changes-review-and-diff.md)
- [ ] [POST-MVP-02：内置多标签 Terminal](./10-multi-tab-terminal.md)
- [ ] [POST-MVP-03：多 Session 并行 Runtime](./11-parallel-session-runtimes.md)

## 依赖关系

```text
MVP-01
  ├─ MVP-02 ─ MVP-03 ─ MVP-04 ─ MVP-05
  ├─ MVP-06
  └─ MVP-07

MVP-02 + MVP-03 + MVP-04 + MVP-05 + MVP-06 + MVP-07
  └─ MVP-08
```

## MVP 总体验收

- [ ] 应用可以在 Ubuntu 启动和退出。
- [ ] 可以选择 Workspace，并以该目录启动 OMP RPC。
- [ ] 首次使用时可以登录 Provider、获取可用模型并选择模型与 Thinking Level。
- [ ] 可以发送 Prompt，查看流式文本、Thinking 和 Tool Call。
- [ ] 回复完成后，执行过程自动折叠，最终回答保持突出。
- [ ] 可以停止当前执行链，并按顺序处理 Follow-up。
- [ ] 可以创建、切换和恢复 Session。
- [ ] 可以浏览和搜索文件，并将文件或目录加入上下文。
- [ ] 可以控制 OMP Runtime 使用或不使用代理，不依赖系统全局代理。
- [ ] 安装包、空闲资源和首屏体积不超过架构文档中的回归预算。

## 维护规则

- 每完成一个勾选项，立即更新对应 TODO。
- 发现协议或产品冲突时，先更新项目文档，再修改 TODO。
- TODO 只记录可执行动作，不重复复制产品说明。
- 一个 TODO 的任务和验收项全部完成后，移入 `TODO/done/`。
- 未验证的项目不得勾选。

## 参考

- `docs/product-spec.md`
- `docs/desktop-architecture.md`
- `docs/OMP_RPC.md`
- `docs/desktop-ui-implementation-and-reference-workflow.md`
- `UI/16341.png`
