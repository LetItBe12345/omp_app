# Playwright 基础端到端测试

使用真实 Electron 生产构建和 Playwright Electron API。用例位于 `tests/e2e/session.spec.mjs`。

## 运行

使用仓库要求的 Node 24 和 pnpm，先安装依赖：

```bash
pnpm install --frozen-lockfile
pnpm test:e2e
```

Linux 需要 X11 显示环境。无显示器或仅有 Wayland 时使用 Xvfb：

```bash
xvfb-run -a -s '-screen 0 1440x900x24' pnpm test:e2e
```

复用已经生成的构建，只运行单个用例：

```bash
xvfb-run -a pnpm exec playwright test -c tests/e2e/playwright.config.mjs -g '任务运行中取消'
```

无需下载 Playwright Chromium；测试使用项目安装的 Electron。

## 覆盖范围

| 用例         | 断言                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| 新建 Session | 输入和对话清空；发送首条消息后创建不同 ID；侧栏只有两个真实会话；活动会话保存到磁盘               |
| Agent 权限   | 标准、全部允许、严格三档切换；检查界面、磁盘偏好和 Runtime 重启参数；重载 Renderer 后保留严格权限 |
| 输入命令     | Slash 候选可见；命令原文通过 IPC 到达 RPC；结果显示，输入清空                                     |
| 运行中取消   | 运行态可见；停止按钮发送 `abort`；输入恢复；可以继续执行下一条命令                                |
| 删除 Session | 取消确认时保留；确认后从列表、磁盘和偏好中移除；可继续输入                                        |

新建测试还覆盖已绑定会话的临时侧栏条目被延迟恢复的竞态。

## 测试边界与隔离

Renderer、Preload、主进程 IPC、Runtime Supervisor/Pool、Session JSONL 文件和权限持久化均使用应用实现。目录选择器固定返回临时 Workspace。删除使用应用的真实废纸篓调用，确认框由 Playwright 接受或取消。

模型子进程替换为 `tests/fixtures/e2e-omp.mjs`。该进程实现测试所需的 RPC、命令目录和确定性响应，长任务只在收到 `abort` 后结束。不需要模型凭据，也不发送模型请求。测试不验证真实模型生成、工具执行或 OMP 二进制本身。

每个用例复制构建到独立临时目录，使用独立 appData、Workspace 和 XDG 数据目录。Session 文件写到应用按临时 Workspace 生成的独立目录，结束时删除。不会替换仓库中的 `runtime/omp` 或修改现有会话。

## 结果与诊断

HTML 报告位于 `tests/artifacts/e2e/report/`：

```bash
pnpm test:e2e:report
```

失败时保存截图、Trace、Runtime 事件和 RPC 记录。截图与 Trace 位于 `tests/artifacts/e2e/results/`，事件和 RPC 记录附在 HTML 报告中。产物已加入 Git 忽略规则。Vitest 不会运行这组 Playwright 用例。

Electron 自动化和目录选择器处理方式参考 [Playwright Electron API](https://playwright.dev/docs/api/class-electron)。
