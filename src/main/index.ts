import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell
} from 'electron'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { PerformanceEntry, RendererLogEntry } from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { isApprovalMode } from '../shared/approval-mode'
import { validateExternalUrl } from './external-url'
import { initializeLogger, log, recordMainPerformance } from './logger'
import { DesktopStateStore } from './desktop-state'
import { registerRuntimeIpc } from './runtime-ipc'
import { RuntimeDiagnostics } from './runtime-diagnostics'
import { RuntimeSupervisor } from './runtime-supervisor'
import { RuntimeEnvironmentResolver } from './runtime-environment'
import { listWorkspaceSessions } from './session-catalog'
import { installNavigationSecurity, installSessionSecurity } from './security'
import { configureLinuxFileChooser } from './linux-file-chooser'
import { configureLinuxInputMethod } from './linux-input-method'
import { registerWorkspaceFilesIpc } from './workspace-files'

const development = Boolean(process.env['ELECTRON_RENDERER_URL'])
const runtimeSmokeMode = process.argv.includes('--runtime-smoke')
const smokeMode = process.argv.includes('--smoke') || runtimeSmokeMode
const setupProviderMode = process.argv.includes('--setup-provider')
const supportedCliFlags = new Set([
  '--version',
  '--disable-gpu',
  '--no-sandbox',
  '--setup-provider',
  '--smoke',
  '--runtime-smoke'
])
function isSupportedCliArg(arg: string): boolean {
  return (
    supportedCliFlags.has(arg) ||
    arg === '--ozone-platform=x11' ||
    arg === '--ozone-platform=wayland'
  )
}
const unknownCliArgs = process.argv
  .slice(1)
  .filter((arg) => arg.startsWith('--') && !isSupportedCliArg(arg))
let mainWindow: BrowserWindow | null = null
let smokeFinishing = false
let shutdownStarted = false
let cleanupWorkspaceFiles: (() => void) | undefined
let runtimeRestorePromise: Promise<void> | null = null

configureLinuxFileChooser(app.commandLine)
const linuxInputMethod = configureLinuxInputMethod(app.commandLine)
app.setName('OMP Desktop')
app.setPath('userData', join(app.getPath('appData'), 'OMP Desktop'))
app.setAppLogsPath()
initializeLogger()
log.info('Linux 输入法配置', { backend: linuxInputMethod })

const runtimePath = app.isPackaged
  ? join(process.resourcesPath, 'runtime', 'omp')
  : join(__dirname, '../../runtime/omp')
const runtimeSupervisor = new RuntimeSupervisor({
  runtimePath,
  diagnostics: new RuntimeDiagnostics(join(app.getPath('logs'), 'runtime.log'))
})
const runtimeEnvironmentResolver = new RuntimeEnvironmentResolver(runtimePath)
const runtimeStatePath = join(app.getPath('userData'), 'runtime-state.json')
const desktopStateStore = new DesktopStateStore(
  join(app.getPath('userData'), 'desktop-state.json'),
  runtimeStatePath
)

function runProviderSetup(): void {
  const setupProfile = process.env['OMP_DESKTOP_SETUP_PROFILE']
  const child = spawn(
    runtimePath,
    setupProfile ? ['--profile', setupProfile] : [],
    {
      cwd: process.cwd(),
      env: { ...process.env, OMP_DESKTOP_PROVIDER_SETUP: '1' },
      stdio: 'inherit'
    }
  )
  child.once('error', (error) => {
    log.error('启动 Provider 配置失败', error)
    app.exit(1)
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      log.error('Provider 配置被信号终止', { signal })
      app.exit(1)
      return
    }
    app.exit(code ?? 1)
  })
}

