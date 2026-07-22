# 决策记录 01：Electron 工程骨架

- 对应任务：`TODO/done/01-electron-project-scaffold.md`
- 状态：已确认
- 确认日期：2026-07-22

## 工程与依赖

1. Node 固定主版本 24，而非某个补丁版本；使用 `.node-version` 和 `engines.node: ">=24 <25"`。
2. pnpm 固定为 `11.15.1`；使用 Corepack、精确 `packageManager` 字段并提交 lockfile。
3. 源码只建立 `src/main/`、`src/preload/`、`src/renderer/`、`src/shared/`；测试放在 `tests/`。
4. 使用 `@quick-start/create-electron@1.0.30` 的 `react-ts` 模板，在临时目录生成后最小迁入当前非空仓库。
5. 保留模板的稳定依赖组合和 Electron Vite 5，不使用 beta 依赖；实现后记录实际版本。
6. 项目使用 ESM，即 `package.json` 设置 `"type": "module"`。
7. 包名为 `omp-desktop`，用户可见名称为 `OMP Desktop`，初始版本为 `0.0.0`，并设置 `private: true`。
8. 删除模板 Demo、自动更新代码和 `@electron-toolkit/utils`；允许保留 `@electron-toolkit/tsconfig`。
9. 只使用官方 Electron 下载源，不配置国内镜像。
10. MVP-01 只生成和预览生产 bundle；`electron-builder`、AppImage 和安装包属于 MVP-07。
11. 开发环境启用 source map，生产构建不生成或分发 source map。

## 界面与样式

12. 设计图 `UI/16341.png` 是视觉基准：左一为 Workspace/对话概览，左二为文件树，右侧为对话主区。
13. 三栏必须能拖动调整宽度；使用 `react-resizable-panels`，不自研拖动算法。
14. 三栏默认比例为 `18/17/65`，最小宽度约为 `220/220/480px`；MVP-01 不做折叠和持久化。
15. Terminal、Changes、Review 和 Diff 不进入 MVP，也不在 MVP-01 放入口。
16. 生产模式使用真实空状态；开发演示数据只能通过 `OMP_UI_FIXTURE=1 pnpm dev` 显式启用，数据存放于 `tests/fixtures/`，生产构建忽略该开关。
17. 暂未实现但需要显示的控件使用禁用状态并解释原因，不提供无动作点击或虚假成功提示。
18. 使用 Tailwind CSS 4；布局、间距、颜色、字体、边框和状态用 Tailwind，Reset 补充、滚动条、拖动柄和复杂样式使用少量普通 CSS。
19. 使用语义化主题变量，避免大量任意值和动态拼接类名；MVP-01 只实现浅色主题，但变量命名允许以后扩展暗色主题。
20. 使用系统字体栈，系统已安装时优先 Inter；不使用 Google Fonts 或随包字体。
21. 使用 `lucide-react`，按图标单独导入。
22. MVP-01 不安装 Radix UI；第一个真实的复杂菜单、对话框或选择器出现时再引入。
23. 用户可见文案只提供简体中文并集中管理；MVP-01 不引入 i18n 框架。
24. 使用原生系统标题栏，不做无边框窗口和自定义窗口控制按钮。
25. 默认窗口为 `1440×900`，最小为 `1024×700`，居中、可调整大小并可最大化；本任务不持久化窗口状态。

## Electron 安全与生命周期

