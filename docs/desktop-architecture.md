# OMP Desktop 架构与性能原则

## 1. 目标

OMP Desktop 是 Oh My Pi 的桌面宿主。

首发平台：

- Ubuntu / Linux
- 后续支持 macOS

核心目标：

- 启动快
- 空闲资源低
- 安装体积可控
- 界面简单
- 最大限度复用 OMP Runtime、RPC 和已有 Web 组件

不在 Desktop 中重新实现 Agent Loop、模型调用、工具系统和会话系统。

## 2. 技术选择

MVP 使用：

- Electron
- React
- TypeScript
- OMP RPC 模式

不同时引入 React 和 Vue。

选择 React 的原因：OMP 现有 `collab-web` 已使用 React，并复用了 `@oh-my-pi/pi-wire`。继续使用 React 能减少重复实现和协议类型转换。

## 3. 四层架构

逻辑上只分四层：

```text
React Renderer
      ↓ Electron IPC
Preload Bridge
      ↓ Electron IPC
Electron Main
      ↓ JSONL over stdin/stdout
OMP Runtime
```

这四层已经足够支撑 MVP。

不要为了形式完整，再增加通用 Controller、Service、Repository 等层。

## 4. 各层职责

### 4.1 React Renderer

Renderer 是展示层。

负责：

- 对话界面
- 文件树
- 设置界面
- 模型与 Thinking Level 选择
- 流式消息展示
- 工具调用状态展示
- Terminal 和 Browser 的界面容器
- 前端交互状态

Renderer 不直接：

- 启动子进程
- 访问完整文件系统
- 持有 Node.js 权限
- 直接读写 OMP stdin/stdout
- 实现 Agent Runtime

### 4.2 Preload Bridge

Preload 是受控接口层。

负责：

- 通过 `contextBridge` 暴露有限 API
- 将 Renderer 请求发送给 Main
- 将 Main 事件订阅能力暴露给 Renderer
- 隔离 Renderer 与 Node/Electron 高权限能力

示意接口：

```ts
window.omp.prompt(message)
window.omp.followUp(message)
window.omp.stopCurrentRun()
window.omp.switchSession(sessionId)
window.omp.onEvent(listener)
```

Preload 使用命令专用方法，不暴露通用 `rpc(command)`，也不向普通 Renderer 暴露 RPC `bash`、Host Tool 或 Host URI。

Preload 不保存业务状态，也不运行复杂逻辑。

### 4.3 Electron Main

Main 不只是 Gateway。

它包含三个职责。

#### Gateway

负责协议转发：

- Renderer 请求转为 OMP RPC 命令
- OMP RPC 事件转发给 Renderer
- 维护请求 ID 和响应关联
- 处理 RPC 连接状态

#### Runtime Supervisor

负责 OMP 进程生命周期：

- 启动 `omp --mode rpc`
- 传入工作目录和环境变量
- 等待 `ready` 事件
- 监控退出和崩溃
- 应用关闭时终止 OMP
- 避免无意启动多个 Runtime

#### OS Host

负责需要桌面权限的能力：

- 创建和管理窗口
- 文件选择器
- 系统菜单
- 通知
- 剪贴板
- 外部链接
- 自动更新
- Terminal PTY 生命周期
- BrowserWindow 或 WebContents 生命周期

因此准确关系是：

> Electron Main = Gateway + Runtime Supervisor + OS Host

Main 应保持薄。它不实现 Agent 业务。

### 4.4 OMP Runtime

OMP Runtime 是 Agent 核心。

MVP 通过下面的方式启动：

```bash
omp --mode rpc
```

OMP Runtime 负责：

- Agent Loop
- 模型调用
- Thinking
- 工具调用
- 文件读写
- Bash 执行
- Session 管理
- 消息和工具事件流
- Compaction、Retry 和中断

RPC 不是 Runtime。

准确关系是：

- OMP 是 Runtime
- RPC 是 Main 与 OMP 之间的通信协议

OMP RPC 当前使用 stdin/stdout 上的 JSONL。

## 5. 一次请求的完整路径

```text
用户输入
  ↓
React Renderer
  ↓ Electron IPC
Preload Bridge
  ↓ Electron IPC
Electron Main
  ↓ stdin JSONL
OMP Runtime
  ↓ stdout JSONL events
Electron Main
  ↓ Electron IPC
React Renderer
  ↓
流式更新界面
```

示例 RPC 命令：

```json
{ "id": "req-1", "type": "prompt", "message": "分析这个项目" }
```

典型事件：

- `ready`
- `agent_start`
- `message_start`
- `message_update`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `message_end`
- `agent_end`

Main 只负责转发和生命周期管理。

## 6. 状态归属

状态必须有明确归属。

### Renderer 持有

- 当前界面布局
- 展开或收起状态
- 当前可见消息
- 输入框状态
- 临时滚动位置

### Main 持有

- 窗口状态
- OMP 子进程状态
- RPC 请求表
- 当前工作目录
- 系统级配置
- Terminal 和 Browser 实例
- 尚未完成的 Extension UI 请求

### OMP Runtime 持有

