export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type RendererLogEntry = {
  level: LogLevel
  message: string
  context?: Record<string, boolean | number | string | null>
}

export type PerformanceEntry = {
  event:
    'dom_ready' | 'first_paint' | 'first_contentful_paint' | 'renderer_ready'
  timestamp: number
  elapsedMs: number
}

export type RuntimeStatus =
  'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'

export type ApprovalMode = 'always-ask' | 'write' | 'yolo'

export type ToolApprovalStatus =
  'pending' | 'approved' | 'auto-approved' | 'denied' | 'cancelled' | 'invalid'

export type ToolApprovalRequest = {
  id: string
  summary: string
  status: ToolApprovalStatus
  deadline: number
}

export type RuntimeErrorCode =
  | 'RUNTIME_NOT_READY'
  | 'OMP_UNCONFIGURED'
  | 'START_FAILED'
  | 'CRASHED'
  | 'RPC_TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'WORKSPACE_UNAVAILABLE'
  | 'STATE_WRITE_FAILED'
  | 'SESSION_INCOMPATIBLE'
  | 'UNSUPPORTED'

export type RuntimeError = {
  code: RuntimeErrorCode
  message: string
  retryable: boolean
}

export type DesktopResult<T> =
  { ok: true; data: T } | { ok: false; error: RuntimeError }

export type RuntimeSnapshot = {
  status: RuntimeStatus
  workspacePath?: string
  sessionId?: string
  sessionName?: string
  sessionPath?: string
  isStreaming: boolean
  queuedMessageCount: number
  model?: string
  thinkingLevel?: string
  approvalMode?: ApprovalMode
  approvalModeChanging?: boolean
  approvalModeSaved?: boolean
  runtimeVersion?: string
  toolApprovals?: ToolApprovalRequest[]
  compatibilityNotice?: string
  isAuthenticating?: boolean
  pendingModelSelection?: ModelSelection
  diagnosticSummary?: string[]
  error?: RuntimeError
}

export type SessionRuntimePhase =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting-interaction'
  | 'stopping'
  | 'idle'
  | 'failed'

export type SessionRuntimeState = {
  runtimeInstanceId: string
  generation: number
  workspacePath?: string
  sessionId?: string
  phase: SessionRuntimePhase
  snapshot: RuntimeSnapshot
  queuePosition?: number
  temporary?: boolean
  visible?: boolean
  temporaryInput?: PromptInput
  pendingExtensionUi?: OmpEvent[]
}

export type RuntimeNetworkMode = 'off' | 'auto' | 'manual'

export type RuntimeNetworkConfig = {
  mode: RuntimeNetworkMode
  manualPort?: number
}

export type RuntimeNetworkStatus = {
  config: RuntimeNetworkConfig
  source: 'login-shell' | 'electron-fallback'
  result: 'direct' | 'http-proxy' | 'unsupported-socks'
  proxySource?: string
  error?: string
}

export type RuntimeSettings = {
  defaultNetwork: RuntimeNetworkConfig
  maxParallelSessions: number
  runningSessions: number
  waitingSessions: number
}

export type RuntimeToolDiagnostic = {
  name: 'omp' | 'git' | 'node' | 'python'
  path?: string
  version?: string
  error?: string
}

export type RuntimeEnvironmentDiagnostic = {
  shell: string
  path: string
  workspace?: string
  source: 'login-shell' | 'electron-fallback'
  sourceError?: string
  tools: RuntimeToolDiagnostic[]
  network: RuntimeNetworkStatus
  copyText: string
}

export type LoginProvider = {
  id: string
  name: string
  available: boolean
  authenticated: boolean
}

export type AvailableModel = {
  provider: string
  id: string
  name: string
  reasoning: boolean
  thinking?: {
    efforts: string[]
    defaultLevel?: string
  }
}

export type AvailableSlashCommandSource =
  'builtin' | 'skill' | 'extension' | 'custom' | 'mcp_prompt' | 'file'

export type AvailableSlashSubcommand = {
  name: string
  description?: string
  usage?: string
}

export type AvailableSlashCommand = {
  name: string
  aliases?: string[]
  description?: string
  input?: {
    hint?: string
  }
  subcommands?: AvailableSlashSubcommand[]
  source: AvailableSlashCommandSource
}

export type ModelSelection = {
  provider: string
  modelId: string
  thinkingLevel?: string
}

export type ProviderLoginState = {
  status:
    | 'idle'
    | 'starting'
    | 'opening-browser'
    | 'waiting-input'
    | 'progress'
    | 'cancelling'
    | 'failed'
  providerId?: string
  message?: string
  instructions?: string
  canReopenBrowser?: boolean
  input?: {
    id: string
    sessionId?: string
    message: string
    placeholder?: string
  }
}

