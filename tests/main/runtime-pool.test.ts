// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type {
  ApprovalMode,
  ModelSelection,
  OmpEvent,
  PromptInput,
  RuntimeSnapshot,
  ToolApprovalRequest
} from '../../src/shared/desktop-api'
import {
  RuntimePool,
  runtimeEnvironmentFingerprint
} from '../../src/main/runtime-pool'
import type { RuntimeSupervisor } from '../../src/main/runtime-supervisor'

let fakeSessionSequence = 0

class FakeSupervisor extends EventEmitter {
  readonly diagnosticsPath = '/tmp/runtime-pool-test.log'
  snapshot: RuntimeSnapshot = {
    status: 'stopped',
    isStreaming: false,
    queuedMessageCount: 0,
    approvalMode: 'yolo'
  }
  readonly sentFrames: Record<string, unknown>[] = []
  readonly prompts: PromptInput[] = []
  readonly followUps: PromptInput[] = []
  readonly modelSelections: ModelSelection[] = []
  readonly thinkingLevels: string[] = []
  toolApprovals: ToolApprovalRequest[] = []
  newSessionGate?: Promise<void>
  startCount = 0
  stopCount = 0
  startFailuresRemaining = 0
  newSessionFailuresRemaining = 0
  stopGate?: Promise<void>

  recordDiagnostic(): void {}

  setDiagnosticContext(): void {}

  setToolApprovals(approvals: ToolApprovalRequest[]): RuntimeSnapshot {
    this.toolApprovals = approvals
    this.snapshot = { ...this.snapshot, toolApprovals: approvals }
    return this.snapshot
  }

  async start(
    workspacePath: string,
    _env: NodeJS.ProcessEnv,
    approvalMode: ApprovalMode
  ): Promise<RuntimeSnapshot> {
    this.startCount += 1
    if (this.startFailuresRemaining > 0) {
      this.startFailuresRemaining -= 1
      throw new Error('start failed')
    }
    this.snapshot = {
      ...this.snapshot,
      status: 'ready',
      workspacePath,
      approvalMode,
      sessionId: this.snapshot.sessionId ?? `session-${++fakeSessionSequence}`
    }
    this.emit('snapshot', this.snapshot)
    return this.snapshot
  }

  async stop(): Promise<void> {
    this.stopCount += 1
    await this.stopGate
    this.snapshot = {
      ...this.snapshot,
      status: 'stopped',
      isStreaming: false,
      queuedMessageCount: 0
    }
    this.emit('snapshot', this.snapshot)
  }

  async newSession(): Promise<RuntimeSnapshot> {
    await this.newSessionGate
    if (this.newSessionFailuresRemaining > 0) {
      this.newSessionFailuresRemaining -= 1
      throw new Error('new session failed')
    }
    this.snapshot = {
      ...this.snapshot,
      sessionId: `session-${++fakeSessionSequence}`,
      isStreaming: false
    }
    this.emit('snapshot', this.snapshot)
    return this.snapshot
  }

  async switchSession(sessionId: string): Promise<RuntimeSnapshot> {
    this.snapshot = { ...this.snapshot, sessionId }
    this.emit('snapshot', this.snapshot)
    return this.snapshot
  }

  trustSession(): void {}

  async setSessionName(): Promise<void> {}

  sendFrame(frame: Record<string, unknown>): void {
    this.sentFrames.push(frame)
  }

  async prompt(input: PromptInput): Promise<void> {
    this.prompts.push(input)
    this.snapshot = { ...this.snapshot, isStreaming: true }
    this.emit('snapshot', this.snapshot)
    this.emit('event', { type: 'agent_start' } satisfies OmpEvent)
  }

  async followUp(input: PromptInput): Promise<void> {
    this.followUps.push(input)
  }

  async stopCurrentRun(): Promise<PromptInput | null> {
    this.snapshot = { ...this.snapshot, isStreaming: false }
    this.emit('snapshot', this.snapshot)
    return null
  }

  async selectModel(selection: ModelSelection): Promise<RuntimeSnapshot> {
    this.modelSelections.push(selection)
    return this.snapshot
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.thinkingLevels.push(level)
  }

  complete(): void {
    this.snapshot = { ...this.snapshot, isStreaming: false }
    this.emit('snapshot', this.snapshot)
    this.emit('event', { type: 'agent_end' } satisfies OmpEvent)
  }

