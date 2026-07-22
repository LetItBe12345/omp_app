# MVP-01：Electron 工程骨架

- 状态：已完成
- 优先级：P0
- 前置任务：无
- 后续任务：MVP-02、MVP-06、MVP-07
- 决策记录：`decision/01-electron-project-scaffold.md`

## 目标

建立可启动、可构建、边界清晰的最小 Electron 工程，并交付与设计图一致的可调整三栏空壳。

## 明确不做

- 不启动 `runtime/omp`，不实现或伪造 RPC。
- 不引入 Vue、SolidJS、Radix UI、assistant-ui 或第二套前端框架。
- 不做 Terminal、Changes、Review/Diff、Browser、Computer Use、多窗口或插件系统。
- 不配置 `electron-builder`、安装包、自动更新或国内镜像。
- 不复制 OpenCode 的完整 Monorepo，不在 Main 中实现 Agent 业务。

## 任务清单

### 工程初始化

- [x] 用 `@quick-start/create-electron@1.0.30` 的 `react-ts` 模板在临时目录生成工程，只迁入必需文件。
- [x] 使用 Node 24；添加 `.node-version`，并把 `engines.node` 设为 `>=24 <25`。
- [x] 使用 pnpm `11.15.1`；固定 `packageManager`，通过 Corepack 使用，并提交 lockfile。
- [x] 使用 ESM；设置包名 `omp-desktop`、产品名 `OMP Desktop`、版本 `0.0.0` 和 `private: true`。
- [x] 只建立 `src/main/`、`src/preload/`、`src/renderer/`、`src/shared/` 和 `tests/`。
- [x] 保留脚手架的稳定依赖组合和 Electron Vite 5，不使用 beta 版本。
- [x] 删除模板 Demo、更新器和 `@electron-toolkit/utils`；可保留 `@electron-toolkit/tsconfig`。
- [x] 记录脚手架、核心依赖和四个外部参考仓库的实际版本或 commit。

### 命令与构建

- [x] 提供 `dev`、`build`、`start`、`typecheck`、`lint`、`format`、`format:check`、`test`、`test:watch`、`check` 和 `smoke` 命令。
- [x] `check` 依次执行类型检查、Lint、格式检查和测试；`smoke` 独立执行。
- [x] `build` 只生成 Main、Preload、Renderer 的生产 bundle；`start` 预览生产 bundle。
- [x] 开发环境启用 source map，生产 bundle 不生成或分发 source map。

### 窗口与生命周期

- [x] 使用原生系统标题栏；窗口默认 `1440×900`、最小 `1024×700`、居中并允许调整与最大化。
- [x] 使用 `show: false` 和浅色 `backgroundColor`；收到 `ready-to-show` 后显示并记录 `window_shown`。
- [x] 使用 `requestSingleInstanceLock`；第二次启动时聚焦已有窗口。
- [x] 使用 `Menu.setApplicationMenu(null)` 移除默认菜单，同时保留系统级常用快捷键。
- [x] DevTools 仅开发模式允许用 F12 打开，不自动打开；生产模式设置 `devTools: false`。
- [x] Ubuntu 关闭窗口时直接退出；若未来有 Agent 运行则先确认、有序停止并在短超时后强制结束。本任务不实现托盘或后台驻留。
- [x] Main 捕获未处理异常并写日志；`uncaughtException` 后退出，`unhandledRejection` 记录错误，不做无限重启。

### 安全边界