export type OmpEvent = {
  type: string
  [key: string]: unknown
}

export type PromptInput = {
  message: string
  references?: ContextReference[]
  images?: Array<{
    type: 'image'
    data: string
    mimeType: string
  }>
}

export type WorkspaceSummary = {
  id: string
  path: string
  name: string
  available: boolean
  pinned: boolean
  addedAt: string
  lastUsedAt: string
  unreadCompletion?: boolean
}

export type SessionSummary = {
  id: string
  workspaceId: string
  path: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  size: number
  pinned: boolean
  archived: boolean
  unreadCompletion?: boolean
  compatibility: 'v1' | 'v2' | 'v3' | 'corrupt' | 'future'
  status:
    'complete' | 'interrupted' | 'aborted' | 'error' | 'pending' | 'unknown'
}

export type WorkspaceOverview = {
  activeWorkspaceId?: string
  workspaces: WorkspaceSummary[]
  hasMore: boolean
}

export type WorkspaceActivation = {
  workspace: WorkspaceSummary
  snapshot: RuntimeSnapshot
}

export type SessionPage = {
  sessions: SessionSummary[]
  hasMore: boolean
  nextOffset: number
}

export type CreatedSession = {
  snapshot: RuntimeSnapshot
  session?: SessionSummary
}

export type QueuedSessionSubmission = {
  temporarySessionId: string
  queuePosition?: number
}

export type ContextCandidate = {
  id: string
  kind: 'file' | 'folder' | 'session'
  name: string
  detail: string
  relativePath?: string
  sessionId?: string
  size?: number
}

export type ContextReference = {
  id: string
  kind: 'file' | 'folder' | 'session'
  name: string
  relativePath?: string
  sessionId?: string
}

export type WorkspaceEntry = {
  id: string
  kind: 'file' | 'folder'
  name: string
  relativePath: string
  expandable: boolean
  symbolicLink: boolean
  linkStatus?: 'internal' | 'external' | 'broken' | 'cycle'
}

export type WorkspaceEntryList = {
  entries: WorkspaceEntry[]
  total: number
  offset: number
  limit: number
  revision: number
  workspaceVersion: number
  hasMore: boolean
}

export type WorkspaceSearchResult = {
  entries: WorkspaceEntry[]
  truncated: boolean
  workspaceVersion: number
}

export type WorkspaceWatchState = {
  workspaceId: string
  workspaceVersion: number
  watchedDirectories: number
  limited: boolean
}

export type WorkspaceRefreshState = {
  workspaceVersion: number
  revisions: Record<string, number>
}

export type WorkspaceFilesEvent =
  | {
      type: 'directory-invalidated'
      workspaceId: string
      workspaceVersion: number
      relativeDirectory: string
      revision: number
    }
  | {
      type: 'watch-state'
      workspaceId: string
      workspaceVersion: number
      watchedDirectories: number
      limited: boolean
      error?: string
    }

export type DroppedReferenceResult = {
  references: ContextReference[]
  rejectedCount: number
}

export type DraftRecord = {
  text: string
  references: ContextReference[]
  updatedAt: string
}

export type RuntimeEvent =
  | { type: 'snapshot'; snapshot: RuntimeSnapshot }
  | { type: 'session-runtime'; state: SessionRuntimeState }
  | { type: 'pool-snapshot'; states: SessionRuntimeState[] }
  | {
      type: 'temporary-session-bound'
      temporarySessionId: string
      snapshot: RuntimeSnapshot
      session?: SessionSummary
      active: boolean
    }
  | {
      type: 'temporary-session-failed'
      temporarySessionId: string
      input: PromptInput
      error: RuntimeError
      reason: 'cancelled' | 'start-failed' | 'runtime-crashed'
    }
  | { type: 'workspace-activation-failed'; error: RuntimeError }
  | { type: 'provider-login'; state: ProviderLoginState }
  | { type: 'omp-event'; event: OmpEvent }
  | { type: 'omp-event-batch'; events: OmpEvent[] }

export type ExtensionUiResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true; timedOut?: boolean }

export type Unsubscribe = () => void

