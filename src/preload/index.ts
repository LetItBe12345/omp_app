import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DesktopApi,
  ExtensionUiResponse,
  PerformanceEntry,
  RendererLogEntry,
  RuntimeEvent
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
  getWorkspaces: (offset) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaces, offset),
  activateWorkspace: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.activateWorkspace, workspaceId),
  setWorkspacePinned: (workspaceId, pinned) =>
    ipcRenderer.invoke(IPC_CHANNELS.setWorkspacePinned, workspaceId, pinned),
  removeWorkspace: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeWorkspace, workspaceId),
  listWorkspaceEntries: (
    workspaceId,
    relativeDirectory,
    offset,
    revision,
    priority
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.listWorkspaceEntries,
      workspaceId,
      relativeDirectory,
      offset,
      revision,
      priority
    ),
  searchWorkspaceEntries: (workspaceId, query) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchWorkspaceEntries, workspaceId, query),
  watchWorkspaceDirectories: (workspaceId, relativeDirectories) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.watchWorkspaceDirectories,
      workspaceId,
      relativeDirectories
    ),
  refreshWorkspaceDirectories: (workspaceId, relativeDirectories) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.refreshWorkspaceDirectories,
      workspaceId,
      relativeDirectories
    ),
  openWorkspaceEntry: (workspaceId, relativePath) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.openWorkspaceEntry,
      workspaceId,
      relativePath
    ),
  onWorkspaceFilesEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0]
    ) => listener(value)
    ipcRenderer.on(IPC_CHANNELS.workspaceFilesEvent, handler)
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.workspaceFilesEvent, handler)
  },
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
  resolveDroppedFiles: (workspaceId, files) => {
    const paths = files.map((file) => {
      try {
        return webUtils.getPathForFile(
          file as Parameters<typeof webUtils.getPathForFile>[0]
        )
      } catch {
        return ''
      }
    })
    return ipcRenderer.invoke(
      IPC_CHANNELS.resolveDroppedPaths,
      workspaceId,
      paths
    )
  },
  resolveWorkspaceReferences: (workspaceId, references) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.resolveWorkspaceReferences,
      workspaceId,
      references
    ),
  cancelPendingModelSelection: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelPendingModelSelection, sessionId),
  cancelProviderLogin: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelProviderLogin),
  followUp: (sessionId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.followUp, sessionId, input),
  getAvailableCommands: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getAvailableCommands),
  getRuntimeState: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeState),
  getMessages: () => ipcRenderer.invoke(IPC_CHANNELS.getMessages),
  getSessionMessages: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getSessionMessages, sessionId),
  getLoginProviders: () => ipcRenderer.invoke(IPC_CHANNELS.getLoginProviders),
  getAvailableModels: () => ipcRenderer.invoke(IPC_CHANNELS.getAvailableModels),
  getProviderLoginState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderLoginState),
  loginProvider: (providerId) =>
    ipcRenderer.invoke(IPC_CHANNELS.loginProvider, providerId),
  newSession: () => ipcRenderer.invoke(IPC_CHANNELS.newSession),
  createSession: (input, title, approvalMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.createSession, input, title, approvalMode),
  cancelQueuedSession: (temporarySessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelQueuedSession, temporarySessionId),
  selectTemporarySession: (temporarySessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectTemporarySession, temporarySessionId),
  openRuntimeLog: () => ipcRenderer.invoke(IPC_CHANNELS.openRuntimeLog),
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<boolean>,
  onRuntimeEvent: (listener: (event: RuntimeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RuntimeEvent) =>
      listener(value)
    ipcRenderer.on(IPC_CHANNELS.event, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler)
  },
  prompt: (sessionId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.prompt, sessionId, input),
  restartRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.restartRuntime),
  getRuntimeNetwork: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeNetwork),
  applyRuntimeNetwork: (config) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyRuntimeNetwork, config),
  getRuntimeSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSettings),
  applyRuntimeSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyRuntimeSettings, settings),
  detectRuntimeProxy: () => ipcRenderer.invoke(IPC_CHANNELS.detectRuntimeProxy),
  checkRuntimeProxyPort: (port) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkRuntimeProxyPort, port),
  getRuntimeEnvironmentDiagnostic: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getRuntimeEnvironmentDiagnostic),
  reopenProviderLoginUrl: () =>
    ipcRenderer.invoke(IPC_CHANNELS.reopenProviderLoginUrl),
  respondExtensionUi: (
    sessionId: string | null,
    id: string,
    response: ExtensionUiResponse
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.respondExtensionUi,
      sessionId,
      id,
      response
    ),
  revealPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealPath, path),
  validateLocalPath: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.validateLocalPath, path),
  selectModel: (sessionId, selection) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectModel, sessionId, selection),
  setThinkingLevel: (sessionId, level) =>
    ipcRenderer.invoke(IPC_CHANNELS.setThinkingLevel, sessionId, level),
  setApprovalMode: (sessionId, approvalMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.setApprovalMode, sessionId, approvalMode),
  stopCurrentRun: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.stopCurrentRun, sessionId),
  stopSession: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.stopSession, sessionId),
  switchSession: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.switchSession, sessionId),
  log: (entry: RendererLogEntry) => ipcRenderer.send(IPC_CHANNELS.log, entry),
  reportPerformance: (entry: PerformanceEntry) =>
    ipcRenderer.send(IPC_CHANNELS.performance, entry),
  rendererReady: () => ipcRenderer.send(IPC_CHANNELS.rendererReady)
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
