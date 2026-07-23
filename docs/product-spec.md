# OMP Desktop 产品与 MVP 设计

状态：Draft

## 1. 产品定位

OMP Desktop 不是完整 IDE。

它是一个面向本地项目的 Agent Desktop：

- 管理 Workspace 和会话。
- 与 OMP Agent 交互。
- 查看文件和改动。
- 运行终端命令。
- 审查 Tool Call、Thinking 和 Diff。

核心目标：

- 首发支持 Ubuntu。
- 后续兼容 macOS。
- 体积小。
- 启动快。
- 界面简单。
- 优先复用 OMP 现有 SDK、RPC 和工具能力。

## 2. 总体布局

采用三栏结构，栏目顺序以 `UI/16341.png` 为准：

```text
┌── 对话概览 ──┬─── 文件树 ───┬────── 对话主区 ──────┐
│ Workspace     │ 目录和文件   │ 用户消息              │
│ 会话列表       │ 展开与折叠   │ Assistant 输出        │
│ 搜索与新建     │ 文件搜索     │ Thinking / Tool Call  │
│               │              │ Permission             │
└───────────────┴──────────────┴──────────────────────┘
```

明确规则：

- 第一栏放 Workspace 和对话概览。
- 第二栏固定为文件树。
- 右侧为对话主区。
- 不把历史聊天做成顶部浏览器标签。
- MVP 不建立 Terminal、Changes 或 Review/Diff 面板。

## 3. Workspace 与会话

一级按 Workspace 分组。

Workspace 内部只保留四组：

1. 正在运行
2. 已置顶
3. 最近
4. 已归档

“最近”按今天、最近 7 天、更早分段。

MVP 不做复杂文件夹和多层标签系统。

支持：

- 新建会话。
- 恢复会话。
- 搜索会话。
- 重命名会话。
- 置顶和归档。
- 保存、搜索和切换多个会话。

MVP 只有一个长期运行的 OMP Runtime。同一时间只有当前 Session 可以生成，切换 Session 后再继续交互。

多 Session 并行属于 MVP 之后的能力。届时一个正在生成的 Session 对应一个 OMP Runtime，并由 Settings 限制最大并行数量；闲置 Session 不长期占用进程。

## 4. `@` 引用

输入框支持：

- `@file`
- `@folder`
- `@session`

`@diff` 随后续 Changes / Review / Diff 能力实现。

`@session` 默认引用会话摘要和关键消息。

不要直接把完整历史全部塞入上下文。

## 5. 对话与流式输出

对话区需要展示：

- Assistant 文本流。
- Thinking 流。
- Tool Call 状态。
- Permission 请求。
- 文件改动的简短摘要。
- 错误、重试和中断状态。

交互规则：

- 生成过程中展开一个连续的 Process，普通文字、Thinking 和工具操作保持原始顺序。
- 同一次工具调用的开始、进度、结果和错误显示为一个操作，不拆成多张卡片。
- 连续的读取、搜索、遍历等低价值上下文操作聚合显示，用户展开后仍可查看原始顺序。
- 回复结束后自动收起过程信息。
- 最终默认只突出 Assistant 的最终回答。
- 用户可以手动展开历史过程。
- Permission 等待时在对应工具操作的位置展开；处理后收起交互控件，但保留工具最终状态。
- 运行状态只控制状态提示、Spinner、Stop 和错误展示，不作为普通聊天消息。
- Agent 运行中再次发送的普通消息进入 Follow-up 队列，并按发送顺序逐条执行。
- MVP 不提供 Steer。Stop 结束当前任务并清空全部 Follow-up，当前被中止的用户消息放回输入框。
- 执行链未结束前，发送按钮持续显示 Stop；模型和 Thinking 等级不可切换。

## 6. 文件能力

文件树属于必要功能，但不是主界面中心。

MVP 支持：

- 浏览目录。
- 搜索文件。
- 将文件或目录加入上下文。
- 对 Markdown 文件链接和反引号包裹的有效路径提供 `Ctrl+点击`，交给系统文件管理器定位或打开。

