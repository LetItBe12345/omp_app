import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputPath = resolve(
  process.argv[2] ?? 'tests/artifacts/mvp-01-empty-state.png'
)

console.log('capture:boot')

void app.whenReady().then(async () => {
  console.log('capture:ready')

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f7f6',
    webPreferences: {
      preload: resolve('out/preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('capture:load-failed', code, description)
  })
  window.webContents.on('console-message', (details) => {
    console.log('capture:renderer', details.message)
  })

  await window.loadFile(resolve('out/renderer/index.html'))
  console.log('capture:loaded')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))

  const image = await window.webContents.capturePage()
  await writeFile(outputPath, image.toPNG())
  console.log('capture:saved', outputPath)
  window.destroy()
  app.quit()
})