export type DesktopApi = {
  copyText(text: string): Promise<boolean>
  openExternal(url: string): Promise<boolean>
  openRuntimeLog(): Promise<boolean>
  revealPath(path: string): Promise<boolean>
  validateLocalPath(path: string): Promise<boolean>
  chooseWorkspace(): Promise<DesktopResult<WorkspaceActivation | null>>
  getWorkspaces(offset?: number): Promise<DesktopResult<WorkspaceOverview>>
  activateWorkspace(
    workspaceId: string
  ): Promise<DesktopResult<RuntimeSnapshot>>
  setWorkspacePinned(
    workspaceId: string,
    pinned: boolean
  ): Promise<DesktopResult<WorkspaceOverview>>
  removeWorkspace(workspaceId: string): Promise<DesktopResult<void>>
  listWorkspaceEntries(
    workspaceId: string,
    relativeDirectory?: string,
    offset?: number,
    revision?: number,
    priority?: 'interactive' | 'background'
  ): Promise<DesktopResult<WorkspaceEntryList>>
  searchWorkspaceEntries(
    workspaceId: string,
    query: string
  ): Promise<DesktopResult<WorkspaceSearchResult>>
  watchWorkspaceDirectories(
    workspaceId: string,
    relativeDirectories: string[]
  ): Promise<DesktopResult<WorkspaceWatchState>>
  refreshWorkspaceDirectories(
    workspaceId: string,
    relativeDirectories: string[]
  ): Promise<DesktopResult<WorkspaceRefreshState>>
  openWorkspaceEntry(
    workspaceId: string,
    relativePath: string
  ): Promise<DesktopResult<boolean>>
  onWorkspaceFilesEvent(
    listener: (event: WorkspaceFilesEvent) => void
  ): Unsubscribe
  listSessions(
    workspaceId: string,
    offset?: number,
    query?: string
  ): Promise<DesktopResult<SessionPage>>
  setSessionPinned(
    workspaceId: string,
    sessionId: string,
    pinned: boolean
  ): Promise<DesktopResult<void>>
  setSessionArchived(
    workspaceId: string,
    sessionId: string,
    archived: boolean
  ): Promise<DesktopResult<void>>
  renameSession(
    workspaceId: string,
    sessionId: string,
    title: string
  ): Promise<DesktopResult<void>>
  deleteSession(
    workspaceId: string,
    sessionId: string
  ): Promise<DesktopResult<void>>
  getContextCandidates(
    workspaceId: string,
    query: string
  ): Promise<DesktopResult<ContextCandidate[]>>
  resolveDroppedFiles(
    workspaceId: string,
    files: readonly unknown[]
  ): Promise<DesktopResult<DroppedReferenceResult>>
  resolveWorkspaceReferences(
    workspaceId: string,
    references: ContextReference[]
  ): Promise<DesktopResult<DroppedReferenceResult>>
  getRuntimeState(): Promise<DesktopResult<RuntimeSnapshot>>
  getMessages(): Promise<DesktopResult<unknown>>
  getSessionMessages(sessionId: string): Promise<DesktopResult<unknown>>
  getAvailableCommands(): Promise<DesktopResult<AvailableSlashCommand[]>>
  getLoginProviders(): Promise<DesktopResult<LoginProvider[]>>
  getAvailableModels(): Promise<DesktopResult<AvailableModel[]>>
  getProviderLoginState(): Promise<DesktopResult<ProviderLoginState>>
  loginProvider(providerId: string): Promise<DesktopResult<void>>
  cancelProviderLogin(): Promise<DesktopResult<void>>
  reopenProviderLoginUrl(): Promise<DesktopResult<boolean>>
  restartRuntime(): Promise<DesktopResult<RuntimeSnapshot>>
  getRuntimeNetwork(): Promise<DesktopResult<RuntimeNetworkStatus>>
  applyRuntimeNetwork(
    config: RuntimeNetworkConfig
  ): Promise<DesktopResult<RuntimeNetworkStatus>>
  getRuntimeSettings(): Promise<DesktopResult<RuntimeSettings>>
  applyRuntimeSettings(settings: {
    defaultNetwork: RuntimeNetworkConfig
    maxParallelSessions: number
  }): Promise<DesktopResult<RuntimeSettings>>
  detectRuntimeProxy(): Promise<DesktopResult<RuntimeNetworkStatus>>
  checkRuntimeProxyPort(port: number): Promise<DesktopResult<boolean>>
  getRuntimeEnvironmentDiagnostic(): Promise<
    DesktopResult<RuntimeEnvironmentDiagnostic>
  >
  prompt(sessionId: string, input: PromptInput): Promise<DesktopResult<void>>
  followUp(sessionId: string, input: PromptInput): Promise<DesktopResult<void>>
  stopCurrentRun(sessionId: string): Promise<DesktopResult<PromptInput | null>>
  stopSession(sessionId: string): Promise<DesktopResult<PromptInput | null>>
  newSession(): Promise<DesktopResult<RuntimeSnapshot>>
  createSession(
    input: PromptInput,
    title: string,
    approvalMode: ApprovalMode
  ): Promise<DesktopResult<QueuedSessionSubmission>>
  cancelQueuedSession(
    temporarySessionId: string
  ): Promise<DesktopResult<PromptInput>>
  selectTemporarySession(
    temporarySessionId: string
  ): Promise<DesktopResult<RuntimeSnapshot>>
  switchSession(sessionId: string): Promise<DesktopResult<RuntimeSnapshot>>
  setApprovalMode(
    sessionId: string,
    approvalMode: ApprovalMode
  ): Promise<DesktopResult<RuntimeSnapshot>>
  selectModel(
    sessionId: string,
    selection: ModelSelection
  ): Promise<DesktopResult<RuntimeSnapshot>>
  cancelPendingModelSelection(
    sessionId: string
  ): Promise<DesktopResult<RuntimeSnapshot>>
  setThinkingLevel(
    sessionId: string,
    level: string
  ): Promise<DesktopResult<void>>
  respondExtensionUi(
    sessionId: string | null,
    id: string,
    response: ExtensionUiResponse
  ): Promise<DesktopResult<void>>
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): Unsubscribe
  log(entry: RendererLogEntry): void
  reportPerformance(entry: PerformanceEntry): void
  rendererReady(): void
}

