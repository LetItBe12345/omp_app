import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 在应用设置 userData 和单实例锁之前隔离 appData，不改生产入口。
app.setPath('appData', join(process.env.OMP_E2E_ROOT, 'config'))
await import(
  pathToFileURL(join(process.env.OMP_E2E_ROOT, 'out/main/index.js')).href
)