- Agent 状态
- Session 状态
- 消息历史
- 当前模型
- Thinking Level
- 工具状态
- Compaction 和 Retry 状态

不要在三处重复维护同一份 Agent 状态。

Renderer 需要恢复状态时，应向 OMP 请求 `get_state` 或 `get_messages`。

Follow-up 队列只由 OMP Runtime 在内存中持有。Desktop 不保存恢复副本；Runtime 重启或崩溃时，未执行的 Follow-up 可以丢失。

## 7. 进程模型

MVP 推荐：

```text
1 个 Electron 应用
1 个主窗口
1 个 Renderer
1 个长期运行的 OMP RPC 进程
```

不要为每个 Conversation 启动一个 OMP 进程。

多个对话通过 OMP 的 Session 能力切换：

- `new_session`
- `switch_session`
- `get_messages`
- `branch`

Terminal 和 Browser 按需创建。

未打开时不占用对应资源。

单个 OMP Runtime 当前只有一个活动 `AgentSession`。RPC `prompt` 不携带 Session ID，`switch_session` 会切换这个单例，因此 MVP 虽能保存和切换多个 Session，同一时间只能有一个 Session 生成。

MVP 之后如需多 Session 并行，采用 Runtime 池：每个正在生成的 Session 对应一个 OMP RPC 进程，事件和生命周期以 Session ID 路由。Settings 控制最大并行数量，达到上限后排队或提示用户处理。闲置 Session 只保留 Session 文件，不占用进程。

### 7.1 OMP Runtime 环境与网络

MVP 不为 Electron 自身建立泛化代理层。Desktop 是 OMP Runtime 配置的控制面：Main 在启动 `omp --mode rpc` 时生成并注入最终 `env`。

配置分为两个独立模型：

- Runtime Environment Profile：Shell、PATH、普通环境变量和 Workspace 工作目录。
- Runtime Network Profile：不使用代理、使用系统代理或使用手动 HTTP/HTTPS/SOCKS5 代理。

启动 Runtime 时的合并顺序：

```text
系统基础环境
+ Runtime Environment Profile
+ Runtime Network Profile
= OMP Runtime 最终 env
```

“不使用代理”必须显式移除大小写的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 和 `NO_PROXY` 等变量，不能只是停止写入。

RPC 只传输命令和事件。OMP Runtime 实际执行 Agent Bash Tool，它启动的 Shell 子进程默认继承 Runtime 的最终环境。

修改任一 Profile 后，Main 必须重启 OMP Runtime，然后通过 OMP Session 恢复当前会话。

后续的内置 Terminal 是独立 PTY 进程，不参与 Agent Bash Tool 执行。Terminal 和 Browser 分别拥有自己的代理适配，不强制与 OMP Runtime 使用同一策略。

## 8. 性能问题的本质

Electron 应用差异主要不来自 Electron 本身，也不来自是否使用 RPC。

真正的差异来自：

- 启动时加载了多少能力
- 常驻多少进程和 WebContents
- RPC 消息是否过碎
- React 更新是否过于频繁
- 是否重复解析完整对话
- 是否递归扫描完整项目
- 是否过早加载大型组件
- 打包时是否包含无用依赖和资源

RPC 本身不是主要瓶颈。

高频小 RPC 加高频 UI 重绘才是瓶颈。

## 9. 从第一天执行的性能规则

### 9.1 先显示窗口，再初始化能力

启动顺序：

```text
创建窗口
→ 显示基础 UI
→ 恢复或选择有效 Workspace
→ 启动 OMP
→ 等待 ready
→ 用户操作时再加载 Terminal、Browser 和大型组件
```

禁止在首屏前：

- 递归扫描完整项目
- 加载完整会话历史
- 启动 Browser
- 启动 Terminal
- 加载大型编辑器
- 初始化所有可选能力

Runtime 自动恢复不得阻塞首屏。默认在 Renderer 完成首次绘制并报告 `renderer_ready` 后，再恢复 Workspace、Session 并启动 OMP。是否改为与首屏并行启动，必须比较 `first_paint`、`interactive_ready` 和 `omp_ready` 后决定；发生冲突时优先保证基础窗口可以快速显示和操作。

### 9.2 合并流式事件

不要每收到一个 token 就触发一次 React 更新。

推荐：

```text
OMP message_update
→ 写入内存 buffer
→ 每 16–33 ms 合并
→ 更新当前 assistant message
```

工具进度也要限频。

不要将完整消息列表反复通过 IPC 发送。

消息开始/结束、工具开始/结束、错误和 Extension UI 请求不做延迟合并。单条 RPC JSONL 帧设置 16 MiB 硬上限，防止异常输出耗尽 Main 内存。

高频事件批次不能只设置时间窗口，还要设置最大事件数量和累计字节数。达到时间、数量或字节数任一上限就立即发送，具体阈值通过高频文本和大型 Tool 输出测试确定。

### 9.3 只更新当前消息

流式输出时：

- 只修改当前 assistant message
- 不重新生成整个对话数组
- 不重新解析全部 Markdown
- 已完成消息使用缓存

Renderer 不长期保存完整 RPC 原始事件。历史恢复和实时事件都转换成同一种消息渲染投影；`OmpEventReducer`、React 状态和 assistant-ui Runtime 之间不得分别保存完整消息副本。

