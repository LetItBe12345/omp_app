import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  ApprovalMode,
  AvailableModel,
  AvailableSlashCommand,
  LoginProvider,
  ModelSelection,
  OmpEvent,
  PromptInput,
  RuntimeSnapshot,
  SessionRuntimePhase,
  SessionRuntimeState,
  ToolApprovalRequest
} from '../shared/desktop-api'
import { RuntimeFailure, type RuntimeSupervisor } from './runtime-supervisor'

export type RuntimeController = {
  readonly snapshot: RuntimeSnapshot
  readonly states?: SessionRuntimeState[]
  readonly supportsParallelSessions?: boolean
  readonly maxParallel?: number
  readonly waitingCount?: number
  setMaxParallel?(value: number): void
  readonly diagnosticsPath: string
  recordDiagnostic(message: string): void
  setApprovalState(
    approvalMode: ApprovalMode,
    approvalModeChanging?: boolean,
    approvalModeSaved?: boolean,
    sessionId?: string
  ): RuntimeSnapshot
  setToolApprovals(approvals: ToolApprovalRequest[]): RuntimeSnapshot
  setCompatibilityNotice(message: string | undefined): RuntimeSnapshot
  start(
    workspacePath: string,
    env?: NodeJS.ProcessEnv,
    approvalMode?: ApprovalMode
  ): Promise<RuntimeSnapshot>
  restart(
    approvalMode?: ApprovalMode,
    env?: NodeJS.ProcessEnv,
    sessionId?: string
  ): Promise<RuntimeSnapshot>
  stop(): Promise<void>
  getState(): Promise<RuntimeSnapshot>
  getMessages(): Promise<unknown>
  getSessionMessages?(sessionId: string): Promise<unknown>
  getAvailableCommands(): Promise<AvailableSlashCommand[]>
  getLoginProviders(): Promise<LoginProvider[]>
  getAvailableModels(): Promise<AvailableModel[]>
  loginProvider(providerId: string): Promise<void>
  restartLoginRuntime?(): Promise<RuntimeSnapshot>
  prompt(input: PromptInput, sessionId?: string): Promise<void>
  followUp(input: PromptInput, sessionId?: string): Promise<void>
  stopCurrentRun(sessionId?: string): Promise<PromptInput | null>
  stopSession?(sessionId: string): Promise<PromptInput | null>
  enqueueNewSession?(options: PoolSessionTaskOptions): QueuedPoolSession
  cancelQueuedSession?(temporarySessionId: string): Promise<PromptInput>
  selectTemporarySession?(temporarySessionId: string): RuntimeSnapshot
  newSession(): Promise<RuntimeSnapshot>
  prepareNewSession?(
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode,
    payloadBytes?: number
  ): Promise<RuntimeSnapshot>
  selectSession?(
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode,
    sessionId: string,
    sessionPath: string
  ): Promise<RuntimeSnapshot>
  switchSession(sessionId: string): Promise<RuntimeSnapshot>
  trustSession(sessionId: string, sessionPath: string): void
  setSessionName(title: string): Promise<void>
  setHostUriSchemes(): Promise<void>
  restoreSessionPath(sessionPath: string): Promise<RuntimeSnapshot>
  selectModel(
    selection: ModelSelection,
    sessionId?: string
  ): Promise<RuntimeSnapshot>
  cancelPendingModelSelection(sessionId?: string): RuntimeSnapshot
  applyPendingModelSelection(sessionId?: string): Promise<RuntimeSnapshot>
  setThinkingLevel(level: string, sessionId?: string): Promise<void>
  request(
    frame: Record<string, unknown>,
    timeoutMs?: number | null
  ): Promise<Record<string, unknown>>
  sendFrame(frame: Record<string, unknown>, sessionId?: string): void
  on(
    event: 'snapshot',
    listener: (snapshot: RuntimeSnapshot) => void
  ): RuntimeController
  on(event: 'event', listener: (event: OmpEvent) => void): RuntimeController
  on(
    event: 'session-snapshot',
    listener: (state: SessionRuntimeState) => void
  ): RuntimeController
  on(
    event: 'pool-snapshot',
    listener: (states: SessionRuntimeState[]) => void
  ): RuntimeController
  on(
    event: 'before-stop',
    listener: (scope?: {
      runtimeInstanceId: string
      generation: number
    }) => void
  ): RuntimeController
  on(
    event: 'temporary-session-bound' | 'temporary-session-failed',
    listener: (payload: Record<string, unknown>) => void
  ): RuntimeController
  off(
    event: 'snapshot',
    listener: (snapshot: RuntimeSnapshot) => void
  ): RuntimeController
  off(event: 'event', listener: (event: OmpEvent) => void): RuntimeController
  off(
    event: 'session-snapshot',
    listener: (state: SessionRuntimeState) => void
  ): RuntimeController
  off(
    event: 'pool-snapshot',
    listener: (states: SessionRuntimeState[]) => void
  ): RuntimeController
  off(
    event: 'before-stop',
    listener: (scope?: {
      runtimeInstanceId: string
      generation: number
    }) => void
  ): RuntimeController
  off(
    event: 'temporary-session-bound' | 'temporary-session-failed',
    listener: (payload: Record<string, unknown>) => void
  ): RuntimeController
}

export type PoolSessionTaskOptions = {
  workspacePath: string
  env: NodeJS.ProcessEnv
  approvalMode: ApprovalMode
  input: PromptInput
  title: string
}

