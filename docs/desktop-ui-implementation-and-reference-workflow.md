# OMP Desktop UI 实现与参考项目使用方案

本文记录 OMP Desktop 的 UI 实现方向，以及外部开源项目的使用方式。

## 1. 核心判断

不要从零重写完整的 Desktop、聊天 UI 或 Agent 协议。

采用分层复用：

| 层               | 主要参考                                                                                  | 用途                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Desktop 外壳     | [OpenCode Desktop](https://github.com/anomalyco/opencode)                                 | Electron 主进程、Preload、Sidecar、窗口、日志、打包     |
| Agent 后端       | [Oh My Pi](https://github.com/can1357/oh-my-pi)                                           | JSONL RPC、会话、模型、Thinking、工具调用、流式事件     |
| 聊天 UI          | [assistant-ui](https://github.com/assistant-ui/assistant-ui)                              | Thread、Message、Composer、流式渲染、自动滚动、工具组件 |
| OMP Desktop 适配 | [ohmypi-craft](https://github.com/BRCOO/ohmypi-craft)                                     | Electron/React 与 OMP RPC 的现成连接方式                |
| 工具交互         | [OpenCode Session UI](https://github.com/anomalyco/opencode/tree/dev/packages/session-ui) | 工具分组、运行状态、折叠详情、Diff 展示                 |

不要整体 Fork 后直接修改。只复用最小、明确的部分。

## 2. MVP 架构

```text
Electron Main
├── 启动和停止 OMP 进程
├── 通过 stdin/stdout 交换 JSONL RPC
├── 解析 Runtime Environment / Network Profile 并生成 OMP `env`
└── 通过安全 IPC 转发给 Renderer

Electron Preload
└── 暴露最小、类型明确的 Desktop API

React Renderer
├── ProjectSidebar
├── FileTree
├── Conversation
├── RunTrace
└── PromptComposer
```

OMP 必须使用原生 RPC：

```bash
omp --mode rpc
```

不要解析 TUI 文本。不要为 MVP 新增第二套 Agent 协议。

## 3. 消息和流式事件模型

Thinking、工具调用和最终文本属于同一个 Assistant Turn。

```ts
type AssistantTurn = {
  items: TurnItem[]
  finalItemIds: string[]
  status: 'running' | 'done' | 'error'
}

type TurnItem = NarrativeItem | ActionItem | InteractionItem | ArtifactItem

type AgentRunProjection = {
  turns: AssistantTurn[]
  lifecycle: Lifecycle
}
```

`items` 保留 OMP 原始内容顺序。`finalItemIds` 只引用成功结束后被分类为最终回答的 Narrative，不复制完整文本。Lifecycle 属于 Run，不进入 `TurnItem` 或聊天内容。

五类展示投影的职责：

- `Narrative`：Reasoning、过程说明和最终回答。
- `Action`：一次工具操作从调用、运行、进度到结果或错误的完整生命周期。
- `Interaction`：等待审批、确认、选择或输入的临时交互。
- `Artifact`：从工具结果提取的高价值产物引用或摘要。
- `Lifecycle`：驱动 Run 状态和控制组件，不渲染成普通聊天消息。

OMP RPC 已提供所需事件：

```text
message_start / message_update / message_end
text_start / text_delta / text_end
thinking_start / thinking_delta / thinking_end
toolcall_start / toolcall_delta / toolcall_end
tool_execution_start / tool_execution_update / tool_execution_end
agent_start / agent_end
```

Renderer 只做事件归并和展示，不重建 Agent 状态机。

Tool Call、Progress 和 Result 使用 `toolCallId` 更新同一个 Action。连续的 Read、Grep、Glob、List 和 Web Search 等上下文操作可以聚合显示；聚合只影响展示，展开后必须恢复原始工具顺序。

## 4. Thinking 和工具调用的交互

### 运行中

默认展开当前执行轨迹：

```text
正在处理……

思考……
✓ 读取 package.json
◌ 搜索 RPC 实现
◌ 执行构建命令
```

Thinking、工具参数和工具结果持续更新。

### 完成后

自动收起为一行：

```text
✓ 已思考 2 分钟 · 调用 3 个工具 · 查看详情
```

下方只保留最终 Assistant 文本。

规则：

- 成功后自动折叠。
- 失败时保持展开。
- 等待用户确认时保持展开。
- 用户手动展开后，不强制再次收起。
- 历史会话默认折叠。
- 数据必须保留，只改变展示状态。

不要把 Thinking 和每次 Tool Call 渲染成独立聊天消息。

## 5. UI 实现选择

推荐组合：

```text
Electron
├── electron-vite
├── React
├── Tailwind CSS 4
├── lucide-react
├── react-resizable-panels
├── assistant-ui（需要真实聊天能力时）
├── Radix UI（需要复杂菜单、对话框或选择器时）
└── TanStack Virtual（长列表出现时）
```

MVP-01 只接入 Tailwind CSS 4、`lucide-react` 和 `react-resizable-panels`。`electron-builder` 在 MVP-08 接入；Radix UI、assistant-ui 和 TanStack Virtual 在首次出现真实需求时再接入。

样式边界：

- Tailwind 管理布局、间距、颜色、字体、边框和交互状态。
- 少量普通 CSS 管理 Reset 补充、滚动条、拖动柄和复杂样式。
- 使用语义化主题变量，避免大量任意值和动态拼接类名。
- 使用系统字体，不下载或打包在线字体。
- 三栏使用 `react-resizable-panels`，默认比例为 `18/17/65`，并支持拖动调整宽度。

复用边界：

- OpenCode：参考 Desktop 工程结构和工具交互，不直接搬入整套 SolidJS 应用。
- assistant-ui：复用聊天原语，并实现 `OmpRuntimeAdapter`。
- ohmypi-craft：重点读取 OMP RPC、会话恢复和运行时打包代码，不复制其完整 Monorepo。
- OMP：直接复用 RPC、SDK 和事件定义，不重复实现 Agent Loop。

## 6. 外部参考仓库的本地管理

真正开发的仓库必须保持独立。

推荐目录：

```text
~/code/
├── omp_app/                 # 当前项目，TUI 在这里启动
└── omp-references/          # 外部只读参考
    ├── opencode/
    ├── assistant-ui/
    ├── ohmypi-craft/
    └── oh-my-pi/
```

启动方式：

```bash
cd ~/code/omp_app
omp
```

参考仓库不要放进 `omp_app/`，也不要加入当前 Git 仓库。

## 7. 浅克隆和稀疏检出

浅克隆只减少 Git 历史，不会只下载第一层目录：

```bash
git clone --depth 1 https://github.com/anomalyco/opencode.git
```

当前分支源码仍然完整，但通常只有最近一次提交历史。

只需要部分目录时，使用稀疏检出：

```bash
git clone --depth 1 --filter=blob:none --no-checkout \
  https://github.com/anomalyco/opencode.git
cd opencode
git sparse-checkout init --cone
git sparse-checkout set packages/desktop packages/session-ui packages/ui
git checkout
```

两者可以同时使用。

## 8. AGENTS.md 的作用

`AGENTS.md` 不应塞入大段外部源码，也不应只写仓库首页链接。

它应提供精确导航：

```md
### Electron 外壳

本地参考：`../omp-references/opencode`

重点目录：

- `packages/desktop/`
- `packages/session-ui/`

用途：

- Electron 生命周期
- Sidecar 管理
- 工具调用折叠

限制：

- 只读
- 不复制完整架构
- 只读取完成当前任务所需的文件
```

同时记录实际使用的 commit：

```bash
cd ../omp-references/opencode
git rev-parse HEAD
```

这样可以复现参考版本，避免外部仓库更新后路径和实现漂移。

## 9. 禁止事项

- 不把所有参考仓库放进同一个 Workspace。
- 不把参考仓库作为 Git Submodule。
- 不把整个参考仓库塞进模型上下文。
- 不让 Agent 无目标地遍历所有参考代码。
- 不直接复制 OpenCode 或 ohmypi-craft 的完整架构。
- 不解析 OMP TUI 输出。
- 不在 MVP 中新增 WebSocket、gRPC 或自定义 Agent 协议。

## 10. 推荐实现顺序

1. 完成 OMP 进程启动和 JSONL RPC 收发。
2. 建立 `OmpEventReducer`，归并 Assistant Turn。
3. 接入最小聊天界面和流式文本。
4. 实现 Thinking/Tool Trace 的运行时展开和完成后折叠。
5. 接入会话列表和项目工作目录。
6. 接入文件树、搜索和文件/目录上下文引用。
7. MVP 之后接入 Changes / Review / Diff 和多标签 Terminal。
8. 最后处理内置浏览器、Browser Use 和 Computer Use。

第一阶段只解决核心聊天和本地代码任务。不要提前扩大范围。
