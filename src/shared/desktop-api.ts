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
  | 'START_FAILED'
  | 'CRASHED'
  | 'RPC_TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
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
  diagnosticSummary?: string[]
  error?: RuntimeError
}

export type OmpEvent = {
  type: string
  [key: string]: unknown
}

export type PromptInput = {
  message: string
  images?: Array<{
    type: 'image'
    data: string
    mimeType: string
  }>
}

export type RuntimeEvent =
  | { type: 'snapshot'; snapshot: RuntimeSnapshot }
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
  chooseWorkspace(): Promise<DesktopResult<RuntimeSnapshot | null>>
  getRuntimeState(): Promise<DesktopResult<RuntimeSnapshot>>
  getMessages(): Promise<DesktopResult<unknown>>
  restartRuntime(): Promise<DesktopResult<RuntimeSnapshot>>
  prompt(input: PromptInput): Promise<DesktopResult<void>>
  followUp(input: PromptInput): Promise<DesktopResult<void>>
  stopCurrentRun(): Promise<DesktopResult<PromptInput | null>>
  newSession(): Promise<DesktopResult<RuntimeSnapshot>>
  switchSession(sessionId: string): Promise<DesktopResult<RuntimeSnapshot>>
  setModel(provider: string, modelId: string): Promise<DesktopResult<void>>
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
  event: 'runtime:event',
  followUp: 'runtime:follow-up',
  getMessages: 'runtime:get-messages',
  getRuntimeState: 'runtime:get-state',
  log: 'desktop:log',
  newSession: 'runtime:new-session',
  openExternal: 'desktop:open-external',
  openRuntimeLog: 'runtime:open-log',
  performance: 'desktop:performance',
  prompt: 'runtime:prompt',
  rendererReady: 'desktop:renderer-ready',
  respondExtensionUi: 'runtime:respond-extension-ui',
  restartRuntime: 'runtime:restart',
  revealPath: 'desktop:reveal-path',
  setModel: 'runtime:set-model',
  setThinkingLevel: 'runtime:set-thinking-level',
  stopCurrentRun: 'runtime:stop-current-run',
  switchSession: 'runtime:switch-session'
} as const