26. BrowserWindow 固定启用 `contextIsolation`、`sandbox`、`webSecurity`，并禁用 `nodeIntegration` 和 `webviewTag`。
27. 生产 CSP 保持严格；开发 CSP 只增加 Vite HMR 必需来源。
28. 所有浏览器权限默认拒绝。
29. 禁止 WebContents 自行导航和任意新窗口；只有经过 URL 解析、无嵌入凭据的 HTTP/HTTPS 地址可由 Main 调用系统浏览器打开。
30. `file:`、`javascript:`、`data:` 和自定义协议外链一律拒绝。
31. Preload 只暴露类型明确的 `openExternal`、日志和性能上报 API；不暴露通用 `invoke`、`send` 或 `ipcRenderer`。
32. MVP-01 不预先定义假的 Prompt、Abort 或 OMP RPC 接口，相关接口在 MVP-02 按真实协议添加。
33. 应用使用单实例锁；第二次启动只聚焦已有窗口。
34. 关闭 Ubuntu 主窗口即退出应用；未来 Agent 运行时先确认，再短超时有序终止 Runtime，必要时强制结束；不做托盘或后台驻留。
35. 使用 `show: false`、浅色背景和 `ready-to-show`，窗口实际显示时记录 `window_shown`。
36. 移除 Electron 默认应用菜单；保留操作系统常用快捷键。
37. DevTools 只在开发模式通过 F12 打开且不自动打开；生产模式设置 `devTools: false`，未来诊断开关另行设计。
38. MVP-01 不启动 `runtime/omp`，也不实现假的 RPC 或 Agent 状态。
39. Main 的 `uncaughtException` 写日志后退出；`unhandledRejection` 记录错误，不做无限自动重启。
40. Renderer 使用最小 Error Boundary，记录错误，用户界面不显示堆栈和本地路径，并提供重新加载。
41. 保持 React StrictMode；订阅和副作用必须清理，日志与性能点必须去重。

## 日志、性能与质量

42. 使用 `electron-log`；日志文件的最终写入只由 Main 完成，Renderer 通过类型化 Preload API 上报。
43. 日志使用 Electron 标准目录，开发环境同时输出控制台；实现时记录实际日志路径。
44. 日志不得包含密钥、代理凭据等秘密，不上传遥测。
45. 启动指标使用 `{ event, timestamp, elapsedMs }`；记录 `process_start`、`app_ready`、`window_created`、`dom_ready`、`first_paint`、`first_contentful_paint` 和 `window_shown`。
46. Renderer 使用 `performance.timeOrigin + performance.now()` 生成可与 Main 对齐的绝对时间。
47. TypeScript 启用 `strict`、`noUncheckedIndexedAccess`、`noFallthroughCasesInSwitch` 和 `noImplicitOverride`，不增加实验性高噪声选项。
48. 使用 ESLint flat config、稳定的 `jsx-a11y` 推荐规则、Prettier 和 `prettier-plugin-tailwindcss`。
49. 不引入 Husky、lint-staged 或 Git Hook。
50. 使用 Vitest；Renderer 使用 jsdom 和 React Testing Library，Main/Preload 的纯逻辑使用 Node 环境。
51. 使用 DOM 结构快照配合行为断言；优先覆盖结构、语义和稳定 `data-slot`，排除时间、随机值、大量历史和脆弱的完整 Tailwind 类字符串。
52. UI 验收包含 Ubuntu 手工截图对照，但不要求像素级一致，MVP-01 不引入 Playwright 截图测试。
53. 命令固定为 `dev`、`build`、`start`、`typecheck`、`lint`、`format`、`format:check`、`test`、`test:watch`、`check` 和 `smoke`。
54. `check` 包含类型检查、Lint、格式检查和测试；`smoke` 独立执行，不塞进 `check`。
55. `smoke` 启动生产 bundle，等待 Main 窗口和 Renderer 就绪后自动退出，设置超时且不启动 OMP；未来 CI 在 Xvfb 中执行。

## Session 并行边界

56. 一个 OMP Runtime 当前只有一个活动 `AgentSession`；`prompt` 不携带 Session ID，`switch_session` 会切换该 Runtime 的单例 Session。
57. MVP 可以保存、搜索和切换多个 Session，但同一时间只允许一个 Session 生成。
58. MVP 使用一个 Electron 应用实例、一个主窗口和一个长期 OMP Runtime。
59. 后续多 Session 并行采用“每个正在运行的 Session 一个 OMP Runtime”的方案，仍位于同一个 Electron 应用实例内。
60. 后续在 Settings 中提供最大并行 Session 数量；达到上限后进入队列或由用户选择如何处理。
61. 闲置 Session 只保留 OMP Session 文件，不长期占用 Runtime 进程。
