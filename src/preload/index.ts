import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopApi,
  ExtensionUiResponse,
  PerformanceEntry,
  RendererLogEntry,
  RuntimeEvent
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
  getWorkspaces: (offset) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaces, offset),
  activateWorkspace: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.activateWorkspace, workspaceId),
  setWorkspacePinned: (workspaceId, pinned) =>
    ipcRenderer.invoke(IPC_CHANNELS.setWorkspacePinned, workspaceId, pinned),
  removeWorkspace: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeWorkspace, workspaceId),
  listSessions: (workspaceId, offset, query) =>
    ipcRenderer.invoke(IPC_CHANNELS.listSessions, workspaceId, offset, query),
  setSessionPinned: (workspaceId, sessionId, pinned) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setSessionPinned,
      workspaceId,
      sessionId,
      pinned
    ),
  setSessionArchived: (workspaceId, sessionId, archived) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setSessionArchived,
      workspaceId,
      sessionId,
      archived
    ),
  renameSession: (workspaceId, sessionId, title) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.renameSession,
      workspaceId,
      sessionId,
      title
    ),
  deleteSession: (workspaceId, sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSession, workspaceId, sessionId),
  getContextCandidates: (workspaceId, query) =>
    ipcRenderer.invoke(IPC_CHANNELS.getContextCandidates, workspaceId, query),
  cancelPendingModelSelection: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelPendingModelSelection),
  cancelProviderLogin: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelProviderLogin),
  followUp: (input) => ipcRenderer.invoke(IPC_CHANNELS.followUp, input),
  getRuntimeState: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeState),
  getMessages: () => ipcRenderer.invoke(IPC_CHANNELS.getMessages),
  getLoginProviders: () => ipcRenderer.invoke(IPC_CHANNELS.getLoginProviders),
  getAvailableModels: () => ipcRenderer.invoke(IPC_CHANNELS.getAvailableModels),
  getProviderLoginState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderLoginState),
  loginProvider: (providerId) =>
    ipcRenderer.invoke(IPC_CHANNELS.loginProvider, providerId),
  newSession: () => ipcRenderer.invoke(IPC_CHANNELS.newSession),
  createSession: (input, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.createSession, input, title),
  openRuntimeLog: () => ipcRenderer.invoke(IPC_CHANNELS.openRuntimeLog),
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<boolean>,
  onRuntimeEvent: (listener: (event: RuntimeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RuntimeEvent) =>
      listener(value)
    ipcRenderer.on(IPC_CHANNELS.event, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler)
  },
  prompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.prompt, input),
  restartRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.restartRuntime),
  reopenProviderLoginUrl: () =>
    ipcRenderer.invoke(IPC_CHANNELS.reopenProviderLoginUrl),
  respondExtensionUi: (id: string, response: ExtensionUiResponse) =>
    ipcRenderer.invoke(IPC_CHANNELS.respondExtensionUi, id, response),
  revealPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealPath, path),
  selectModel: (selection) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectModel, selection),
  setThinkingLevel: (level) =>
    ipcRenderer.invoke(IPC_CHANNELS.setThinkingLevel, level),
  stopCurrentRun: () => ipcRenderer.invoke(IPC_CHANNELS.stopCurrentRun),
  switchSession: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.switchSession, sessionId),
  log: (entry: RendererLogEntry) => ipcRenderer.send(IPC_CHANNELS.log, entry),
  reportPerformance: (entry: PerformanceEntry) =>
    ipcRenderer.send(IPC_CHANNELS.performance, entry),
  rendererReady: () => ipcRenderer.send(IPC_CHANNELS.rendererReady)
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
