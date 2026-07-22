import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PerformanceEntry, RendererLogEntry } from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { validateExternalUrl } from './external-url'
import { initializeLogger, log, recordMainPerformance } from './logger'
import { installNavigationSecurity, installSessionSecurity } from './security'

const development = Boolean(process.env['ELECTRON_RENDERER_URL'])
const smokeMode = process.argv.includes('--smoke')
let mainWindow: BrowserWindow | null = null
let smokeFinishing = false

app.setName('OMP Desktop')
app.setPath('userData', join(app.getPath('appData'), 'OMP Desktop'))
app.setAppLogsPath()
initializeLogger()

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
      const image = await mainWindow.webContents.capturePage()
      await writeFile(screenshotPath, image.toPNG())
      log.info('Smoke 截图已保存', { screenshotPath })
    }
    process.stdout.write('OMP_SMOKE_READY\n')
    setTimeout(() => app.quit(), 100)
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => app.quit())
