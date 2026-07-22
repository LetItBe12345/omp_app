# POST-MVP-02：内置多标签 Terminal

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-07
- 后续任务：无

## 目标

提供可放在底部或右侧的内置多标签 Terminal。Terminal 是独立 PTY 进程，不参与 OMP Runtime 的 Agent Bash Tool 执行。

## 任务清单

- [ ] 确定 Terminal 面板位置与折叠规则。
- [ ] 使用 `xterm.js` 或成熟等价实现渲染终端。
- [ ] 使用成熟 PTY 实现，不自行模拟终端协议。
- [ ] 支持多个 Terminal Tab 的创建、切换和关闭。
- [ ] 打开 Terminal 时再创建 PTY。
- [ ] 独立定义 Terminal Environment Profile，管理 Shell、PATH、普通环境变量和 Workspace。
- [ ] 独立定义 Terminal Network Profile，支持继承 Runtime 设置、不使用代理、系统代理和手动代理。
- [ ] 不强制 Terminal 与 OMP Runtime 使用相同的环境或代理策略。
- [ ] 确定代理策略是整个 Terminal 面板共享，还是允许单个 Tab 覆盖。
- [ ] 支持调整大小、复制、粘贴和清屏。
- [ ] 关闭标签或退出应用时终止对应 PTY。

## 完成条件

- [ ] 可以同时使用多个 Terminal Tab。
- [ ] Terminal 可以独立验证不使用代理、系统代理和手动代理三种策略。
- [ ] Terminal 的环境或代理配置不会反向修改 OMP Runtime。
- [ ] 关闭标签或退出应用后不残留 PTY 进程。