export type QueuedPoolSession = {
  temporarySessionId: string
  queuePosition?: number
}

type SessionTask = PoolSessionTaskOptions & {
  temporarySessionId: string
  status: 'queued' | 'starting'
  entry?: Entry
  cancelled: boolean
  promptAccepted: boolean
  cancellation?: {
    resolve: (input: PromptInput) => void
    reject: (error: unknown) => void
  }
}

type Entry = {
  id: string
  generation: number
  supervisor: RuntimeSupervisor
  workspacePath?: string
  env: NodeJS.ProcessEnv
  environmentFingerprint?: string
  approvalMode: ApprovalMode
  sessionId?: string
  trustedSessions: Map<string, string>
  lastIdleAt: number
  visible: boolean
  pendingInteractions: Map<string, OmpEvent>
  reserved: boolean
  leasedForPrompt: boolean
  idleSince?: number
  idleTimer?: NodeJS.Timeout
  pendingFollowUpBytes: number[]
}

type AcquireRequest = {
  workspacePath: string
  env: NodeJS.ProcessEnv
  environmentFingerprint: string
  approvalMode: ApprovalMode
  sessionId?: string
  resolve: (entry: Entry) => void
  reject: (error: unknown) => void
  payloadBytes: number
}

export type RuntimePoolOptions = {
  createSupervisor: () => RuntimeSupervisor
  initialSupervisor?: RuntimeSupervisor
  maxParallel?: number
  now?: () => number
  maxQueuedTasks?: number
  maxQueuedBytes?: number
  maxFollowUpsPerSession?: number
  maxFollowUpBytes?: number
}

const volatileEnvironmentKeys = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])

