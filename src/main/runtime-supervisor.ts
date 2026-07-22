import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions
} from 'node:child_process'
import type {
  OmpEvent,
  PromptInput,
  RuntimeError,
  RuntimeSnapshot
} from '../shared/desktop-api'
import { JsonlDecoder, JsonlFrameTooLargeError } from './jsonl-decoder'
import { redactRuntimeLog } from './runtime-diagnostics'
import type { RuntimeDiagnostics } from './runtime-diagnostics'

type RpcResponse = {
  type: 'response'
  id?: string
  command: string
  success: boolean
  data?: unknown
  error?: string
}

type PendingRequest = {
  generation: number
  resolve: (response: RpcResponse) => void
  reject: (error: RuntimeFailure) => void
  timer: NodeJS.Timeout
}

type SpawnRuntime = (
  executable: string,
  args: string[],
  options: SpawnOptions
) => ChildProcessWithoutNullStreams

export type RuntimeSupervisorOptions = {
  runtimePath: string
  diagnostics: RuntimeDiagnostics
  spawnRuntime?: SpawnRuntime
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  now?: () => number
}

const STATE_TIMEOUT_MS = 5_000
const MUTATION_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 5_000
const TERM_TIMEOUT_MS = 2_000
const CRASH_WINDOW_MS = 60_000

export class RuntimeFailure extends Error implements RuntimeError {
  constructor(
    readonly code: RuntimeError['code'],
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'RuntimeFailure'
  }