  crash(): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'failed',
      isStreaming: false,
      queuedMessageCount: 0,
      error: { code: 'CRASHED', message: 'crashed', retryable: true }
    }
    this.emit('snapshot', this.snapshot)
  }

  finishLocalCommand(): void {
    this.snapshot = { ...this.snapshot, isStreaming: false }
    this.emit('snapshot', this.snapshot)
    this.emit('event', {
      type: 'prompt_result',
      agentInvoked: false
    } satisfies OmpEvent)
  }
}

function asSupervisor(value: FakeSupervisor): RuntimeSupervisor {
  return value as unknown as RuntimeSupervisor
}

describe('RuntimePool', () => {
  it('环境指纹忽略 Shell 易变字段，但区分代理环境', () => {
    const first = runtimeEnvironmentFingerprint(
      '/workspace',
      { PATH: '/bin', PWD: '/one', HTTP_PROXY: 'http://127.0.0.1:7890' },
      'yolo'
    )
    const same = runtimeEnvironmentFingerprint(
      '/workspace',
      { HTTP_PROXY: 'http://127.0.0.1:7890', PWD: '/two', PATH: '/bin' },
      'yolo'
    )
    const different = runtimeEnvironmentFingerprint(
      '/workspace',
      { PATH: '/bin', HTTP_PROXY: 'http://127.0.0.1:1080' },
      'yolo'
    )
    expect(same).toBe(first)
    expect(different).not.toBe(first)
  })

  it('正在运行的 Session 不被切换，并为新 Session 分配第二个 Runtime', async () => {
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })
    const firstSessionId = pool.snapshot.sessionId

    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    await pool.prompt({ message: 'second' })

    expect(supervisors).toHaveLength(2)
    expect(
      pool.states.filter((state) => state.phase === 'running')
    ).toHaveLength(2)
    expect(pool.states.map((state) => state.sessionId)).toContain(
      firstSessionId
    )
    await pool.stop()
  })

  it('明确目标 Session 不受当前选中 Runtime 影响', async () => {
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const firstSessionId = pool.snapshot.sessionId!
    await pool.prompt({ message: 'first' }, firstSessionId)

    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    const secondSessionId = pool.snapshot.sessionId!
    await pool.prompt({ message: 'second' }, secondSessionId)

    await pool.prompt({ message: 'target-first' }, firstSessionId)
    await pool.followUp({ message: 'follow-first' }, firstSessionId)
    await pool.selectModel(
      { provider: 'test', modelId: 'model-a' },
      firstSessionId
    )
    await pool.setThinkingLevel('high', firstSessionId)
    await pool.stopCurrentRun(firstSessionId)

    expect(supervisors[0]?.prompts.at(-1)).toEqual({ message: 'target-first' })
    expect(supervisors[0]?.followUps).toEqual([{ message: 'follow-first' }])
    expect(supervisors[0]?.modelSelections).toEqual([
      { provider: 'test', modelId: 'model-a' }
    ])
    expect(supervisors[0]?.thinkingLevels).toEqual(['high'])
    expect(supervisors[1]?.prompts).toEqual([{ message: 'second' }])
    expect(supervisors[1]?.followUps).toEqual([])
    await pool.stop()
  })

  it('当前 Session 运行时拒绝使用它的 Runtime 发起 Provider 登录', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })

    expect(() => pool.loginProvider('provider')).toThrow(
      'Provider 登录只能在当前 Session 空闲时开始'
    )
    await pool.stop()
  })

  it('空闲 Runtime 回收后，下一条 Prompt 自动重启并恢复原 Session', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const sessionId = pool.snapshot.sessionId!
    pool.trustSession(sessionId, '/sessions/session.jsonl')
    await supervisor.stop()

    await pool.prompt({ message: 'resume' })

    expect(pool.snapshot).toMatchObject({
      status: 'ready',
      sessionId,
      isStreaming: true
    })
    await pool.stop()
  })

  it('相同环境复用空闲 Runtime，代理环境变化时替换底层进程', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    const direct = { PATH: '/bin' }
    await pool.start('/workspace', direct, 'yolo')

    await pool.prepareNewSession('/workspace', direct, 'yolo')
    expect(supervisor.startCount).toBe(1)
    expect(supervisor.stopCount).toBe(0)
    await pool.newSession()
    await pool.prompt({ message: 'direct' })
    supervisor.complete()

    await pool.prepareNewSession(
      '/workspace',
      { PATH: '/bin', HTTP_PROXY: 'http://127.0.0.1:7890' },
      'yolo'
    )
    expect(supervisor.startCount).toBe(2)
    expect(supervisor.stopCount).toBe(1)
    await pool.stop()
  })

  it('达到上限后等待，并在原 Runtime 空闲后按队首继续', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })

    const waiting = pool.prepareNewSession(
      '/workspace',
      { PATH: '/bin' },
      'yolo'
    )
    expect(pool.waitingCount).toBe(1)
    supervisor.complete()
    await waiting

    expect(pool.waitingCount).toBe(0)
    expect(pool.states).toHaveLength(1)
    await pool.stop()
  })

  it('转发事件时附带 Runtime、generation、Workspace 和 Session', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    const events: OmpEvent[] = []
    pool.on('event', (event) => events.push(event))
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    supervisor.emit('event', { type: 'message_update', id: 'message-1' })

    expect(events.at(-1)).toMatchObject({
      type: 'message_update',
      __desktop: {
        workspacePath: '/workspace',
        sessionId: pool.snapshot.sessionId,
        generation: 2
      }
    })
    expect(events.at(-1)?.['id']).not.toBe('message-1')
    await pool.stop()
  })

  it('为等待任务生成 Temporary Session，并允许按 ID 取消', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })

    const queued = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'queued' },
      title: 'queued'
    })
    expect(queued.queuePosition).toBe(1)
    expect(pool.states).toContainEqual(
      expect.objectContaining({
        sessionId: queued.temporarySessionId,
        phase: 'queued',
        queuePosition: 1,
        temporary: true
      })
    )

    await expect(
      pool.cancelQueuedSession(queued.temporarySessionId)
    ).resolves.toEqual({
      message: 'queued'
    })
    expect(
      pool.states.some((state) => state.sessionId === queued.temporarySessionId)
    ).toBe(false)
    await pool.stop()
  })

  it('Prompt 被 OMP 接收前，启动中的 Temporary Session 仍可取消', async () => {
    let releaseNewSession: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseNewSession = resolve
    })
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      if (supervisors.length === 1) supervisor.newSessionGate = gate
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })

    const queued = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'cancel while starting' },
      title: 'starting'
    })
    await vi.waitFor(() => {
      expect(pool.states).toContainEqual(
        expect.objectContaining({
          sessionId: queued.temporarySessionId,
          phase: 'starting'
        })
      )
    })

    const cancellation = pool.cancelQueuedSession(queued.temporarySessionId)
    releaseNewSession?.()
    await expect(cancellation).resolves.toEqual({
      message: 'cancel while starting'
    })
    expect(supervisors[1]?.snapshot.isStreaming).toBe(false)
    expect(
      pool.states.some((state) => state.sessionId === queued.temporarySessionId)
    ).toBe(false)
    await pool.stop()
  })

  it('Temporary Session 在 Prompt 被接收后绑定正式 Session ID', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const bound = vi.fn()
    pool.on('temporary-session-bound', bound)

    const submission = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'bind me' },
      title: 'bound'
    })
    await vi.waitFor(() => expect(bound).toHaveBeenCalledOnce())

    expect(bound).toHaveBeenCalledWith(
      expect.objectContaining({
        temporarySessionId: submission.temporarySessionId,
        snapshot: expect.objectContaining({
          sessionId: expect.stringMatching(/^session-/u),
          isStreaming: true
        })
      })
    )
    expect(
      pool.states.some(
        (state) => state.sessionId === submission.temporarySessionId
      )
    ).toBe(false)
    await pool.stop()
  })

  it('new_session 首次失败时用新进程重试一次', async () => {
    const supervisor = new FakeSupervisor()
    supervisor.newSessionFailuresRemaining = 1
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const bound = vi.fn()
    pool.on('temporary-session-bound', bound)

    pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'retry' },
      title: 'retry'
    })
    await vi.waitFor(() => expect(bound).toHaveBeenCalledOnce())

    expect(supervisor.startCount).toBe(2)
    expect(supervisor.stopCount).toBe(1)
    await pool.stop()
  })

  it('Temporary Session 连续启动失败后恢复原输入并释放任务', async () => {
    const supervisor = new FakeSupervisor()
    supervisor.newSessionFailuresRemaining = 2
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const failed = vi.fn()
    pool.on('temporary-session-failed', failed)

    const submission = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'restore me' },
      title: 'failed'
    })
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())

    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        temporarySessionId: submission.temporarySessionId,
        input: { message: 'restore me' },
        reason: 'start-failed'
      })
    )
    expect(
      pool.states.some(
        (state) => state.sessionId === submission.temporarySessionId
      )
    ).toBe(false)
    await pool.stop()
  })

  it('全局 Runtime 等待队列最多保留 20 个任务', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })

    for (let index = 0; index < 20; index += 1) {
      const submission = pool.enqueueNewSession({
        workspacePath: '/workspace',
        env: { PATH: '/bin' },
        approvalMode: 'yolo',
        input: { message: `queued-${index}` },
        title: `queued-${index}`
      })
      expect(submission.queuePosition).toBe(index + 1)
    }
    expect(() =>
      pool.enqueueNewSession({
        workspacePath: '/workspace',
        env: { PATH: '/bin' },
        approvalMode: 'yolo',
        input: { message: 'overflow' },
        title: 'overflow'
      })
    ).toThrow('等待队列已满')
    expect(pool.waitingCount).toBe(20)
    await pool.stop()
  })

  it('全局 Runtime 等待队列超过字节上限时拒绝新任务', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1,
      maxQueuedBytes: 64
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })
    pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: '1234567890' },
      title: 'first'
    })

    expect(() =>
      pool.enqueueNewSession({
        workspacePath: '/workspace',
        env: { PATH: '/bin' },
        approvalMode: 'yolo',
        input: { message: '1234567890123456789012345678901234567890' },
        title: 'overflow'
      })
    ).toThrow('Runtime 等待队列内容已达到 64 MiB 上限')
    expect(pool.waitingCount).toBe(1)
    await pool.stop()
  })

  it('退出时静默清理尚未开始的 Temporary Session', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })
    const submission = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'discard on exit' },
      title: 'discard'
    })

    await pool.stop()
    await vi.waitFor(() =>
      expect(
        pool.states.some(
          (state) => state.sessionId === submission.temporarySessionId
        )
      ).toBe(false)
    )
    expect(pool.waitingCount).toBe(0)
  })

  it('每个 Session 最多保留 5 条未执行 Follow-up', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })
    for (let index = 0; index < 5; index += 1)
      await pool.followUp({ message: `follow-up-${index}` })

    expect(() => pool.followUp({ message: 'overflow' })).toThrow(
      '最多等待 5 条 Follow-up'
    )
    await pool.stop()
  })

  it('所有 Runtime 的 Follow-up 合计超过字节上限时拒绝新输入', async () => {
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({
      createSupervisor,
      maxParallel: 2,
      maxFollowUpBytes: 80
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })
    await pool.followUp({ message: '123456789012345678901234567890' })
    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    await pool.prompt({ message: 'second' })

    expect(() =>
      pool.followUp({ message: '123456789012345678901234567890' })
    ).toThrow('Follow-up 等待内容已达到 64 MiB 上限')
    await pool.stop()
  })

  it('需要 OMP 的 Slash Command 与普通 Prompt 共用全局队列', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor),
      maxParallel: 1
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'running' })
    const bound = vi.fn()
    pool.on('temporary-session-bound', bound)

    const submission = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: '/compact' },
      title: '/compact'
    })
    expect(submission.queuePosition).toBe(1)
    supervisor.finishLocalCommand()
    await vi.waitFor(() => expect(bound).toHaveBeenCalledOnce())
    expect(supervisor.snapshot.isStreaming).toBe(true)
    await pool.stop()
  })

  it('相同的 Extension ID 仍按 Runtime 来源返回', async () => {
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    const events: OmpEvent[] = []
    pool.on('event', (event) => events.push(event))
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })
    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    await pool.prompt({ message: 'second' })

    for (const supervisor of supervisors)
      supervisor.emit('event', {
        type: 'extension_ui_request',
        id: 'same-id',
        method: 'confirm'
      })
    const ids = events.map((event) => event['id']).filter(Boolean) as string[]
    expect(new Set(ids).size).toBe(2)
    expect(
      new Set(
        events.map(
          (event) =>
            (event['__desktop'] as { sessionId?: string } | undefined)
              ?.sessionId
        )
      ).size
    ).toBe(2)
    expect(
      pool.states.flatMap((state) => state.pendingExtensionUi ?? [])
    ).toHaveLength(2)
    pool.setToolApprovals(
      ids.map((id, index) => ({
        id,
        summary: `approval-${index}`,
        status: 'pending',
        deadline: Date.now() + 1_000
      }))
    )
    expect(supervisors[0]?.toolApprovals).toEqual([
      expect.objectContaining({ id: ids[0] })
    ])
    expect(supervisors[1]?.toolApprovals).toEqual([
      expect.objectContaining({ id: ids[1] })
    ])
    const firstSessionId = (
      events[0]?.['__desktop'] as { sessionId?: string } | undefined
    )?.sessionId
    const secondSessionId = (
      events[1]?.['__desktop'] as { sessionId?: string } | undefined
    )?.sessionId
    expect(() =>
      pool.sendFrame(
        { type: 'extension_ui_response', id: ids[0], value: true },
        secondSessionId
      )
    ).toThrow('交互请求不属于目标 Session')
    pool.sendFrame(
      { type: 'extension_ui_response', id: ids[0], value: true },
      firstSessionId
    )
    pool.sendFrame(
      { type: 'extension_ui_response', id: ids[1], value: false },
      secondSessionId
    )
    expect(supervisors[0]?.sentFrames.at(-1)).toMatchObject({ id: 'same-id' })
    expect(supervisors[1]?.sentFrames.at(-1)).toMatchObject({ id: 'same-id' })
    expect(
      pool.states.flatMap((state) => state.pendingExtensionUi ?? [])
    ).toHaveLength(0)
    await pool.stop()
  })

  it('单个 Runtime 崩溃不中断其他 Session，并用释放的名额继续队首任务', async () => {
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })
    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    await pool.prompt({ message: 'second' })
    const bound = vi.fn()
    pool.on('temporary-session-bound', bound)
    const waiting = pool.enqueueNewSession({
      workspacePath: '/workspace',
      env: { PATH: '/bin' },
      approvalMode: 'yolo',
      input: { message: 'third' },
      title: 'third'
    })
    expect(waiting.queuePosition).toBe(1)

    supervisors[0]?.crash()
    await vi.waitFor(() => expect(bound).toHaveBeenCalledOnce())

    expect(supervisors[1]?.snapshot.isStreaming).toBe(true)
    expect(pool.waitingCount).toBe(0)
    expect(
      pool.states.filter((state) => state.phase === 'running')
    ).toHaveLength(2)
    await pool.stop()
  })

  it('Runtime 崩溃后保留失败状态，手动重试被接收后清除', async () => {
    const supervisor = new FakeSupervisor()
    const pool = new RuntimePool({
      createSupervisor: () => asSupervisor(supervisor),
      initialSupervisor: asSupervisor(supervisor)
    })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    const sessionId = pool.snapshot.sessionId!
    pool.trustSession(sessionId, '/tmp/session.jsonl')
    await pool.prompt({ message: 'first' }, sessionId)

    supervisor.crash()
    expect(
      pool.states.find((state) => state.sessionId === sessionId)?.phase
    ).toBe('failed')

    await pool.prompt({ message: 'retry' }, sessionId)
    expect(
      pool.states.find((state) => state.sessionId === sessionId)?.phase
    ).toBe('running')
    expect(supervisor.prompts.at(-1)).toEqual({ message: 'retry' })
    await pool.stop()
  })

  it('退出时并行停止所有 Runtime，不逐个等待', async () => {
    let releaseStops: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseStops = resolve
    })
    const supervisors: FakeSupervisor[] = []
    const createSupervisor = (): RuntimeSupervisor => {
      const supervisor = new FakeSupervisor()
      supervisors.push(supervisor)
      return asSupervisor(supervisor)
    }
    const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
    await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.prompt({ message: 'first' })
    await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
    await pool.newSession()
    await pool.prompt({ message: 'second' })
    for (const supervisor of supervisors) supervisor.stopGate = gate

    const stopping = pool.stop()
    await vi.waitFor(() =>
      expect(supervisors.map((supervisor) => supervisor.stopCount)).toEqual([
        1, 1
      ])
    )
    releaseStops?.()
    await stopping
  })

  it('后台空闲 Runtime 保留 60 秒，当前可见 Runtime 保留 5 分钟', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const supervisors: FakeSupervisor[] = []
      const createSupervisor = (): RuntimeSupervisor => {
        const supervisor = new FakeSupervisor()
        supervisors.push(supervisor)
        return asSupervisor(supervisor)
      }
      const pool = new RuntimePool({ createSupervisor, maxParallel: 2 })
      await pool.start('/workspace', { PATH: '/bin' }, 'yolo')
      await pool.prompt({ message: 'first' })
      await pool.prepareNewSession('/workspace', { PATH: '/bin' }, 'yolo')
      await pool.newSession()
      await pool.prompt({ message: 'second' })
      supervisors[0]?.complete()
      supervisors[1]?.complete()

      await vi.advanceTimersByTimeAsync(60_001)
      expect(supervisors[0]?.stopCount).toBe(1)
      expect(supervisors[1]?.stopCount).toBe(0)

      await vi.advanceTimersByTimeAsync(240_000)
      expect(supervisors[1]?.stopCount).toBe(1)
      await pool.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