export function runtimeEnvironmentFingerprint(
  workspacePath: string,
  env: NodeJS.ProcessEnv,
  approvalMode: ApprovalMode
): string {
  const stableEnvironment = Object.entries(env)
    .filter(([key]) => !volatileEnvironmentKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
  return createHash('sha256')
    .update(JSON.stringify([workspacePath, approvalMode, stableEnvironment]))
    .digest('hex')
}

function phase(entry: Entry): SessionRuntimePhase {
  const snapshot = entry.supervisor.snapshot
  if (entry.reserved || entry.leasedForPrompt) return 'starting'
  if (snapshot.status === 'failed') return 'failed'
  if (snapshot.status === 'starting') return 'starting'
  if (snapshot.status === 'stopping') return 'stopping'
  if (
    entry.pendingInteractions.size > 0 ||
    snapshot.toolApprovals?.some((item) => item.status === 'pending')
  )
    return 'waiting-interaction'
  if (snapshot.isStreaming || snapshot.queuedMessageCount > 0) return 'running'
  return 'idle'
}

function busy(entry: Entry): boolean {
  const snapshot = entry.supervisor.snapshot
  return (
    entry.reserved ||
    entry.leasedForPrompt ||
    snapshot.status === 'starting' ||
    snapshot.status === 'stopping' ||
    snapshot.isStreaming ||
    snapshot.queuedMessageCount > 0 ||
    snapshot.isAuthenticating === true ||
    entry.pendingInteractions.size > 0 ||
    snapshot.toolApprovals?.some((item) => item.status === 'pending') === true
  )
}

/** Main 中唯一的 Runtime 调度边界。 */
export class RuntimePool extends EventEmitter implements RuntimeController {
  readonly supportsParallelSessions = true
  readonly #createSupervisor: () => RuntimeSupervisor
  readonly #entries = new Map<string, Entry>()
  readonly #bindings = new Map<string, Entry>()
  readonly #responseOwners = new Map<
    string,
    { entry: Entry; originalId: string }
  >()
  readonly #queue: AcquireRequest[] = []
  readonly #sessionTasks = new Map<string, SessionTask>()
  readonly #now: () => number
  readonly #maxQueuedTasks: number
  readonly #maxQueuedBytes: number
  readonly #maxFollowUpsPerSession: number
  readonly #maxFollowUpBytes: number
  #selected: Entry
  #maxParallel: number
  #draining = false
  #activeTemporarySessionId?: string
  #loginEntry?: Entry

  constructor(options: RuntimePoolOptions) {
    super()
    this.#createSupervisor = options.createSupervisor
    this.#maxParallel = Math.min(10, Math.max(1, options.maxParallel ?? 1))
    this.#now = options.now ?? Date.now
    this.#maxQueuedTasks = options.maxQueuedTasks ?? 20
    this.#maxQueuedBytes = options.maxQueuedBytes ?? 64 * 1024 * 1024
    this.#maxFollowUpsPerSession = options.maxFollowUpsPerSession ?? 5
    this.#maxFollowUpBytes = options.maxFollowUpBytes ?? 64 * 1024 * 1024
    this.#selected = this.#add(
      options.initialSupervisor ?? options.createSupervisor()
    )
  }

  get snapshot(): RuntimeSnapshot {
    return this.#selected.supervisor.snapshot
  }

  get diagnosticsPath(): string {
    return this.#selected.supervisor.diagnosticsPath
  }

  get maxParallel(): number {
    return this.#maxParallel
  }

  get waitingCount(): number {
    return this.#queue.length
  }

  get states(): SessionRuntimeState[] {
    const entries = [...this.#entries.values()].map((entry) => ({
      runtimeInstanceId: entry.id,
      generation: entry.generation,
      ...(entry.workspacePath ? { workspacePath: entry.workspacePath } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      phase: phase(entry),
      snapshot: entry.supervisor.snapshot,
      visible: entry.visible,
      pendingExtensionUi: [...entry.pendingInteractions.values()].map((event) =>
        structuredClone(event)
      )
    }))
    const queued = [...this.#sessionTasks.values()].flatMap(
      (task): SessionRuntimeState[] => {
        const position = this.#queue.findIndex(
          (request) => request.sessionId === task.temporarySessionId
        )
        return [
          {
            runtimeInstanceId:
              task.entry?.id ?? `temporary:${task.temporarySessionId}`,
            generation: task.entry?.generation ?? 0,
            workspacePath: task.workspacePath,
            sessionId: task.temporarySessionId,
            phase: position >= 0 ? 'queued' : 'starting',
            temporary: true,
            visible: this.#activeTemporarySessionId === task.temporarySessionId,
            temporaryInput: structuredClone(task.input),
            ...(position >= 0 ? { queuePosition: position + 1 } : {}),
            snapshot: {
              status: position >= 0 ? 'stopped' : 'starting',
              workspacePath: task.workspacePath,
              sessionId: task.temporarySessionId,
              sessionName: task.title,
              isStreaming: false,
              queuedMessageCount: 0,
              approvalMode: task.approvalMode
            }
          }
        ]
      }
    )
    return [...entries, ...queued]
  }

  setMaxParallel(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 10)
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        '最大并行数量必须是 1–10 的整数',
        false
      )
    this.#maxParallel = value
    void this.#trimIdleEntries()
    void this.#drain()
    this.emit('pool-snapshot', this.states)
  }

  markVisible(
    workspacePath: string | undefined,
    sessionId: string | undefined
  ): void {
    for (const entry of this.#entries.values()) {
      entry.visible =
        entry.workspacePath === workspacePath && entry.sessionId === sessionId
      this.#scheduleIdleReclaim(entry)
    }
  }

  recordDiagnostic(message: string): void {
    this.#selected.supervisor.recordDiagnostic(message)
  }

  setApprovalState(
    approvalMode: ApprovalMode,
    approvalModeChanging = false,
    approvalModeSaved = true,
    sessionId?: string
  ): RuntimeSnapshot {
    const entry = this.#targetEntry(sessionId)
    entry.approvalMode = approvalMode
    return entry.supervisor.setApprovalState(
      approvalMode,
      approvalModeChanging,
      approvalModeSaved
    )
  }

  setToolApprovals(approvals: ToolApprovalRequest[]): RuntimeSnapshot {
    if (approvals.length === 0) {
      for (const entry of this.#entries.values())
        entry.supervisor.setToolApprovals([])
      return this.snapshot
    }
    const grouped = new Map<Entry, ToolApprovalRequest[]>()
    for (const approval of approvals) {
      const owner =
        this.#responseOwners.get(approval.id)?.entry ?? this.#selected
      const current = grouped.get(owner) ?? []
      current.push(approval)
      grouped.set(owner, current)
    }
    for (const entry of this.#entries.values())
      entry.supervisor.setToolApprovals(grouped.get(entry) ?? [])
    return this.snapshot
  }

  setCompatibilityNotice(message: string | undefined): RuntimeSnapshot {
    return this.#selected.supervisor.setCompatibilityNotice(message)
  }

  async start(
    workspacePath: string,
    env: NodeJS.ProcessEnv = process.env,
    approvalMode: ApprovalMode = this.snapshot.approvalMode ?? 'yolo'
  ): Promise<RuntimeSnapshot> {
    const entry = await this.#acquire(workspacePath, env, approvalMode)
    try {
      this.#select(entry)
      if (
        entry.supervisor.snapshot.status !== 'ready' ||
        entry.workspacePath !== workspacePath ||
        entry.environmentFingerprint !==
          runtimeEnvironmentFingerprint(workspacePath, env, approvalMode)
      ) {
        await entry.supervisor.start(workspacePath, env, approvalMode)
      }
      this.#publishSelected()
      return entry.supervisor.snapshot
    } finally {
      entry.reserved = false
      void this.#drain()
    }
  }

  async restart(
    approvalMode: ApprovalMode = this.snapshot.approvalMode ?? 'yolo',
    env?: NodeJS.ProcessEnv,
    sessionId?: string
  ): Promise<RuntimeSnapshot> {
    const entry = this.#targetEntry(sessionId)
    entry.approvalMode = approvalMode
    if (env) {
      entry.env = { ...env }
      if (entry.workspacePath)
        entry.environmentFingerprint = runtimeEnvironmentFingerprint(
          entry.workspacePath,
          env,
          approvalMode
        )
    }
    return entry.supervisor.restart(approvalMode, env)
  }

  async stop(): Promise<void> {
    const entries = [...this.#entries.values()]
    for (const entry of entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
    }
    for (const task of this.#sessionTasks.values()) {
      task.cancelled = true
      task.cancellation?.resolve(structuredClone(task.input))
      task.cancellation = undefined
    }
    this.#sessionTasks.clear()
    this.#activeTemporarySessionId = undefined
    this.#queue
      .splice(0)
      .forEach((request) =>
        request.reject(new RuntimeFailure('CRASHED', 'Desktop 正在关闭', true))
      )
    await Promise.allSettled(entries.map((entry) => entry.supervisor.stop()))
  }

  getState(): Promise<RuntimeSnapshot> {
    return this.#selected.supervisor.getState()
  }

  getMessages(): Promise<unknown> {
    return this.#selected.supervisor.getMessages()
  }

  getSessionMessages(sessionId: string): Promise<unknown> {
    const entry = this.#bindings.get(sessionId)
    if (!entry)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 没有活动 Runtime',
        false
      )
    return entry.supervisor.getMessages()
  }

  getAvailableCommands(): Promise<AvailableSlashCommand[]> {
    return this.#selected.supervisor.getAvailableCommands()
  }

  getLoginProviders(): Promise<LoginProvider[]> {
    return this.#selected.supervisor.getLoginProviders()
  }

  getAvailableModels(): Promise<AvailableModel[]> {
    return this.#selected.supervisor.getAvailableModels()
  }

  loginProvider(providerId: string): Promise<void> {
    const entry = this.#selected
    if (busy(entry))
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Provider 登录只能在当前 Session 空闲时开始',
        true
      )
    this.#loginEntry = entry
    return entry.supervisor.loginProvider(providerId).finally(() => {
      if (this.#loginEntry === entry) this.#loginEntry = undefined
    })
  }

  restartLoginRuntime(): Promise<RuntimeSnapshot> {
    const entry = this.#loginEntry
    if (!entry)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Provider 登录已结束',
        false
      )
    return entry.supervisor.restart(entry.approvalMode, entry.env)
  }

  async prompt(input: PromptInput, sessionId?: string): Promise<void> {
    const entry = this.#targetEntry(sessionId)
    try {
      if (entry.supervisor.snapshot.status !== 'ready') {
        if (!entry.workspacePath)
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            '尚未选择 Workspace',
            false
          )
        const targetSessionId = entry.sessionId
        const targetSessionPath = targetSessionId
          ? entry.trustedSessions.get(targetSessionId)
          : undefined
        entry.leasedForPrompt = true
        this.#publishEntry(entry)
        await this.#prepare(
          entry,
          entry.workspacePath,
          entry.env,
          entry.approvalMode
        )
        if (targetSessionId) {
          if (!targetSessionPath)
            throw new RuntimeFailure(
              'SESSION_NOT_FOUND',
              'Session 不存在',
              false
            )
          entry.supervisor.trustSession(targetSessionId, targetSessionPath)
          const restored = await entry.supervisor.switchSession(targetSessionId)
          this.#syncEntry(entry, restored)
        }
      }
      await entry.supervisor.prompt(input)
    } finally {
      entry.leasedForPrompt = false
      this.#publishEntry(entry)
      void this.#drain()
    }
  }

  followUp(input: PromptInput, sessionId?: string): Promise<void> {
    const entry = this.#targetEntry(sessionId)
    if (entry.pendingFollowUpBytes.length >= this.#maxFollowUpsPerSession)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '当前 Session 最多等待 5 条 Follow-up',
        true
      )
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
    const totalBytes = [...this.#entries.values()].reduce(
      (total, item) =>
        total +
        item.pendingFollowUpBytes.reduce((sum, value) => sum + value, 0),
      0
    )
    if (totalBytes + bytes > this.#maxFollowUpBytes)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Follow-up 等待内容已达到 64 MiB 上限',
        true
      )
    return entry.supervisor.followUp(input).then(() => {
      entry.pendingFollowUpBytes.push(bytes)
    })
  }

  stopCurrentRun(sessionId?: string): Promise<PromptInput | null> {
    return this.#targetEntry(sessionId).supervisor.stopCurrentRun()
  }

  stopSession(sessionId: string): Promise<PromptInput | null> {
    const entry = this.#bindings.get(sessionId)
    if (!entry)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 没有运行中的任务',
        false
      )
    return entry.supervisor.stopCurrentRun()
  }

  enqueueNewSession(options: PoolSessionTaskOptions): QueuedPoolSession {
    const payloadBytes = Buffer.byteLength(
      JSON.stringify(options.input),
      'utf8'
    )
    const requiresQueue =
      this.#entries.size >= this.#maxParallel &&
      [...this.#entries.values()].every((entry) => busy(entry))
    if (requiresQueue && this.#queue.length >= this.#maxQueuedTasks)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '等待队列已满，请取消其他任务或等待任务开始',
        true
      )
    if (
      requiresQueue &&
      this.#queue.reduce(
        (total, request) => total + request.payloadBytes,
        payloadBytes
      ) > this.#maxQueuedBytes
    )
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Runtime 等待队列内容已达到 64 MiB 上限',
        true
      )
    const temporarySessionId = `temporary-${randomUUID()}`
    const task: SessionTask = {
      ...options,
      temporarySessionId,
      status: 'queued',
      cancelled: false,
      promptAccepted: false
    }
    this.#sessionTasks.set(temporarySessionId, task)
    this.#activeTemporarySessionId = temporarySessionId
    void this.#runSessionTask(task)
    this.emit('pool-snapshot', this.states)
    const position = this.#queue.findIndex(
      (request) => request.sessionId === temporarySessionId
    )
    return {
      temporarySessionId,
      ...(position >= 0 ? { queuePosition: position + 1 } : {})
    }
  }

  async cancelQueuedSession(temporarySessionId: string): Promise<PromptInput> {
    const task = this.#sessionTasks.get(temporarySessionId)
    if (!task || task.promptAccepted)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '任务已经开始，不能再取消等待',
        false
      )
    const index = this.#queue.findIndex(
      (request) => request.sessionId === temporarySessionId
    )
    task.cancelled = true
    if (index >= 0) {
      const [request] = this.#queue.splice(index, 1)
      request?.reject(
        new RuntimeFailure('RUNTIME_NOT_READY', '已取消等待', false)
      )
      this.#finishCancelledTask(task)
      return structuredClone(task.input)
    }
    return new Promise<PromptInput>((resolve, reject) => {
      task.cancellation = { resolve, reject }
      this.emit('pool-snapshot', this.states)
    })
  }

  selectTemporarySession(temporarySessionId: string): RuntimeSnapshot {
    const task = this.#sessionTasks.get(temporarySessionId)
    if (!task)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        '临时 Session 不存在',
        false
      )
    this.#activeTemporarySessionId = temporarySessionId
    if (task.entry) this.#select(task.entry)
    return task.entry?.supervisor.snapshot ?? this.snapshot
  }

  async newSession(): Promise<RuntimeSnapshot> {
    let entry = this.#selected
    if (busy(entry) && !entry.leasedForPrompt) {
      if (!entry.workspacePath)
        throw new RuntimeFailure(
          'INVALID_ARGUMENT',
          '尚未选择 Workspace',
          false
        )
      entry = await this.#acquire(
        entry.workspacePath,
        entry.env,
        entry.approvalMode
      )
      this.#select(entry)
    }
    try {
      const snapshot = await entry.supervisor.newSession()
      this.#syncEntry(entry, snapshot)
      return snapshot
    } finally {
      entry.reserved = false
      void this.#drain()
    }
  }

  async prepareNewSession(
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode,
    payloadBytes = 0
  ): Promise<RuntimeSnapshot> {
    const entry = await this.#acquire(
      workspacePath,
      env,
      approvalMode,
      undefined,
      payloadBytes
    )
    this.#select(entry)
    entry.reserved = false
    entry.leasedForPrompt = true
    return entry.supervisor.snapshot
  }

  async selectSession(
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode,
    sessionId: string,
    sessionPath: string
  ): Promise<RuntimeSnapshot> {
    const bound = this.#bindings.get(sessionId)
    if (bound) {
      this.#select(bound)
      return bound.supervisor.snapshot
    }
    const entry = await this.#acquire(
      workspacePath,
      env,
      approvalMode,
      sessionId
    )
    try {
      entry.trustedSessions.set(sessionId, sessionPath)
      entry.supervisor.trustSession(sessionId, sessionPath)
      const snapshot = await entry.supervisor.switchSession(sessionId)
      this.#syncEntry(entry, snapshot)
      this.#select(entry)
      return snapshot
    } finally {
      entry.reserved = false
      void this.#drain()
    }
  }

  async switchSession(sessionId: string): Promise<RuntimeSnapshot> {
    this.#activeTemporarySessionId = undefined
    const bound = this.#bindings.get(sessionId)
    if (bound) {
      this.#select(bound)
      return bound.supervisor.snapshot
    }
    const current = this.#selected
    if (!current.workspacePath)
      throw new RuntimeFailure('INVALID_ARGUMENT', '尚未选择 Workspace', false)
    const entry = busy(current)
      ? await this.#acquire(
          current.workspacePath,
          current.env,
          current.approvalMode,
          sessionId
        )
      : current
    const path = this.#trustedSessionPath(sessionId)
    if (!path)
      throw new RuntimeFailure('SESSION_NOT_FOUND', 'Session 不存在', false)
    try {
      entry.supervisor.trustSession(sessionId, path)
      const snapshot = await entry.supervisor.switchSession(sessionId)
      this.#selected.visible = false
      this.#selected = entry
      entry.visible = true
      this.#syncEntry(entry, snapshot)
      this.#publishSelected()
      return snapshot
    } finally {
      entry.reserved = false
      void this.#drain()
    }
  }

  trustSession(sessionId: string, sessionPath: string): void {
    this.#selected.trustedSessions.set(sessionId, sessionPath)
    for (const entry of this.#entries.values())
      entry.trustedSessions.set(sessionId, sessionPath)
    this.#selected.supervisor.trustSession(sessionId, sessionPath)
  }

  setSessionName(title: string): Promise<void> {
    return this.#selected.supervisor.setSessionName(title)
  }

  setHostUriSchemes(): Promise<void> {
    return this.#selected.supervisor.setHostUriSchemes()
  }

  restoreSessionPath(sessionPath: string): Promise<RuntimeSnapshot> {
    return this.#selected.supervisor.restoreSessionPath(sessionPath)
  }

  selectModel(
    selection: ModelSelection,
    sessionId?: string
  ): Promise<RuntimeSnapshot> {
    return this.#targetEntry(sessionId).supervisor.selectModel(selection)
  }

  cancelPendingModelSelection(sessionId?: string): RuntimeSnapshot {
    return this.#targetEntry(sessionId).supervisor.cancelPendingModelSelection()
  }

  applyPendingModelSelection(sessionId?: string): Promise<RuntimeSnapshot> {
    return this.#targetEntry(sessionId).supervisor.applyPendingModelSelection()
  }

  setThinkingLevel(level: string, sessionId?: string): Promise<void> {
    return this.#targetEntry(sessionId).supervisor.setThinkingLevel(level)
  }

  request(
    frame: Record<string, unknown>,
    timeoutMs?: number | null
  ): Promise<Record<string, unknown>> {
    return this.#selected.supervisor.request(frame, timeoutMs)
  }

  sendFrame(frame: Record<string, unknown>, sessionId?: string): void {
    const id = typeof frame['id'] === 'string' ? frame['id'] : undefined
    const owner = id ? this.#responseOwners.get(id) : undefined
    if (!owner) {
      this.#targetEntry(sessionId).supervisor.sendFrame(frame)
      return
    }
    if (sessionId && owner.entry.sessionId !== sessionId)
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        '交互请求不属于目标 Session',
        false
      )
    owner.entry.supervisor.sendFrame({ ...frame, id: owner.originalId })
    if (
      frame['type'] === 'extension_ui_response' ||
      frame['type'] === 'host_uri_result'
    ) {
      owner.entry.pendingInteractions.delete(id!)
      this.#responseOwners.delete(id!)
      this.#publishEntry(owner.entry)
    }
  }

  #targetEntry(sessionId?: string): Entry {
    if (!sessionId) return this.#selected
    const entry = this.#bindings.get(sessionId)
    if (!entry)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 没有活动 Runtime',
        false
      )
    return entry
  }

  #add(supervisor: RuntimeSupervisor): Entry {
    const entry: Entry = {
      id: randomUUID(),
      generation: 1,
      supervisor,
      env: {},
      approvalMode: 'yolo',
      trustedSessions: new Map(),
      lastIdleAt: this.#now(),
      visible: false,
      pendingInteractions: new Map(),
      reserved: false,
      leasedForPrompt: false,
      pendingFollowUpBytes: []
    }
    this.#entries.set(entry.id, entry)
    supervisor.setDiagnosticContext(() =>
      [
        `runtime=${entry.id}`,
        `generation=${entry.generation}`,
        `workspace=${entry.workspacePath ?? 'none'}`,
        `session=${entry.sessionId ?? 'none'}`
      ]
        .map((item) => `[${item}]`)
        .join(' ')
    )
    supervisor.on('snapshot', (snapshot: RuntimeSnapshot) => {
      this.#syncEntry(entry, snapshot)
      this.emit('session-snapshot', this.#publicState(entry))
      if (entry === this.#selected) this.emit('snapshot', snapshot)
      if (!busy(entry)) void this.#drain()
    })
    supervisor.on('event', (event: OmpEvent) => {
      this.#syncEntry(entry, entry.supervisor.snapshot)
      this.emit('event', this.#wrapEvent(entry, event))
    })
    supervisor.on('before-stop', () => {
      this.emit('before-stop', {
        runtimeInstanceId: entry.id,
        generation: entry.generation
      })
    })
    return entry
  }

  #syncEntry(entry: Entry, snapshot: RuntimeSnapshot): void {
    if (entry.pendingFollowUpBytes.length > snapshot.queuedMessageCount)
      entry.pendingFollowUpBytes.splice(
        0,
        entry.pendingFollowUpBytes.length - snapshot.queuedMessageCount
      )
    if (snapshot.workspacePath) entry.workspacePath = snapshot.workspacePath
    entry.approvalMode = snapshot.approvalMode ?? entry.approvalMode
    if (snapshot.sessionId && snapshot.sessionId !== entry.sessionId) {
      if (entry.sessionId && this.#bindings.get(entry.sessionId) === entry)
        this.#bindings.delete(entry.sessionId)
      entry.sessionId = snapshot.sessionId
      this.#bindings.set(snapshot.sessionId, entry)
    }
    if (busy(entry)) {
      entry.idleSince = undefined
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    } else if (entry.idleSince === undefined) {
      entry.idleSince = this.#now()
      entry.lastIdleAt = entry.idleSince
      this.#scheduleIdleReclaim(entry)
    }
  }

  #publicState(entry: Entry): SessionRuntimeState {
    return {
      runtimeInstanceId: entry.id,
      generation: entry.generation,
      ...(entry.workspacePath ? { workspacePath: entry.workspacePath } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      phase: phase(entry),
      snapshot: entry.supervisor.snapshot,
      visible: entry.visible,
      pendingExtensionUi: [...entry.pendingInteractions.values()].map((event) =>
        structuredClone(event)
      )
    }
  }

  #wrapEvent(entry: Entry, event: OmpEvent): OmpEvent {
    const wrapped: OmpEvent = {
      ...event,
      __desktop: {
        runtimeInstanceId: entry.id,
        generation: entry.generation,
        workspacePath: entry.workspacePath,
        sessionId: entry.sessionId,
        runtimeVersion: entry.supervisor.snapshot.runtimeVersion
      }
    }
    for (const key of ['id', 'targetId', 'toolCallId'] as const) {
      const original = wrapped[key]
      if (typeof original !== 'string') continue
      const composite = `${entry.id}:${entry.generation}:${original}`
      wrapped[key] = composite
      if (key === 'id')
        this.#responseOwners.set(composite, { entry, originalId: original })
    }
    if (wrapped.type === 'extension_ui_request') {
      const method = wrapped['method']
      if (
        (method === 'select' ||
          method === 'confirm' ||
          method === 'input' ||
          method === 'editor') &&
        typeof wrapped['id'] === 'string'
      ) {
        entry.pendingInteractions.set(wrapped['id'], structuredClone(wrapped))
        this.#publishEntry(entry)
      } else if (
        method === 'cancel' &&
        typeof wrapped['targetId'] === 'string'
      ) {
        entry.pendingInteractions.delete(wrapped['targetId'])
        this.#publishEntry(entry)
      }
    }
    if (
      wrapped.type === 'extension_ui_resolved' &&
      typeof wrapped['id'] === 'string'
    ) {
      entry.pendingInteractions.delete(wrapped['id'])
      this.#publishEntry(entry)
    }
    return wrapped
  }

  async #acquire(
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode,
    sessionId?: string,
    payloadBytes = 0
  ): Promise<Entry> {
    const environmentFingerprint = runtimeEnvironmentFingerprint(
      workspacePath,
      env,
      approvalMode
    )
    const bound = sessionId ? this.#bindings.get(sessionId) : undefined
    if (bound && !busy(bound)) return this.#reserve(bound)
    const compatible = [...this.#entries.values()]
      .filter(
        (entry) =>
          !busy(entry) &&
          entry.workspacePath === workspacePath &&
          entry.environmentFingerprint === environmentFingerprint
      )
      .sort((left, right) => {
        if (left.visible !== right.visible) return left.visible ? 1 : -1
        if (left.lastIdleAt !== right.lastIdleAt)
          return left.lastIdleAt - right.lastIdleAt
        return left.id.localeCompare(right.id)
      })[0]
    if (compatible) return this.#reserve(compatible)

    const stopped = [...this.#entries.values()].find(
      (entry) => !busy(entry) && entry.supervisor.snapshot.status !== 'ready'
    )
    if (stopped) {
      this.#reserve(stopped)
      try {
        await this.#prepare(stopped, workspacePath, env, approvalMode)
        return stopped
      } catch (error) {
        stopped.reserved = false
        throw error
      }
    }
    if (this.#entries.size < this.#maxParallel) {
      const entry = this.#add(this.#createSupervisor())
      this.#reserve(entry)
      try {
        await this.#prepare(entry, workspacePath, env, approvalMode)
        return entry
      } catch (error) {
        entry.reserved = false
        throw error
      }
    }
    const replaceable = [...this.#entries.values()]
      .filter((entry) => !busy(entry))
      .sort((left, right) => {
        if (left.visible !== right.visible) return left.visible ? 1 : -1
        return left.lastIdleAt - right.lastIdleAt
      })[0]
    if (replaceable) {
      this.#reserve(replaceable)
      try {
        await replaceable.supervisor.stop()
        await this.#prepare(replaceable, workspacePath, env, approvalMode)
        return replaceable
      } catch (error) {
        replaceable.reserved = false
        throw error
      }
    }
    if (this.#queue.length >= this.#maxQueuedTasks)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '等待队列已满，请取消其他任务或等待任务开始',
        true
      )
    const queuedBytes = this.#queue.reduce(
      (total, request) => total + request.payloadBytes,
      0
    )
    if (queuedBytes + payloadBytes > this.#maxQueuedBytes)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Runtime 等待队列内容已达到 64 MiB 上限',
        true
      )
    return new Promise<Entry>((resolve, reject) => {
      this.#queue.push({
        workspacePath,
        env: { ...env },
        environmentFingerprint,
        approvalMode,
        ...(sessionId ? { sessionId } : {}),
        resolve,
        reject,
        payloadBytes
      })
      this.emit('pool-snapshot', this.states)
    })
  }

  async #prepare(
    entry: Entry,
    workspacePath: string,
    env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode
  ): Promise<void> {
    entry.workspacePath = workspacePath
    entry.env = { ...env }
    entry.approvalMode = approvalMode
    entry.environmentFingerprint = runtimeEnvironmentFingerprint(
      workspacePath,
      env,
      approvalMode
    )
    for (const [sessionId, path] of this.#allTrustedSessions())
      entry.supervisor.trustSession(sessionId, path)
    let firstError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      entry.generation += 1
      try {
        await entry.supervisor.start(workspacePath, env, approvalMode)
        return
      } catch (error) {
        firstError ??= error
        await entry.supervisor.stop().catch(() => undefined)
      }
    }
    throw firstError
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#queue.length === 0) return
    this.#draining = true
    try {
      while (this.#queue.length > 0) {
        const entry = [...this.#entries.values()]
          .filter((candidate) => !busy(candidate))
          .sort((left, right) => left.lastIdleAt - right.lastIdleAt)[0]
        if (!entry) break
        const request = this.#queue.shift()!
        try {
          this.#reserve(entry)
          if (
            entry.workspacePath !== request.workspacePath ||
            entry.environmentFingerprint !== request.environmentFingerprint ||
            entry.supervisor.snapshot.status !== 'ready'
          ) {
            await entry.supervisor.stop()
            await this.#prepare(
              entry,
              request.workspacePath,
              request.env,
              request.approvalMode
            )
          }
          request.resolve(entry)
          break
        } catch (error) {
          entry.reserved = false
          request.reject(error)
        }
      }
    } finally {
      this.#draining = false
      this.emit('pool-snapshot', this.states)
    }
  }

  async #trimIdleEntries(): Promise<void> {
    const idle = [...this.#entries.values()]
      .filter((entry) => entry !== this.#selected && !busy(entry))
      .sort((left, right) => left.lastIdleAt - right.lastIdleAt)
    while (this.#entries.size > this.#maxParallel && idle.length > 0) {
      const entry = idle.shift()!
      await entry.supervisor.stop()
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      this.#entries.delete(entry.id)
      if (entry.sessionId && this.#bindings.get(entry.sessionId) === entry)
        this.#bindings.delete(entry.sessionId)
    }
  }

  #trustedSessionPath(sessionId: string): string | undefined {
    for (const entry of this.#entries.values()) {
      const path = entry.trustedSessions.get(sessionId)
      if (path) return path
    }
    return undefined
  }

  *#allTrustedSessions(): Iterable<[string, string]> {
    const seen = new Set<string>()
    for (const entry of this.#entries.values()) {
      for (const item of entry.trustedSessions) {
        if (seen.has(item[0])) continue
        seen.add(item[0])
        yield item
      }
    }
  }

  #publishSelected(): void {
    this.emit('snapshot', this.#selected.supervisor.snapshot)
  }

  async #runSessionTask(task: SessionTask): Promise<void> {
    try {
      const entry = await this.#acquire(
        task.workspacePath,
        task.env,
        task.approvalMode,
        task.temporarySessionId,
        Buffer.byteLength(JSON.stringify(task.input), 'utf8')
      )
      if (task.cancelled) {
        task.entry = entry
        this.#finishCancelledTask(task)
        return
      }
      task.entry = entry
      task.status = 'starting'
      entry.reserved = false
      entry.leasedForPrompt = true
      if (this.#activeTemporarySessionId === task.temporarySessionId)
        this.#select(entry)
      this.emit('pool-snapshot', this.states)

      let created: RuntimeSnapshot | undefined
      let createError: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          created = await entry.supervisor.newSession()
          break
        } catch (error) {
          createError = error
          if (attempt === 0) {
            await entry.supervisor.stop().catch(() => undefined)
            await this.#prepare(
              entry,
              task.workspacePath,
              task.env,
              task.approvalMode
            )
          }
        }
      }
      if (!created) throw createError
      this.#syncEntry(entry, created)
      if (task.cancelled) {
        this.#finishCancelledTask(task)
        return
      }
      await entry.supervisor.setSessionName(task.title).catch(() => undefined)
      if (task.cancelled) {
        this.#finishCancelledTask(task)
        return
      }
      await entry.supervisor.prompt(task.input)
      task.promptAccepted = true
      entry.supervisor.recordDiagnostic(
        `[event=session-binding] temporary=${task.temporarySessionId} session=${entry.supervisor.snapshot.sessionId ?? 'none'}`
      )
      task.cancellation?.reject(
        new RuntimeFailure(
          'RUNTIME_NOT_READY',
          '任务已经开始，请使用停止任务',
          false
        )
      )
      task.cancellation = undefined
      task.cancelled = false
      entry.leasedForPrompt = false
      this.#syncEntry(entry, entry.supervisor.snapshot)
      this.#sessionTasks.delete(task.temporarySessionId)
      this.emit('temporary-session-bound', {
        temporarySessionId: task.temporarySessionId,
        snapshot: entry.supervisor.snapshot,
        approvalMode: task.approvalMode,
        active: this.#activeTemporarySessionId === task.temporarySessionId
      })
      this.#activeTemporarySessionId = undefined
      this.#publishEntry(entry)
    } catch (error) {
      if (task.cancelled) {
        this.#finishCancelledTask(task)
        return
      }
      task.entry?.pendingInteractions.clear()
      if (task.entry) {
        task.entry.reserved = false
        task.entry.leasedForPrompt = false
      }
      this.#sessionTasks.delete(task.temporarySessionId)
      this.emit('temporary-session-failed', {
        temporarySessionId: task.temporarySessionId,
        input: structuredClone(task.input),
        error:
          error instanceof RuntimeFailure
            ? error
            : new RuntimeFailure('START_FAILED', String(error), true),
        reason: 'start-failed'
      })
      this.emit('pool-snapshot', this.states)
      void this.#drain()
    }
  }

  #finishCancelledTask(task: SessionTask): void {
    if (task.entry) {
      task.entry.reserved = false
      task.entry.leasedForPrompt = false
      task.entry.pendingInteractions.clear()
      this.#syncEntry(task.entry, task.entry.supervisor.snapshot)
    }
    this.#sessionTasks.delete(task.temporarySessionId)
    if (this.#activeTemporarySessionId === task.temporarySessionId)
      this.#activeTemporarySessionId = undefined
    task.cancellation?.resolve(structuredClone(task.input))
    task.cancellation = undefined
    this.emit('pool-snapshot', this.states)
    void this.#drain()
  }

  #publishEntry(entry: Entry): void {
    this.emit('session-snapshot', this.#publicState(entry))
    this.emit('pool-snapshot', this.states)
  }

  #select(entry: Entry): void {
    const previous = this.#selected
    previous.visible = false
    this.#selected = entry
    entry.visible = true
    this.#scheduleIdleReclaim(previous)
    this.#scheduleIdleReclaim(entry)
    this.#publishSelected()
  }

  #reserve(entry: Entry): Entry {
    entry.reserved = true
    return entry
  }

  #scheduleIdleReclaim(entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
    if (entry.idleSince === undefined || busy(entry)) return
    const keepAliveMs = entry.visible ? 5 * 60_000 : 60_000
    const remaining = entry.idleSince + keepAliveMs - this.#now()
    if (remaining <= 0) {
      void this.#reclaimIdle(entry)
      return
    }
    entry.idleTimer = setTimeout(() => void this.#reclaimIdle(entry), remaining)
  }

  async #reclaimIdle(entry: Entry): Promise<void> {
    if (busy(entry) || entry.idleSince === undefined) return
    const keepAliveMs = entry.visible ? 5 * 60_000 : 60_000
    if (this.#now() - entry.idleSince < keepAliveMs) {
      this.#scheduleIdleReclaim(entry)
      return
    }
    await entry.supervisor.stop()
    if (entry.sessionId && this.#bindings.get(entry.sessionId) === entry)
      this.#bindings.delete(entry.sessionId)
    entry.idleSince = undefined
    this.#publishEntry(entry)
    void this.#drain()
  }
}