async function restoreRuntimeState(): Promise<void> {
  const state = desktopStateStore.state
  if (!state.activeWorkspaceId) return
  const workspace = state.workspaces.find(
    (item) => item.id === state.activeWorkspaceId
  )
  if (!workspace) return

  try {
    const storedMode = workspace.activeSessionId
      ? desktopStateStore.sessionPreference(
          workspace.id,
          workspace.activeSessionId
        ).approvalMode
      : undefined
    const approvalMode = isApprovalMode(storedMode) ? storedMode : 'yolo'
    if (workspace.activeSessionId && !storedMode) {
      runtimeSupervisor.recordDiagnostic(
        `Session 权限缺失或无效，按 yolo 补存: session=${workspace.activeSessionId}`
      )
      await desktopStateStore
        .updateSessionPreference(workspace.id, workspace.activeSessionId, {
          approvalMode: 'yolo'
        })
        .catch((error: unknown) => log.warn('补存 Session 默认权限失败', error))
    }
    const resolved = await runtimeEnvironmentResolver.resolve(
      desktopStateStore.runtimeNetworkConfig()
    )
    runtimeSupervisor.recordDiagnostic(
      resolved.sourceError
        ? 'Login Shell 环境探测失败，已使用 Electron 启动环境'
        : 'Login Shell 环境探测成功'
    )
    await runtimeSupervisor.start(workspace.path, resolved.env, approvalMode)
    if (workspace.activeSessionId) {
      try {
        const sessions = await listWorkspaceSessions(
          workspace.id,
          workspace.path
        )
        const session = sessions.find(
          (item) =>
            item.id === workspace.activeSessionId &&
            item.compatibility !== 'corrupt' &&
            item.compatibility !== 'future'
        )
        if (!session) throw new Error('上次 Session 不存在')
        runtimeSupervisor.trustSession(session.id, session.path)
        await runtimeSupervisor.switchSession(session.id)
      } catch (error) {
        log.warn('上次 Session 不可用，改为新建 Session', error)
        const staleSessionId = workspace.activeSessionId
        if (staleSessionId)
          await desktopStateStore
            .clearActiveSessionIfMatches(workspace.id, staleSessionId)
            .catch((persistError: unknown) =>
              log.warn('清理失效的活动 Session 失败', persistError)
            )
        const snapshot = await runtimeSupervisor.newSession()
        if (snapshot.sessionId) {
          await desktopStateStore.updateSessionPreference(
            workspace.id,
            snapshot.sessionId,
            { approvalMode }
          )
          await desktopStateStore.setActiveSession(
            workspace.id,
            snapshot.sessionId
          )
        }
        const window = mainWindow
        if (window && !window.isDestroyed()) {
          void dialog.showMessageBox(window, {
            type: 'info',
            title: 'OMP Desktop',
            message: '上次会话不可用，已新建会话。',
            buttons: ['知道了'],
            defaultId: 0,
            noLink: true
          })
        }
      }
    }
  } catch (error) {
    log.warn('恢复上次 Runtime 状态失败', error)
  }
}

const standaloneCliMode =
  setupProviderMode || process.argv.includes('--version')
const hasSingleInstanceLock =
  standaloneCliMode || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.copyText, async (_event, value: unknown) => {
    if (typeof value !== 'string') return false
    clipboard.writeText(value)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, value: unknown) => {
    if (typeof value !== 'string') return false
    const url = validateExternalUrl(value)
    if (!url) return false
    await shell.openExternal(url.toString())
    return true
  })

  ipcMain.on(IPC_CHANNELS.log, (_event, entry: RendererLogEntry) => {
    if (!entry || typeof entry.message !== 'string') return
    const level = entry.level in log ? entry.level : 'info'
    log[level](`[Renderer] ${entry.message}`, entry.context ?? {})
  })

  ipcMain.on(IPC_CHANNELS.performance, (_event, entry: PerformanceEntry) => {
    if (!entry || typeof entry.event !== 'string') return
    log.info('performance', entry)
  })

  ipcMain.on(IPC_CHANNELS.rendererReady, () => {
    if (runtimeSmokeMode) void finishRuntimeSmoke()
    else if (smokeMode) void finishSmoke()
  })
}