Git Changes、Review 和 Diff 在 MVP 之后实现。

MVP 不做完整 IDE 能力：

- 不做应用内文件打开器、文本预览和编辑器。
- 不做复杂调试器。
- 不做大型插件市场。
- 不做完整语言工作台。
- 不复制 VS Code。

当前不规划应用内文件预览和编辑器；后续出现明确需求时再建立独立 TODO。

## 7. OMP 接入

MVP 优先通过 OMP RPC 接入：

```bash
omp --mode rpc
```

推荐进程结构：

```text
Electron Renderer
       │ IPC
Electron Main
       │ stdio JSONL
OMP RPC Process
```

复用 RPC 已有能力：

- Prompt 和流式事件。
- Session 切换。
- 历史消息。
- Model 和 Thinking 设置。
- Bash。
- Login。
- Abort。

MVP 不注册 Host Tools 或 Host URI。普通 Renderer 也不直接调用 RPC `bash`；Agent 自己的 Bash Tool 仍由 OMP Runtime 执行。

MVP 的单个 OMP Runtime 只能持有一个当前 AgentSession。Desktop 可管理多个 Session，但同一时间只允许当前 Session 生成。

MVP 之后可建立 Runtime 池：每个正在生成的 Session 使用独立 OMP RPC 进程，Settings 提供最大并行数量，达到上限时排队或提示用户处理。闲置 Session 只保留 Session 文件，不长期占用进程。

参考：

- <https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md>
- <https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md>

## 8. OMP Runtime 运行环境

Desktop 从图形启动器启动时，不能假设拥有用户终端中的完整环境。

Electron 启动 OMP 时，需要显式管理环境。

设置中提供 Runtime Environment Profile：

- Shell：bash、zsh、fish 或自定义路径。
- 环境来源：系统环境、Login Shell、自定义环境。
- PATH。
- 环境变量。
- Workspace 覆盖。
- 环境检测。

检测内容至少包括：

```text
which omp
which git
which node
which python
PATH
```

Runtime Environment Profile 只管理 Shell、PATH、普通环境变量和工作目录。代理由独立的 Runtime Network Profile 管理。

## 9. OMP Runtime 网络设置

OMP Desktop 不为 Electron 自身建立一套泛化代理。MVP 的网络设置用于生成 OMP Runtime 的启动环境。

用户不需要开启 v2rayN 的系统代理、TUN 或全局模式。

只要 v2rayN 提供本地 HTTP 或 SOCKS5 入站端口，Desktop 就可以在启动 OMP Runtime 时注入代理，无需修改操作系统的全局设置。

Runtime Network Profile 提供三种模式：

1. 不使用代理。
2. 使用系统代理。
3. 手动代理。

手动代理配置包括：

- 类型：HTTP、HTTPS 或 SOCKS5。
- Host。
- Port。
- 用户名和密码，可选。
- Bypass / NO_PROXY。

三种模式的解析规则：

- 不使用代理：从最终环境中显式移除大小写代理变量。
- 使用系统代理：保留 Desktop 启动环境中已有的大小写代理变量；未发现时明确报错，不静默直连。
- 手动代理：用用户输入的值覆盖继承的代理变量。

### 9.1 OMP Runtime 与 RPC Bash

Electron Main 在启动 `omp --mode rpc` 时，合并 Runtime Environment Profile 和 Runtime Network Profile，再通过 `spawn` 的 `env` 传入 OMP Runtime。

代理变量包括大小写形式：

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `ALL_PROXY`
- `NO_PROXY`
- `http_proxy`
- `https_proxy`
- `all_proxy`
- `no_proxy`

RPC 只负责传输命令和事件。Agent 的 Bash Tool 由 OMP Runtime 实际执行，其子进程默认继承 Runtime 的 PATH、普通环境变量和代理变量。