  toJSON(): RuntimeError {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

function defaultSpawnRuntime(
  executable: string,
  args: string[],
  options: SpawnOptions
): ChildProcessWithoutNullStreams {
  return spawn(executable, args, {
    ...options,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRpcResponse(value: OmpEvent): value is OmpEvent & RpcResponse {
  return (
    value.type === 'response' &&
    typeof value['command'] === 'string' &&
    typeof value['success'] === 'boolean'
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RuntimeSupervisor extends EventEmitter {
  readonly #runtimePath: string
  readonly #diagnostics: RuntimeDiagnostics
  readonly #spawnRuntime: SpawnRuntime
  readonly #readyTimeoutMs: number
  readonly #stopTimeoutMs: number
  readonly #now: () => number

  #child: ChildProcessWithoutNullStreams | null = null
  #generation = 0
  #pending = new Map<string, PendingRequest>()
  #decoder = new JsonlDecoder()
  #startPromise: Promise<RuntimeSnapshot> | null = null
  #intentionalStop = false
  #lastCrashAt = 0
  #workspaceEnv: NodeJS.ProcessEnv = {}
  #trustedSessions = new Map<string, string>()
  #activeInput: PromptInput | null = null
  #queuedInputs: PromptInput[] = []
  #parseErrorTimes: number[] = []
  #recentDiagnostics: string[] = []
  #snapshot: RuntimeSnapshot = {
    status: 'stopped',
    isStreaming: false,
    queuedMessageCount: 0
  }

  constructor(options: RuntimeSupervisorOptions) {
    super()
    this.#runtimePath = options.runtimePath
    this.#diagnostics = options.diagnostics
    this.#spawnRuntime = options.spawnRuntime ?? defaultSpawnRuntime
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 15_000
    this.#stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
    this.#now = options.now ?? Date.now
  }

  get snapshot(): RuntimeSnapshot {
    return { ...this.#snapshot }
  }

  get diagnosticsPath(): string {
    return this.#diagnostics.filePath
  }

  async start(
    workspacePath: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<RuntimeSnapshot> {
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start(workspacePath, env).finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async restart(): Promise<RuntimeSnapshot> {
    const workspacePath = this.#snapshot.workspacePath
    if (!workspacePath) {
      throw new RuntimeFailure('INVALID_ARGUMENT', '尚未选择 Workspace', false)
    }
    const sessionPath = this.#snapshot.sessionPath
    await this.stop()
    const snapshot = await this.start(workspacePath, this.#workspaceEnv)
    if (sessionPath) await this.#restoreSession(sessionPath)
    return this.snapshot.status === 'ready' ? this.snapshot : snapshot
  }

  async stop(): Promise<void> {
    const child = this.#child
    if (!child) {
      this.#setSnapshot({ status: 'stopped', isStreaming: false })
      await this.#diagnostics.flush()
      return
    }

    this.#intentionalStop = true
    this.emit('before-stop')
    this.#setSnapshot({ status: 'stopping' })
    this.#rejectPending(new RuntimeFailure('CRASHED', 'Runtime 正在关闭', true))

    child.stdin.end()
    const exitedGracefully = await this.#waitForExit(child, this.#stopTimeoutMs)
    if (!exitedGracefully) {
      this.#signalProcessGroup(child, 'SIGTERM')
      if (!(await this.#waitForExit(child, TERM_TIMEOUT_MS))) {
        this.#signalProcessGroup(child, 'SIGKILL')
        await this.#waitForExit(child, 500)
      }
    } else if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // 进程组已经完整退出。
      }
    }

    if (this.#child === child) this.#child = null
    this.#decoder.reset()
    this.#queuedInputs = []
    this.#activeInput = null
    this.#setSnapshot({
      status: 'stopped',
      isStreaming: false,
      queuedMessageCount: 0,
      error: undefined
    })
    this.#intentionalStop = false
    await this.#diagnostics.flush()
  }

  async getState(): Promise<RuntimeSnapshot> {
    const response = await this.request({ type: 'get_state' }, STATE_TIMEOUT_MS)
    this.#applyRpcState(response.data)
    return this.snapshot
  }

  async getMessages(): Promise<unknown> {
    return (await this.request({ type: 'get_messages' }, STATE_TIMEOUT_MS)).data
  }

  async prompt(input: PromptInput): Promise<void> {
    this.#validatePrompt(input)
    if (this.#snapshot.isStreaming || this.#snapshot.queuedMessageCount > 0) {
      await this.followUp(input)
      return
    }
    this.#activeInput = structuredClone(input)
    try {
      await this.request({ type: 'prompt', ...input }, STATE_TIMEOUT_MS)
      this.#setSnapshot({ isStreaming: true })
    } catch (error) {
      this.#activeInput = null
      throw error
    }
  }

  async followUp(input: PromptInput): Promise<void> {
    this.#validatePrompt(input)
    if (input.message.trimStart().startsWith('/')) {
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        '任务运行期间不能发送 Slash Command',
        false
      )
    }
    await this.request({ type: 'follow_up', ...input }, STATE_TIMEOUT_MS)
    this.#queuedInputs.push(structuredClone(input))
    this.#setSnapshot({
      queuedMessageCount: this.#snapshot.queuedMessageCount + 1
    })
  }

  async stopCurrentRun(): Promise<PromptInput | null> {
    const restoredInput = this.#activeInput
      ? structuredClone(this.#activeInput)
      : null
    const sessionPath = this.#snapshot.sessionPath

    try {
      await this.request({ type: 'abort' }, this.#stopTimeoutMs)
      if (sessionPath) {
        const response = await this.request(
          { type: 'switch_session', sessionPath },
          this.#stopTimeoutMs
        )
        const data = isRecord(response.data) ? response.data : {}
        if (data['cancelled'] === true) {
          throw new RuntimeFailure(
            'CRASHED',
            'Extension 取消了 Session 重载',
            true
          )
        }
        await this.getMessages()
      } else {
        await this.restart()
      }
    } catch {
      await this.restart()
    }

    this.#activeInput = null
    this.#queuedInputs = []
    this.#setSnapshot({ isStreaming: false, queuedMessageCount: 0 })
    return restoredInput
  }

  async newSession(): Promise<RuntimeSnapshot> {
    await this.request({ type: 'new_session' }, MUTATION_TIMEOUT_MS)
    return this.getState()
  }

  async switchSession(sessionId: string): Promise<RuntimeSnapshot> {
    const sessionPath = this.#trustedSessions.get(sessionId)
    if (!sessionPath) {
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 不存在或不受信任',
        false
      )
    }
    await this.request(
      { type: 'switch_session', sessionPath },
      MUTATION_TIMEOUT_MS
    )
    return this.getState()
  }

  async restoreSessionPath(sessionPath: string): Promise<RuntimeSnapshot> {
    if (!isAbsolute(sessionPath)) {
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        'Session 路径必须是绝对路径',
        false
      )
    }
    await this.#restoreSession(sessionPath)
    return this.snapshot
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    if (this.#snapshot.isStreaming || this.#snapshot.queuedMessageCount > 0) {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '任务运行期间不能切换模型',
        true
      )
    }
    if (!provider.trim() || !modelId.trim()) {
      throw new RuntimeFailure('INVALID_ARGUMENT', '模型参数无效', false)
    }
    await this.request(
      { type: 'set_model', provider, modelId },
      MUTATION_TIMEOUT_MS
    )
  }

  async setThinkingLevel(level: string): Promise<void> {
    if (this.#snapshot.isStreaming || this.#snapshot.queuedMessageCount > 0) {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '任务运行期间不能切换 Thinking 等级',
        true
      )
    }
    if (!level.trim()) {
      throw new RuntimeFailure('INVALID_ARGUMENT', 'Thinking 等级无效', false)
    }
    await this.request(
      { type: 'set_thinking_level', level },
      MUTATION_TIMEOUT_MS
    )
  }

  async request(
    command: Record<string, unknown>,
    timeoutMs = MUTATION_TIMEOUT_MS
  ): Promise<RpcResponse> {
    if (this.#snapshot.status === 'starting' && this.#startPromise) {
      await this.#startPromise
      return this.request(command, timeoutMs)
    }
    const child = this.#child
    if (!child || this.#snapshot.status !== 'ready') {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'OMP Runtime 尚未就绪',
        true
      )
    }

    const id = randomUUID()
    const generation = this.#generation
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new RuntimeFailure('RPC_TIMEOUT', 'OMP RPC 请求超时', true))
      }, timeoutMs)

