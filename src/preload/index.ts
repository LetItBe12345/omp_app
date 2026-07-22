import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopApi,
  PerformanceEntry,
  RendererLogEntry
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<boolean>,
  log: (entry: RendererLogEntry) => ipcRenderer.send(IPC_CHANNELS.log, entry),
  reportPerformance: (entry: PerformanceEntry) =>
    ipcRenderer.send(IPC_CHANNELS.performance, entry),
  rendererReady: () => ipcRenderer.send(IPC_CHANNELS.rendererReady)
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
