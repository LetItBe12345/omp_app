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

采用三栏结构：

```text
┌── 项目与会话 ──┬────── 对话主区 ──────┬── 上下文面板 ──┐
│ Workspace       │ 用户消息              │ Changes        │
│ 会话列表         │ Assistant 输出        │ Files          │
│ 搜索与新建       │ Thinking / Tool Call  │ Terminal       │
│                 │ Permission / Diff     │ Browser 后续   │
└────────────────┴───────────────────────┴────────────────┘
```

明确规则：

- 聊天记录放左侧。
- 不把历史聊天做成顶部浏览器标签。
- 顶部标签只用于当前打开的文件、Diff、终端或网页。
- 文件树放右侧上下文面板。
- 右侧默认可折叠，避免长期占用聊天空间。

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
- 多会话并行运行。

## 4. `@` 引用

输入框支持：

- `@file`
- `@folder`
- `@session`
- `@diff`

`@session` 默认引用会话摘要和关键消息。

不要直接把完整历史全部塞入上下文。

## 5. 对话与流式输出

对话区需要展示：

- Assistant 文本流。
- Thinking 流。
- Tool Call 状态。
- Permission 请求。
- 文件改动和 Diff。
- 错误、重试和中断状态。

交互规则：

- 生成过程中展开 Thinking 和 Tool Call。
- 回复结束后自动收起过程信息。
- 最终默认只突出 Assistant 的最终回答。
- 用户可以手动展开历史过程。

## 6. 文件能力

文件树属于必要功能，但不是主界面中心。

MVP 支持：

- 浏览目录。
- 搜索文件。
- 打开文件。
- 文本预览。
- 简单编辑和保存。
- Git 状态。
- Diff 查看。
- 将文件或目录加入上下文。

MVP 不做完整 IDE 能力：

- 不做复杂调试器。
- 不做大型插件市场。
- 不做完整语言工作台。
- 不复制 VS Code。

编辑器优先选择轻量方案，例如 CodeMirror 6。

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
- Host Tools。
- Host URI。

每个运行中的会话可以拥有独立 OMP RPC 进程。

闲置会话只保留 Session 文件，不长期占用进程。

参考：

- <https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md>
- <https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md>

## 8. Terminal 与运行环境

Desktop 从图形启动器启动时，不能假设拥有用户终端中的完整环境。

Electron 启动 OMP 和 Terminal 时，需要显式管理环境。

设置中提供 Environment Profile：

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
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
NO_PROXY
```

内置 Terminal 和 OMP 进程应使用同一份 Environment Profile。

## 9. 应用级代理

OMP Desktop 必须支持应用级代理。

用户不需要开启 v2rayN 的系统代理、TUN 或全局模式。

只要 v2rayN 提供本地 HTTP 或 SOCKS5 入站端口，应用即可使用代理。

设置提供三种模式：

1. 不使用代理。
2. 使用系统代理。
3. 手动代理。

手动代理配置包括：

- 类型：HTTP、HTTPS 或 SOCKS5。
- Host。
- Port。
- 用户名和密码，可选。
- Bypass / NO_PROXY。

代理必须同时覆盖三条链路：

### 9.1 OMP 进程

启动 OMP RPC 子进程时注入：

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `ALL_PROXY`
- `NO_PROXY`

### 9.2 内置 Terminal

Terminal 使用相同环境变量。

这样 `git`、`curl`、`npm`、`pip` 等命令不依赖系统全局代理。

### 9.3 内置浏览器

Chromium Session 单独设置代理。

浏览器代理不能只依赖 OMP 子进程环境变量。

设置页提供“测试代理”功能，分别测试：

- OMP 模型接口。
- GitHub。
- Terminal 环境。
- 内置浏览器。

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
- 文件树和文件预览。
- 简单编辑。
- Diff 审查。
- 内置 Terminal。
- Model 和 Thinking 设置。
- Environment Profile。
- 应用级代理。
- `@file`、`@folder`、`@session`、`@diff`。
- OMP RPC 生命周期管理。

MVP 暂不包含：

- 完整 IDE。
- 插件市场。
- Computer Use。
- 完整 Browser Use。
- 复杂会话目录。
- 自研 Agent Runtime。

## 13. 实施顺序

### Phase 1：核心 Desktop

1. OMP RPC 进程管理。
2. Workspace 和 Session。
3. 流式对话。
4. Tool Call 和 Permission。
5. 文件树、预览和 Diff。
6. Terminal。
7. Environment Profile 和应用级代理。

### Phase 2：Browser Use

1. 内置浏览器。
2. Browser Host Tools。
3. 页面截图和交互。
4. Cookie、下载和代理隔离。

### Phase 3：Computer Use

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