      this.#pending.set(id, { generation, resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return
        const pending = this.#pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        reject(new RuntimeFailure('CRASHED', '写入 OMP RPC 失败', true))
      })
    })
  }

  sendFrame(frame: Record<string, unknown>): void {
    const child = this.#child
    if (!child || this.#snapshot.status !== 'ready') {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'OMP Runtime 尚未就绪',
        true
      )
    }
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  async #start(
    workspacePath: string,
    env: NodeJS.ProcessEnv
  ): Promise<RuntimeSnapshot> {
    await this.#validateStartPaths(workspacePath)
    if (this.#snapshot.workspacePath !== workspacePath) this.#lastCrashAt = 0
    if (this.#child) await this.stop()

    this.#workspaceEnv = { ...env }
    this.#generation += 1
    const generation = this.#generation
    this.#intentionalStop = false
    this.#decoder = new JsonlDecoder()
    this.#parseErrorTimes = []
    this.#recentDiagnostics = []
    this.#setSnapshot({
      status: 'starting',
      workspacePath,
      isStreaming: false,
      queuedMessageCount: 0,
      error: undefined
    })

    const child = this.#spawnRuntime(
      this.#runtimePath,
      ['--mode', 'rpc', '--cwd', workspacePath],
      {
        cwd: workspacePath,
        env: this.#workspaceEnv,
        detached: process.platform !== 'win32',
        shell: false
      }
    )
    this.#child = child

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new RuntimeFailure('START_FAILED', 'OMP ready 超时', true))
      }, this.#readyTimeoutMs)

      const onReady = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const onStartError = (error: Error): void => {
        clearTimeout(timer)
        reject(new RuntimeFailure('START_FAILED', error.message, true))
      }
      this.once(`ready:${generation}`, onReady)
      this.once(`start-error:${generation}`, onStartError)
    })

    this.#attachChild(child, generation)

    try {
      await ready
      if (generation !== this.#generation) {
        throw new RuntimeFailure('CRASHED', 'Runtime 连接已失效', true)
      }
      this.#setSnapshot({ status: 'ready', error: undefined })
      await this.request(
        { type: 'set_follow_up_mode', mode: 'one-at-a-time' },
        STATE_TIMEOUT_MS
      )
      return await this.getState()
    } catch (error) {
      const failure =
        error instanceof RuntimeFailure
          ? error
          : new RuntimeFailure('START_FAILED', String(error), true)
      this.#setSnapshot({
        status: 'failed',
        diagnosticSummary: this.#recentDiagnostics,
        error: failure.toJSON()
      })
      if (this.#child === child) {
        this.#signalProcessGroup(child, 'SIGKILL')
        this.#child = null
      }
      throw failure
    }
  }

  #attachChild(
    child: ChildProcessWithoutNullStreams,
    generation: number
  ): void {
    child.stdout.on('data', (chunk: Buffer) => {
      if (generation !== this.#generation) return
      try {
        for (const line of this.#decoder.push(chunk))
          this.#handleLine(line, generation)
      } catch (error) {
        if (error instanceof JsonlFrameTooLargeError) {
          this.#protocolFailure('RPC 帧超过 16 MiB')
          this.#signalProcessGroup(child, 'SIGKILL')
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (generation !== this.#generation) return
      this.#diagnostics.write(chunk)
      const lines = chunk
        .split(/\r?\n/u)
        .map((line) => redactRuntimeLog(line, 512).trim())
        .filter(Boolean)
      this.#recentDiagnostics = [...this.#recentDiagnostics, ...lines].slice(-5)
    })

    child.once('error', (error) => {
      if (generation !== this.#generation) return
      this.emit(`start-error:${generation}`, error)
    })

    child.once('exit', (code, signal) => {
      void this.#handleExit(child, generation, code, signal)
    })
  }

  #handleLine(line: string, generation: number): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.#recordParseError(line)
      return
    }

    if (!isRecord(parsed) || typeof parsed['type'] !== 'string') {
      this.#recordParseError(line)
      return
    }
    const frame = parsed as OmpEvent

    if (frame.type === 'ready') {
      this.emit(`ready:${generation}`)
      return
    }

    if (isRpcResponse(frame)) {
      const id = frame.id
      const pending = id ? this.#pending.get(id) : undefined
      if (!id || !pending || pending.generation !== generation) {
        this.#diagnostics.write(
          `忽略无法关联的 RPC 响应: ${redactRuntimeLog(line, 512)}`
        )
        return
      }
      clearTimeout(pending.timer)
      this.#pending.delete(id)
      if (frame.success) pending.resolve(frame)
      else {
        pending.reject(
          new RuntimeFailure(
            frame.command === 'switch_session'
              ? 'SESSION_NOT_FOUND'
              : 'INVALID_ARGUMENT',
            typeof frame.error === 'string' ? frame.error : 'OMP RPC 请求失败',
            false
          )
        )
      }
      return
    }

    this.#applyEventState(frame)
    this.emit('event', frame)
  }

  #applyEventState(event: OmpEvent): void {
    if (event.type === 'agent_start') {
      this.#setSnapshot({ isStreaming: true })
    } else if (event.type === 'agent_end') {
      this.#activeInput = this.#queuedInputs.shift() ?? null
      this.#setSnapshot({
        isStreaming: this.#activeInput !== null,
        queuedMessageCount: this.#queuedInputs.length
      })
    } else if (
      event.type === 'prompt_result' &&
      event['agentInvoked'] === false
    ) {
      this.#activeInput = null
      this.#setSnapshot({ isStreaming: false })
    }
  }

  #applyRpcState(value: unknown): void {
    if (!isRecord(value)) return
    const sessionId =
      typeof value['sessionId'] === 'string' ? value['sessionId'] : undefined
    const sessionPath =
      typeof value['sessionFile'] === 'string'
        ? value['sessionFile']
        : undefined
    if (sessionId && sessionPath)
      this.#trustedSessions.set(sessionId, sessionPath)

    const model = isRecord(value['model'])
      ? [value['model']['provider'], value['model']['id']]
          .filter((part): part is string => typeof part === 'string')
          .join('/')
      : undefined

    this.#setSnapshot({
      sessionId,
      sessionPath,
      isStreaming:
        typeof value['isStreaming'] === 'boolean'
          ? value['isStreaming']
          : this.#snapshot.isStreaming,
      queuedMessageCount:
        typeof value['queuedMessageCount'] === 'number'
          ? value['queuedMessageCount']
          : this.#snapshot.queuedMessageCount,
      model: model || undefined,
      thinkingLevel:
        typeof value['thinkingLevel'] === 'string'
          ? value['thinkingLevel']
          : undefined
    })
  }

  #recordParseError(line: string): void {
    const now = this.#now()
    this.#parseErrorTimes = this.#parseErrorTimes.filter(
      (timestamp) => now - timestamp <= 10_000
    )
    this.#parseErrorTimes.push(now)
    this.#diagnostics.write(
      `RPC_PROTOCOL_ERROR: ${redactRuntimeLog(line, 1_024)}`
    )
    this.emit('event', {
      type: 'RPC_PROTOCOL_ERROR',
      message: 'OMP 输出了无效 JSONL'
    } satisfies OmpEvent)
    if (this.#parseErrorTimes.length >= 3 && this.#child) {
      this.#protocolFailure('10 秒内连续出现 3 条无效 RPC 消息')
      this.#signalProcessGroup(this.#child, 'SIGKILL')
    }
  }

  #protocolFailure(message: string): void {
    const failure = new RuntimeFailure('PROTOCOL_ERROR', message, true)
    this.#rejectPending(failure)
    this.#setSnapshot({ status: 'failed', error: failure.toJSON() })
  }

  async #handleExit(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    code: number | null,
    signal: NodeJS.Signals | null
  ): Promise<void> {
    if (generation !== this.#generation) return
    if (this.#child === child) this.#child = null
    this.#decoder.reset()

    if (this.#intentionalStop) return

    // Runtime 根进程异常退出后，它启动的 Bash、Browser 等后代进程可能仍在
    // 同一进程组中运行。此时根进程已经无法再负责清理，必须由 Main 收尾。
    this.#signalProcessGroup(child, 'SIGKILL')

    if (this.#snapshot.status === 'starting') {
      this.emit(
        `start-error:${generation}`,
        new Error(
          `OMP 在 ready 前退出（code=${String(code)}, signal=${String(signal)}）`
        )
      )
      return
    }

    const failure = new RuntimeFailure(
      'CRASHED',
      `OMP Runtime 已退出（code=${String(code)}, signal=${String(signal)}）`,
      true
    )
    this.#diagnostics.write(failure.message)
    this.#rejectPending(failure)
    if (this.#activeInput) {
      this.emit('event', {
        type: 'runtime_interrupted',
        input: structuredClone(this.#activeInput)
      } satisfies OmpEvent)
    }
    this.#activeInput = null
    this.#queuedInputs = []
    this.#setSnapshot({
      status: 'failed',
      isStreaming: false,
      queuedMessageCount: 0,
      diagnosticSummary: this.#recentDiagnostics,
      error: failure.toJSON()
    })

    const workspacePath = this.#snapshot.workspacePath
    const now = this.#now()
    if (
      !workspacePath ||
      (this.#lastCrashAt && now - this.#lastCrashAt < CRASH_WINDOW_MS)
    ) {
      return
    }
    this.#lastCrashAt = now
    const sessionPath = this.#snapshot.sessionPath
    try {
      await this.start(workspacePath, this.#workspaceEnv)
      if (sessionPath) await this.#restoreSession(sessionPath)
    } catch {
      // start() 已更新错误状态，等待用户手动重试。
    }
  }

  async #restoreSession(sessionPath: string): Promise<void> {
    const response = await this.request(
      { type: 'switch_session', sessionPath },
      MUTATION_TIMEOUT_MS
    )
    const data = isRecord(response.data) ? response.data : {}
    if (data['cancelled'] === true) {
      throw new RuntimeFailure('SESSION_NOT_FOUND', 'Session 恢复被取消', false)
    }
    await this.getState()
    await this.getMessages()
  }

  async #validateStartPaths(workspacePath: string): Promise<void> {
    if (!isAbsolute(workspacePath)) {
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        'Workspace 必须是绝对路径',
        false
      )
    }
    const [workspace, runtime] = await Promise.all([
      stat(workspacePath).catch(() => null),
      stat(this.#runtimePath).catch(() => null)
    ])
    if (!workspace?.isDirectory()) {
      throw new RuntimeFailure('INVALID_ARGUMENT', 'Workspace 不存在', false)
    }
    if (!runtime?.isFile()) {
      throw new RuntimeFailure('START_FAILED', 'OMP Runtime 不存在', false)
    }
  }

  #validatePrompt(input: PromptInput): void {
    if (!input.message.trim() && !input.images?.length) {
      throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 不能为空', false)
    }
  }

  #setSnapshot(patch: Partial<RuntimeSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    this.emit('snapshot', this.snapshot)
  }

  #rejectPending(error: RuntimeFailure): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #signalProcessGroup(
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals
  ): void {
    try {
      if (process.platform !== 'win32' && child.pid)
        process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      child.kill(signal)
    }
  }

  async #waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true
    return Promise.race([
      new Promise<boolean>((resolve) =>
        child.once('exit', () => resolve(true))
      ),
      delay(timeoutMs).then(() => false)
    ])
  }
}