Markdown、代码高亮和 Tool 输出缓存必须有数量或内存上限。原始事件处理后释放；不可见且能够从 OMP Session 恢复的数据可以从缓存淘汰。图片不得在 Prompt 输入、IPC 参数和消息状态中长期保留多份 Base64 副本。

### 9.4 对话和文件树虚拟化

对话：

- 只渲染视口附近消息
- 长对话不保留全部 DOM

文件树：

- 展开目录时再读取
- 不在启动时递归扫描
- 遵守 `.gitignore`
- 文件事件合并和防抖

### 9.5 大型能力延迟加载

以下能力必须按需加载：

- 完整模型管理和 Provider 授权界面
- Markdown 渲染和代码高亮
- Terminal
- Browser
- 代码编辑器
- PDF 渲染
- Diff 高亮
- 图表

只拆分明显较大且首屏不需要的能力，不把每个小控件拆成独立 chunk。构建后检查首屏 chunk 的组成，防止未使用的大型依赖进入首屏。

### 9.6 Main 不做重计算

Main 禁止承担：

- Markdown 解析
- 完整项目索引
- 大文本转换
- 同步文件 I/O
- Agent 状态计算

重任务放入 OMP Runtime、Worker 或 Renderer 的受控模块。

### 9.7 默认使用 GPU

Linux 默认保留硬件加速。

不要为了少数驱动问题，全局关闭 GPU。

提供需要重启生效的图形兼容模式，但不在一次 GPU 进程异常后自动永久关闭硬件加速。兼容模式必须在 `app.ready` 前生效，并提供 `--disable-gpu` 启动参数，供黑屏时从窗口外进入应用。

应用记录当前显示协议、兼容模式、Electron/Chromium 版本、GPU Feature Status 和 GPU 进程异常，不记录不必要的用户设备信息。Headless 软件渲染 Smoke 只验证应用能启动，不能替代真实 GPU 验收。

重点测试：

- Ubuntu Wayland
- Ubuntu X11
- Intel 核显
- AMD 显卡
- NVIDIA 驱动

## 10. 打包原则

- Renderer、Preload 和 Main 分别 bundle
- 生产包不包含测试文件和开发依赖
- 不包含无用 source map
- OMP 二进制按平台和架构分发
- 不在单个安装包中同时放入多平台二进制
- 可选大型资源不进入首屏 bundle
- 使用 ASAR 管理应用代码

安装包大小不是唯一指标。

还要同时关注：

- 解压后大小
- 首屏 JS 大小
- 空闲内存
- 空闲 CPU
- OMP 启动耗时
- 首 token 延迟

## 11. 性能指标

从 MVP 开始记录：

```text
process_start
app_ready
window_created
dom_ready
first_paint
renderer_ready
interactive_ready
runtime_start
omp_ready
prompt_sent
first_token
```

初始预算：

- 空闲 CPU 小于 1%
- 主线程单次任务小于 50 ms
- 首屏 Renderer JS 小于 700 KB gzip
- 空闲内存不超过空 Electron 基线加 80 MB
- 安装包不超过空 Electron、OMP 二进制和 25 MB 应用增量之和

这些预算是回归线，不是最终承诺。

CI 应记录每次构建的变化趋势。冷启动和热启动分开测量，多次运行取中位数；CI 主要发现明显回归，启动和真实 GPU 结果以固定机器为准。

内存至少分开记录 Electron Main、Renderer、GPU/Utility 进程和 OMP Runtime。空闲内存在启动完成并稳定一段时间后测量；流式场景分别记录开始、持续输出、结束和恢复空闲后的内存。

## 12. MVP 边界

第一阶段只实现：

- 一个主窗口
- 一个 OMP RPC 进程
- 对话输入和流式输出
- Thinking 和 Tool Call 状态
- Session 创建、切换和恢复
- 同一时间只允许当前 Session 生成
- 基础文件树
- 文件和目录上下文引用
- 基础设置
- OMP Runtime 环境与网络配置

暂缓：

- Changes / Review / Diff
- 内置 Terminal
- 内置 Browser
- 应用内文件打开器、预览和编辑
- Computer Use
- 多窗口
- 插件市场
- 完整 IDE
- 复杂工作区索引
- 多 Runtime 的 Session 并行

先保证主链路稳定和快速。

## 13. 最终判断

OMP Desktop 的核心不是重新实现 OMP。

它是一个轻量桌面宿主：

```text
React 负责展示
Preload 负责安全接口
Electron Main 负责网关、进程和系统能力
OMP Runtime 负责 Agent
```

四层足够。

架构优化重点不是增加层数，而是控制边界、启动工作量、进程数量和渲染频率。

## 14. 参考

- OMP RPC: <https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md>
- OMP SDK: <https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md>
- OMP collab-web: <https://github.com/can1357/oh-my-pi/tree/main/packages/collab-web>
- Electron Performance: <https://www.electronjs.org/docs/latest/tutorial/performance>
- Electron Process Model: <https://www.electronjs.org/docs/latest/tutorial/process-model>