export const IPC_CHANNELS = {
  copyText: 'desktop:copy-text',
  chooseWorkspace: 'runtime:choose-workspace',
  getWorkspaces: 'workspace:list',
  activateWorkspace: 'workspace:activate',
  setWorkspacePinned: 'workspace:set-pinned',
  removeWorkspace: 'workspace:remove',
  listWorkspaceEntries: 'workspace:entries',
  searchWorkspaceEntries: 'workspace:search',
  watchWorkspaceDirectories: 'workspace:watch-directories',
  refreshWorkspaceDirectories: 'workspace:refresh-directories',
  openWorkspaceEntry: 'workspace:open-entry',
  workspaceFilesEvent: 'workspace:files-event',
  listSessions: 'session:list',
  setSessionPinned: 'session:set-pinned',
  setSessionArchived: 'session:set-archived',
  renameSession: 'session:rename',
  deleteSession: 'session:delete',
  getContextCandidates: 'context:candidates',
  resolveDroppedPaths: 'context:resolve-dropped-paths',
  resolveWorkspaceReferences: 'context:resolve-workspace-references',
  cancelPendingModelSelection: 'runtime:cancel-pending-model-selection',
  cancelProviderLogin: 'runtime:cancel-provider-login',
  event: 'runtime:event',
  followUp: 'runtime:follow-up',
  getAvailableCommands: 'runtime:get-available-commands',
  getMessages: 'runtime:get-messages',
  getSessionMessages: 'runtime:get-session-messages',
  getLoginProviders: 'runtime:get-login-providers',
  getAvailableModels: 'runtime:get-available-models',
  getProviderLoginState: 'runtime:get-provider-login-state',
  getRuntimeState: 'runtime:get-state',
  log: 'desktop:log',
  newSession: 'runtime:new-session',
  createSession: 'runtime:create-session',
  cancelQueuedSession: 'runtime:cancel-queued-session',
  selectTemporarySession: 'runtime:select-temporary-session',
  openExternal: 'desktop:open-external',
  openRuntimeLog: 'runtime:open-log',
  performance: 'desktop:performance',
  loginProvider: 'runtime:login-provider',
  prompt: 'runtime:prompt',
  rendererReady: 'desktop:renderer-ready',
  respondExtensionUi: 'runtime:respond-extension-ui',
  restartRuntime: 'runtime:restart',
  getRuntimeNetwork: 'runtime-network:get',
  applyRuntimeNetwork: 'runtime-network:apply',
  getRuntimeSettings: 'runtime-settings:get',
  applyRuntimeSettings: 'runtime-settings:apply',
  detectRuntimeProxy: 'runtime-network:detect',
  checkRuntimeProxyPort: 'runtime-network:check-port',
  getRuntimeEnvironmentDiagnostic: 'runtime-environment:diagnostic',
  revealPath: 'desktop:reveal-path',
  validateLocalPath: 'desktop:validate-local-path',
  reopenProviderLoginUrl: 'runtime:reopen-provider-login-url',
  selectModel: 'runtime:select-model',
  setThinkingLevel: 'runtime:set-thinking-level',
  setApprovalMode: 'runtime:set-approval-mode',
  stopCurrentRun: 'runtime:stop-current-run',
  stopSession: 'runtime:stop-session',
  switchSession: 'runtime:switch-session'
} as const
