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
  sessionPath?: string
  isStreaming: boolean
  queuedMessageCount: number
  model?: string
  thinkingLevel?: string
  isAuthenticating?: boolean
  pendingModelSelection?: ModelSelection
  diagnosticSummary?: string[]
  error?: RuntimeError
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
  session: SessionSummary
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

export type DraftRecord = {
  text: string
  references: ContextReference[]
  updatedAt: string
}

export type RuntimeEvent =
  | { type: 'snapshot'; snapshot: RuntimeSnapshot }
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
  openExternal(url: string): Promise<boolean>
  openRuntimeLog(): Promise<boolean>
  revealPath(path: string): Promise<boolean>
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
  getRuntimeState(): Promise<DesktopResult<RuntimeSnapshot>>
  getMessages(): Promise<DesktopResult<unknown>>
  getLoginProviders(): Promise<DesktopResult<LoginProvider[]>>
  getAvailableModels(): Promise<DesktopResult<AvailableModel[]>>
  getProviderLoginState(): Promise<DesktopResult<ProviderLoginState>>
  loginProvider(providerId: string): Promise<DesktopResult<void>>
  cancelProviderLogin(): Promise<DesktopResult<void>>
  reopenProviderLoginUrl(): Promise<DesktopResult<boolean>>
  restartRuntime(): Promise<DesktopResult<RuntimeSnapshot>>
  prompt(input: PromptInput): Promise<DesktopResult<void>>
  followUp(input: PromptInput): Promise<DesktopResult<void>>
  stopCurrentRun(): Promise<DesktopResult<PromptInput | null>>
  newSession(): Promise<DesktopResult<RuntimeSnapshot>>
  createSession(
    input: PromptInput,
    title: string
  ): Promise<DesktopResult<CreatedSession>>
  switchSession(sessionId: string): Promise<DesktopResult<RuntimeSnapshot>>
  selectModel(
    selection: ModelSelection
  ): Promise<DesktopResult<RuntimeSnapshot>>
  cancelPendingModelSelection(): Promise<DesktopResult<RuntimeSnapshot>>
  setThinkingLevel(level: string): Promise<DesktopResult<void>>
  respondExtensionUi(
    id: string,
    response: ExtensionUiResponse
  ): Promise<DesktopResult<void>>
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): Unsubscribe
  log(entry: RendererLogEntry): void
  reportPerformance(entry: PerformanceEntry): void
  rendererReady(): void
}

export const IPC_CHANNELS = {
  chooseWorkspace: 'runtime:choose-workspace',
  getWorkspaces: 'workspace:list',
  activateWorkspace: 'workspace:activate',
  setWorkspacePinned: 'workspace:set-pinned',
  removeWorkspace: 'workspace:remove',
  listSessions: 'session:list',
  setSessionPinned: 'session:set-pinned',
  setSessionArchived: 'session:set-archived',
  renameSession: 'session:rename',
  deleteSession: 'session:delete',
  getContextCandidates: 'context:candidates',
  cancelPendingModelSelection: 'runtime:cancel-pending-model-selection',
  cancelProviderLogin: 'runtime:cancel-provider-login',
  event: 'runtime:event',
  followUp: 'runtime:follow-up',
  getMessages: 'runtime:get-messages',
  getLoginProviders: 'runtime:get-login-providers',
  getAvailableModels: 'runtime:get-available-models',
  getProviderLoginState: 'runtime:get-provider-login-state',
  getRuntimeState: 'runtime:get-state',
  log: 'desktop:log',
  newSession: 'runtime:new-session',
  createSession: 'runtime:create-session',
  openExternal: 'desktop:open-external',
  openRuntimeLog: 'runtime:open-log',
  performance: 'desktop:performance',
  loginProvider: 'runtime:login-provider',
  prompt: 'runtime:prompt',
  rendererReady: 'desktop:renderer-ready',
  respondExtensionUi: 'runtime:respond-extension-ui',
  restartRuntime: 'runtime:restart',
  revealPath: 'desktop:reveal-path',
  reopenProviderLoginUrl: 'runtime:reopen-provider-login-url',
  selectModel: 'runtime:select-model',
  setThinkingLevel: 'runtime:set-thinking-level',
  stopCurrentRun: 'runtime:stop-current-run',
  switchSession: 'runtime:switch-session'
} as const