async function finishRuntimeSmoke(): Promise<void> {
  try {
    const deadline = Date.now() + 30_000
    while (!runtimeRestorePromise) {
      if (Date.now() >= deadline)
        throw new Error('Runtime smoke 等待恢复任务超时')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await runtimeRestorePromise
    if (runtimeSupervisor.snapshot.status !== 'ready') {
      throw new Error(
        `Runtime smoke 启动失败：${runtimeSupervisor.snapshot.error?.message ?? '未知错误'}`
      )
    }
    await finishSmoke()
  } catch (error) {
    log.error('Runtime smoke 失败', error)
    app.exit(1)
  }
}

async function finishSmoke(): Promise<void> {
  if (smokeFinishing) return
  smokeFinishing = true

  try {
    const screenshotPath = process.env['OMP_SMOKE_SCREENSHOT']
    if (screenshotPath && mainWindow) {
      const rendererState = (await mainWindow.webContents.executeJavaScript(`({
        hasAppShell: Boolean(document.querySelector('[data-slot="app-shell"]')),
        rootHtml: document.getElementById('root')?.innerHTML.slice(0, 1000) ?? '',
        bodyText: document.body.innerText.slice(0, 500)
      })`)) as {
        hasAppShell: boolean
        rootHtml: string
        bodyText: string
      }
      if (!rendererState.hasAppShell) {
        log.error('Smoke 未找到应用外壳', rendererState)
        throw new Error('Renderer 未渲染应用外壳')
      }
      const image = await mainWindow.webContents.capturePage()
      await writeFile(screenshotPath, image.toPNG())
      log.info('Smoke 截图已保存', { screenshotPath })
    }
    const gpuAcceptancePath = process.env['OMP_GPU_ACCEPTANCE_OUTPUT']
    if (gpuAcceptancePath) {
      const gpuInfo = await app
        .getGPUInfo('complete')
        .catch((error: unknown) => ({ error: String(error) }))
      await writeFile(
        gpuAcceptancePath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            featureStatus: app.getGPUFeatureStatus(),
            gpuInfo
          },
          null,
          2
        ) + '\n'
      )
    }
    if (runtimeSmokeMode) await runtimeSupervisor.stop()
    const marker = runtimeSmokeMode
      ? 'OMP_RUNTIME_SMOKE_READY'
      : 'OMP_SMOKE_READY'
    process.stdout.write(`${marker}\n`, () => app.exit(0))
  } catch (error) {
    log.error('Smoke 收尾失败', error)
    app.exit(1)
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'OMP Desktop',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    show: smokeMode,
    backgroundColor: '#f7f7f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: development
    }
  })

  mainWindow = window
  let allowWindowClose = false
  recordMainPerformance('window_created')
  installSessionSecurity(window.webContents.session, development)
  installNavigationSecurity(window.webContents)

  window.webContents.on('console-message', (details) => {
    const level =
      details.level === 'error'
        ? 'error'
        : details.level === 'warning'
          ? 'warn'
          : 'info'
    log[level](`[Renderer console] ${details.message}`, {
      line: details.lineNumber,
      source: details.sourceId
    })
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error('Preload 加载失败', { preloadPath, error })
  })

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      log.error('Renderer 页面加载失败', {
        errorCode,
        errorDescription,
        validatedURL
      })
    }
  )

  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer 进程退出', details)
  })

  window.once('ready-to-show', () => {
    window.show()
    recordMainPerformance('window_shown')
  })

  window.on('closed', () => {
    mainWindow = null
  })

  window.on('close', (event) => {
    const runtime = runtimeSupervisor.snapshot
    if (
      allowWindowClose ||
      (!runtime.isStreaming && runtime.queuedMessageCount === 0)
    ) {
      return
    }

    event.preventDefault()
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: 'OMP Desktop',
        message: '任务正在运行，仍要退出吗？',
        detail: '退出后任务将停止。',
        buttons: ['继续运行', '退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      .then(({ response }) => {
        if (response !== 1) return
        allowWindowClose = true
        window.destroy()
      })
  })

  window.webContents.on('before-input-event', (event, input) => {
    if (development && input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault()
      window.webContents.toggleDevTools()
    }
  })

  if (development && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

process.on('uncaughtException', (error) => {
  log.error('Main 未捕获异常', error)
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log.error('Main 未处理 Promise 拒绝', reason)
})

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    if (unknownCliArgs.length > 0) {
      console.error(`未知参数：${unknownCliArgs.join(' ')}`)
      app.exit(2)
      return
    }
    if (process.argv.includes('--version')) {
      console.log(app.getVersion())
      app.exit(0)
      return
    }
    if (setupProviderMode) {
      runProviderSetup()
      return
    }
    recordMainPerformance('app_ready')
    Menu.setApplicationMenu(null)
    await desktopStateStore.load()
    registerIpc()
    createWindow()
    registerRuntimeIpc(
      runtimeSupervisor,
      desktopStateStore,
      () => mainWindow,
      process.env['ELECTRON_RENDERER_URL'],
      runtimeEnvironmentResolver
    )
    cleanupWorkspaceFiles = registerWorkspaceFilesIpc(
      desktopStateStore,
      () => mainWindow,
      process.env['ELECTRON_RENDERER_URL'],
      undefined,
      runtimeSupervisor
    )
    if (!smokeMode || runtimeSmokeMode)
      runtimeRestorePromise = restoreRuntimeState()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (shutdownStarted) return
  shutdownStarted = true
  cleanupWorkspaceFiles?.()
  cleanupWorkspaceFiles = undefined
  void runtimeSupervisor
    .stop()
    .catch((error: unknown) => log.error('关闭 Runtime 失败', error))
    .finally(() => app.quit())
})
