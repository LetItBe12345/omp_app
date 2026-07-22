import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PerformanceEntry, RendererLogEntry } from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { validateExternalUrl } from './external-url'
import { initializeLogger, log, recordMainPerformance } from './logger'
import { registerRuntimeIpc } from './runtime-ipc'
import { RuntimeDiagnostics } from './runtime-diagnostics'
import { RuntimeSupervisor } from './runtime-supervisor'
import { installNavigationSecurity, installSessionSecurity } from './security'

const development = Boolean(process.env['ELECTRON_RENDERER_URL'])
const smokeMode = process.argv.includes('--smoke')
let mainWindow: BrowserWindow | null = null
let smokeFinishing = false
let shutdownStarted = false

app.setName('OMP Desktop')
app.setPath('userData', join(app.getPath('appData'), 'OMP Desktop'))
app.setAppLogsPath()
initializeLogger()

const runtimePath = app.isPackaged
  ? join(process.resourcesPath, 'runtime', 'omp')
  : join(app.getAppPath(), 'runtime', 'omp')
const runtimeSupervisor = new RuntimeSupervisor({
  runtimePath,
  diagnostics: new RuntimeDiagnostics(join(app.getPath('logs'), 'runtime.log'))
})
const runtimeStatePath = join(app.getPath('userData'), 'runtime-state.json')
let persistedRuntimeState = ''

type PersistedRuntimeState = {
  workspacePath: string
  sessionPath?: string
}

async function persistRuntimeState(
  state: PersistedRuntimeState
): Promise<void> {
  const serialized = JSON.stringify(state)
  if (serialized === persistedRuntimeState) return
  persistedRuntimeState = serialized
  await writeFile(runtimeStatePath, serialized, {
    encoding: 'utf8',
    mode: 0o600
  })
}

async function restoreRuntimeState(): Promise<void> {
  const state = await readFile(runtimeStatePath, 'utf8')
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => null)
  if (!state || typeof state !== 'object' || Array.isArray(state)) return
  const workspacePath = (state as Record<string, unknown>)['workspacePath']
  const sessionPath = (state as Record<string, unknown>)['sessionPath']
  if (typeof workspacePath !== 'string') return

  try {
    await runtimeSupervisor.start(workspacePath)
    if (typeof sessionPath === 'string') {
      try {
        await runtimeSupervisor.restoreSessionPath(sessionPath)
      } catch (error) {
        log.warn('上次 Session 不可用，改为新建 Session', error)
        await runtimeSupervisor.newSession()
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

runtimeSupervisor.on('snapshot', (snapshot) => {
  if (!snapshot.workspacePath) return
  void persistRuntimeState({
    workspacePath: snapshot.workspacePath,
    ...(snapshot.sessionPath ? { sessionPath: snapshot.sessionPath } : {})
  }).catch((error: unknown) => log.error('保存 Runtime 状态失败', error))
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function registerIpc(): void {
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
    if (smokeMode) void finishSmoke()
  })
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
    process.stdout.write('OMP_SMOKE_READY\n', () => app.exit(0))
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
  void app.whenReady().then(() => {
    recordMainPerformance('app_ready')
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()
    registerRuntimeIpc(
      runtimeSupervisor,
      () => mainWindow,
      process.env['ELECTRON_RENDERER_URL']
    )
    if (!smokeMode) void restoreRuntimeState()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (shutdownStarted) return
  shutdownStarted = true
  void runtimeSupervisor
    .stop()
    .catch((error: unknown) => log.error('关闭 Runtime 失败', error))
    .finally(() => app.quit())
})