- [x] 设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`、`webviewTag: false`。
- [x] 生产使用严格 CSP；开发只增加 Vite HMR 所需来源。
- [x] 默认拒绝所有浏览器权限请求。
- [x] 禁止窗口内导航和任意 `window.open`；只允许 Main 校验后用系统浏览器打开无凭据的 HTTP/HTTPS URL。
- [x] 拒绝 `file:`、`javascript:`、`data:` 和自定义协议外链。
- [x] Preload 只暴露类型明确的 `openExternal`、日志和性能记录 API，不暴露通用 `invoke`、`send` 或 `ipcRenderer`。
- [x] Renderer 不直接访问文件系统、子进程和 OMP stdio。

### 最小界面

- [x] 对照 `UI/16341.png`：左一为 Workspace/对话概览，左二为文件树，右侧为对话主区。
- [x] 使用 `react-resizable-panels` 支持拖动调整三栏宽度，不自研尺寸算法。
- [x] 默认比例为 `18/17/65`，三栏最小宽度约为 `220/220/480px`；本任务不做折叠和布局持久化。
- [x] 用户消息靠右并使用极浅灰背景；Assistant 消息靠左，不使用气泡和头像。
- [x] 生产模式显示真实空状态，不填充虚假 Workspace、Session、文件或消息。
- [x] 仅 `OMP_UI_FIXTURE=1 pnpm dev` 可载入 `tests/fixtures/` 的开发演示数据；生产构建忽略该开关。
- [x] 尚未实现但需要展示的控件保持禁用并说明原因，不提供无动作点击或虚假成功状态。
- [x] 使用 Tailwind CSS 4 管理布局、间距、颜色、字体、边框和状态；少量普通 CSS 处理 Reset、滚动条、拖动柄和复杂样式。
- [x] 建立语义化主题变量，避免大量任意值和动态拼接类名；本任务只实现浅色主题。
- [x] 使用系统字体栈，已安装时优先 Inter；不下载或打包字体。
- [x] 使用 `lucide-react` 并按图标单独导入；本任务不安装 Radix UI。
- [x] 用户可见文案只提供简体中文并集中管理，不引入 i18n 框架。
- [x] 添加最小 React Error Boundary：记录错误，向用户隐藏堆栈和路径，并提供重新加载。
- [x] 保持 React StrictMode，副作用需清理，日志和性能点需去重。

### 日志与启动指标

- [x] 使用 `electron-log`，最终文件写入只在 Main 发生；Renderer 通过 Preload 上报。
- [x] 使用 Electron 标准日志目录，开发模式同时输出控制台，并记录实际日志路径。
- [x] 日志不得包含密钥、代理凭据或其他秘密。
- [x] 使用 `{ event, timestamp, elapsedMs }` 记录 `process_start`、`app_ready`、`window_created`、`dom_ready`、`first_paint`、`first_contentful_paint` 和 `window_shown`。
- [x] Renderer 用 `performance.timeOrigin + performance.now()` 与 Main 的绝对时间对齐；不上传遥测。

### 工程质量与验证

- [x] TypeScript 启用 `strict`、`noUncheckedIndexedAccess`、`noFallthroughCasesInSwitch` 和 `noImplicitOverride`。
- [x] 使用 ESLint flat config，并加入稳定的 `jsx-a11y` 推荐规则。
- [x] 使用 Prettier 和 `prettier-plugin-tailwindcss`；不引入 Husky、lint-staged 或 Git Hook。
- [x] 使用 Vitest、jsdom 和 React Testing Library；Main/Preload 的纯逻辑测试使用 Node 环境。
- [x] 为稳定外壳添加 DOM 结构快照和行为断言；优先断言结构、语义和稳定 `data-slot`，不包含时间、随机值、大量历史或脆弱的完整 Tailwind 类字符串。
- [x] 在 Ubuntu 手工比对截图；不要求像素级一致，本任务不引入 Playwright 截图测试。
- [x] `smoke` 启动生产 bundle，等待 Main 窗口和 Renderer 就绪后自动退出；设置超时且不启动 OMP。

## 完成条件

- [x] Ubuntu 下 `pnpm dev` 可启动，窗口只有一个实例且可正常退出。
- [x] `pnpm build` 和 `pnpm start` 可生成并启动生产 bundle。
- [x] `pnpm check` 与独立的 `pnpm smoke` 通过。
- [x] Renderer 无 Node.js 直接权限，权限、导航和外链策略通过测试。
- [x] 三栏宽度可拖动，最小宽度生效，布局与产品文档和设计图一致。
- [x] 生产模式只加载空壳 UI，不启动 OMP、Terminal、Browser 或大型编辑器。
- [x] 启动指标和 Main/Renderer 日志可在开发和生产模式定位。

## 维护记录

- 脚手架：`@quick-start/create-electron@1.0.30` / `react-ts`
- Node：24（`>=24 <25`）
- pnpm：`11.15.1`
- 验证 Node：`24.18.0`
- 日志路径：`~/.config/OMP Desktop/logs/main.log`
- 完成日期：2026-07-22
- 关键依赖实际版本：Electron `39.8.10`、Electron Vite `5.0.0`、React `19.2.7`、Vite `7.3.6`、Tailwind CSS `4.3.3`、Vitest `4.1.10`
- OpenCode commit：`5f241f1cc1fc0c266044b64bf9e860d4e37c9c1f`
- assistant-ui commit：`6c652b972c30a47745baeafe608a65426dd68668`
- ohmypi-craft commit：`1671920dffe31aee58fc60ba57268cb94abe1776`
- Oh My Pi commit：`89d6a8f6d14286f32f09ec9c8aa8af7b3451d2d6`
