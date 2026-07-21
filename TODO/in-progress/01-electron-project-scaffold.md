# MVP-01：Electron 工程骨架

- 状态：未开始
- 优先级：P0
- 前置任务：无
- 后续任务：MVP-02、MVP-05、MVP-06

## 目标

建立可启动、可构建、边界清晰的最小 Electron 工程。

## 明确不做

- 不引入 Vue、SolidJS 或第二套前端框架。
- 不先做 Browser、Computer Use、多窗口或插件系统。
- 不复制 OpenCode 的完整 Monorepo。
- 不在 Main 中实现 Agent 业务。

## 任务清单

### 工程初始化

- [ ] 使用 `electron-vite` 创建 Electron + React + TypeScript 工程。
- [ ] 确定并固定包管理器及 Node 版本。
- [ ] 配置开发、构建、类型检查和测试命令。
- [ ] 只建立 MVP 必需目录：Main、Preload、Renderer、共享类型和测试。
- [ ] 记录外部参考仓库实际使用的 commit。

### 安全边界

- [ ] 启用 `contextIsolation`。
- [ ] 禁用 Renderer 的 `nodeIntegration`。
- [ ] Preload 只暴露有限、类型明确的 API。
- [ ] Renderer 不直接访问文件系统、子进程和 OMP stdio。
- [ ] 外部链接统一由 Main 校验后打开。

### 最小界面

- [ ] 按 `UI/16341.png` 建立三栏基础布局。
- [ ] 左侧放 Workspace 和会话。
- [ ] 中间放对话主区。
- [ ] 右侧放可折叠上下文面板。
- [ ] 用户消息靠右，使用极浅灰背景。
- [ ] Assistant 消息靠左，不使用气泡和头像。
- [ ] Terminal、编辑器和 Diff 先保留懒加载入口，不加载实现。

### 工程质量

- [ ] 配置 TypeScript 严格模式。
- [ ] 配置最小 ESLint 和格式检查。
- [ ] 加入基础单元测试框架。
- [ ] 加入 `process_start`、`app_ready`、`window_created`、`dom_ready`、`first_paint` 记录点。
- [ ] 开发模式和生产模式都能定位日志。

## 完成条件

- [ ] Ubuntu 下可以运行开发模式。
- [ ] 可以生成生产构建产物。
- [ ] 类型检查和基础测试通过。
- [ ] Renderer 无 Node.js 直接权限。
- [ ] 首屏只加载空壳 UI，不启动 Terminal、Browser 或大型编辑器。
- [ ] 界面布局与产品文档和设计图一致。

## 复用重点

- OpenCode `packages/desktop/`：窗口、日志、Sidecar 和打包结构。
- assistant-ui：后续聊天原语，不在本任务提前接入完整功能。
- Radix UI：弹窗、菜单、选择器等基础交互。
- `react-resizable-panels`：三栏尺寸和折叠。

## 维护记录

- 选择的脚手架版本：未填写
- Node 版本：未填写
- 包管理器：未填写
- 关键参考 commit：未填写