修改 Runtime Environment Profile 或 Runtime Network Profile 后，Desktop 必须重启 OMP Runtime，再恢复当前 Session。

### 9.2 内置 Terminal

Terminal 在 MVP 之后实现。PTY 是独立于 OMP Runtime 的 Shell 进程，不参与 Agent Bash Tool 执行。

Terminal 将拥有独立的环境与代理策略。它可以选择继承 Runtime Profile，也可选择不使用代理、使用系统代理或使用手动代理，不强制与 OMP Runtime 一致。

### 9.3 内置浏览器

Chromium Session 单独设置代理。

浏览器代理不能只依赖 OMP 子进程环境变量。

设置页按已实现能力提供连通性测试：

- OMP 模型接口。
- RPC `bash` 的最终环境和网络访问。
- Terminal 环境与网络访问（后续）。
- 内置浏览器（后续）。

MVP 不做内置浏览器。聊天中的 HTTP/HTTPS 链接通过 `Ctrl+点击` 交给系统默认浏览器；Extension 的 `open_url` 也直接使用系统默认浏览器。其他 URL 协议一律拒绝。

## 10. Browser Use

Browser Use 放在第二阶段。

目标能力：

- 内置浏览器。
- 地址栏和临时标签页。
- 页面截图。
- 点击、输入和滚动。
- 下载。
- 独立 Cookie Profile。
- 独立代理。

浏览器工具优先通过 OMP RPC Host Tools 接入。

不要先修改 OMP 核心。

## 11. Computer Use

Computer Use 放在 Browser Use 之后。

Ubuntu 首先考虑 Wayland。

需要处理：

- 屏幕捕获。
- 鼠标和键盘控制。
- 系统权限授权。
- 多显示器。
- 操作审计和紧急停止。

不要把仅支持 X11 的方案作为长期主路径。

## 12. MVP 范围

首个 Ubuntu 版本包含：

- Workspace 管理。
- 会话历史、搜索、置顶和归档。
- 流式聊天。
- Thinking 和 Tool Call 折叠卡片。
- Permission 审批。
- 文件树、文件搜索和上下文引用。
- 通过系统文件管理器定位文件或打开目录。
- Model 和 Thinking 设置。
- Runtime Environment Profile。
- Runtime Network Profile。
- `@file`、`@folder`、`@session`。
- OMP RPC 生命周期管理。

MVP 暂不包含：

- 完整 IDE。
- 插件市场。
- Computer Use。
- 完整 Browser Use。
- Changes / Review / Diff。
- 内置 Terminal。
- 应用内文件打开器、预览和编辑。
- 多 Session 并行运行。
- `@diff`。
- 复杂会话目录。
- 自研 Agent Runtime。

## 13. 实施顺序

### Phase 1：核心 Desktop

1. OMP RPC 进程管理。
2. Workspace 和 Session。
3. 流式对话。
4. Tool Call 和 Permission。
5. 文件树、搜索和上下文引用。
6. Runtime Environment Profile 和 Runtime Network Profile。

### Phase 2：Review 与 Terminal

1. Changed Files / Review 面板。
2. 按文件查看 Diff，并支持 Accept / Revert 与 Open in Editor。
3. 内置多标签 Terminal。

### Phase 2.5：多 Session 并行

1. 为每个正在生成的 Session 分配独立 OMP Runtime。
2. 在 Settings 中设置最大并行数量。
3. 达到上限时提供队列和明确提示。

### Phase 3：Browser Use

1. 内置浏览器。
2. Browser Host Tools。
3. 页面截图和交互。
4. Cookie、下载和代理隔离。

### Phase 4：Computer Use

1. Ubuntu Wayland 权限链路。
2. 屏幕理解。
3. 输入控制。
4. 安全停止和操作日志。

## 14. 设计原则

- 用户体验优先。
- 默认界面保持干净。
- 过程信息按需展开。
- 能复用就不重写。
- 先做最小闭环。
- 不提前构建完整 IDE。
- 不让系统全局代理成为联网前提。
