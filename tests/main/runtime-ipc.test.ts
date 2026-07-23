import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/desktop-api'
import type { RuntimeSupervisor } from '../../src/main/runtime-supervisor'

const electron = vi.hoisted(() => ({
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: electron.showMessageBox,
    showOpenDialog: electron.showOpenDialog
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    on: (channel: string, listener: (...args: unknown[]) => unknown) =>
      electron.listeners.set(channel, listener),
    off: (channel: string) => electron.listeners.delete(channel),
    removeHandler: (channel: string) => {
      electron.removeHandler(channel)
      electron.handlers.delete(channel)
    }
  },
  shell: {
    openExternal: electron.openExternal,
    openPath: electron.openPath,
    showItemInFolder: electron.showItemInFolder
  }
}))

describe('registerRuntimeIpc', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.listeners.clear()
    electron.removeHandler.mockClear()
    electron.send.mockClear()
    electron.openExternal.mockReset()
    electron.openExternal.mockResolvedValue(undefined)
    electron.openPath.mockReset()
    electron.showItemInFolder.mockReset()
    electron.showMessageBox.mockReset()
    electron.showOpenDialog.mockReset()
  })

  it('Renderer 重载后重放尚未回答的 Extension UI 请求', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const emitter = new EventEmitter()
    const supervisor = Object.assign(emitter, {
      diagnosticsPath: '/tmp/runtime.log',
      sendFrame: vi.fn(),
      snapshot: {
        status: 'ready',
        isStreaming: false,
        queuedMessageCount: 0
      }
    }) as unknown as RuntimeSupervisor
    const webContents = {
      isDestroyed: () => false,
      send: electron.send
    }
    const cleanup = registerRuntimeIpc(
      supervisor,
      () => ({ isDestroyed: () => false, webContents }) as never
    )
    const request = {
      type: 'extension_ui_request',
      id: 'ui-1',
      method: 'confirm',
      title: '确认',
      message: '继续吗？'
    }

    emitter.emit('event', request)
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
      type: 'omp-event',
      event: request
    })

    electron.send.mockClear()
    electron.listeners.get(IPC_CHANNELS.rendererReady)?.()
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
      type: 'omp-event',
      event: request
    })

    cleanup()
  })

  it('OAuth URL 只留在 Main，登录输入通过 Extension UI 回传', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const harness = createHarness()
    let finishLogin: (() => void) | undefined
    harness.supervisor.loginProvider = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve
        })
    )
    const cleanup = registerRuntimeIpc(
      harness.supervisor as unknown as RuntimeSupervisor,
      harness.getWindow
    )

    const login = electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      harness.event,
      'browser'
    ) as Promise<unknown>
    harness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'open-1',
      method: 'open_url',
      url: 'https://example.com/oauth?code=private-url-code',
      instructions: '打开 https://example.com/private 完成授权'
    })
    harness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'input-1',
      method: 'input',
      message: '输入 API_KEY=private-message-key'
    })

    expect(electron.openExternal).toHaveBeenCalledWith(
      'https://example.com/oauth?code=private-url-code'
    )
    const rendererPayload = JSON.stringify(electron.send.mock.calls)
    expect(rendererPayload).not.toContain('private-url-code')
    expect(rendererPayload).not.toContain('private-message-key')
    expect(rendererPayload).toContain('[链接已隐藏]')
    expect(rendererPayload).toContain('[REDACTED]')

    const response = await electron.handlers.get(
      IPC_CHANNELS.respondExtensionUi
    )?.(harness.event, 'input-1', { value: 'private-input-value' })
    expect(response).toMatchObject({ ok: true })
    expect(harness.supervisor.sendFrame).toHaveBeenCalledWith({
      type: 'extension_ui_response',
      id: 'input-1',
      value: 'private-input-value'
    })
    expect(JSON.stringify(electron.send.mock.calls)).not.toContain(
      'private-input-value'
    )

    finishLogin?.()
    await expect(login).resolves.toMatchObject({ ok: true })
    cleanup()
  })

  it('浏览器打开失败时保留重试状态', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const harness = createHarness()
    harness.supervisor.loginProvider = vi.fn(() => new Promise(() => undefined))
    electron.openExternal.mockRejectedValueOnce(new Error('browser failed'))
    const cleanup = registerRuntimeIpc(
      harness.supervisor as unknown as RuntimeSupervisor,
      harness.getWindow
    )
    void electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      harness.event,
      'browser'
    )

    harness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'open-2',
      method: 'open_url',
      url: 'https://example.com/oauth'
    })
    await vi.waitFor(() =>
      expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
        type: 'provider-login',
        state: expect.objectContaining({
          message: '无法打开系统浏览器',
          canReopenBrowser: true
        })
      })
    )
    cleanup()
  })

  it('未知登录错误写入脱敏诊断，Renderer 只收到限长错误', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const harness = createHarness()
    harness.supervisor.loginProvider = vi
      .fn()
      .mockRejectedValue(
        new Error(
          `API_KEY=private-key https://example.com/callback?code=private ${'x'.repeat(800)}`
        )
      )
    const cleanup = registerRuntimeIpc(
      harness.supervisor as unknown as RuntimeSupervisor,
      harness.getWindow
    )

    const result = await electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      harness.event,
      'broken'
    )
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    const diagnostic = String(
      vi.mocked(harness.supervisor.recordDiagnostic).mock.calls[0]?.[0]
    )
    expect(diagnostic).not.toContain('private-key')
    expect(diagnostic).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect(JSON.stringify(result).length).toBeLessThan(500)
    cleanup()
  })

  it('区分 Terminal 登录、输入超时和用户取消', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')

    const terminalHarness = createHarness()
    terminalHarness.supervisor.loginProvider = vi
      .fn()
      .mockRejectedValue(new Error('Provider requires interactive prompts'))
    let cleanup = registerRuntimeIpc(
      terminalHarness.supervisor as unknown as RuntimeSupervisor,
      terminalHarness.getWindow
    )
    await expect(
      electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
        terminalHarness.event,
        'terminal'
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'UNSUPPORTED',
        message: '该 Provider 需要在 OMP Terminal 登录'
      }
    })
    cleanup()

    const timeoutHarness = createHarness()
    let rejectTimeout: ((error: Error) => void) | undefined
    timeoutHarness.supervisor.loginProvider = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectTimeout = reject
        })
    )
    cleanup = registerRuntimeIpc(
      timeoutHarness.supervisor as unknown as RuntimeSupervisor,
      timeoutHarness.getWindow
    )
    const timedLogin = electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      timeoutHarness.event,
      'api-key'
    ) as Promise<unknown>
    timeoutHarness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'timed-input',
      method: 'input',
      message: 'API Key',
      timeout: 5
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    rejectTimeout?.(new Error('Login cancelled'))
    await expect(timedLogin).resolves.toMatchObject({
      ok: false,
      error: { code: 'RPC_TIMEOUT', message: '登录输入超时' }
    })
    cleanup()

    const cancelHarness = createHarness()
    let rejectCancelled: ((error: Error) => void) | undefined
    cancelHarness.supervisor.loginProvider = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCancelled = reject
        })
    )
    cleanup = registerRuntimeIpc(
      cancelHarness.supervisor as unknown as RuntimeSupervisor,
      cancelHarness.getWindow
    )
    const cancelledLogin = electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      cancelHarness.event,
      'api-key'
    ) as Promise<unknown>
    cancelHarness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'cancel-input',
      method: 'input',
      message: 'API Key'
    })
    const cancellation = electron.handlers.get(
      IPC_CHANNELS.cancelProviderLogin
    )?.(cancelHarness.event) as Promise<unknown>
    rejectCancelled?.(new Error('Login cancelled'))
    await expect(cancellation).resolves.toMatchObject({ ok: true })
    await expect(cancelledLogin).resolves.toMatchObject({
      ok: false,
      error: { message: '登录已取消' }
    })
    expect(cancelHarness.supervisor.sendFrame).toHaveBeenCalledWith({
      type: 'extension_ui_response',
      id: 'cancel-input',
      cancelled: true
    })
    cleanup()
  })

  it('Renderer 重载恢复登录步骤，但不保存已提交输入', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const harness = createHarness()
    harness.supervisor.loginProvider = vi.fn(() => new Promise(() => undefined))
    const cleanup = registerRuntimeIpc(
      harness.supervisor as unknown as RuntimeSupervisor,
      harness.getWindow
    )
    void electron.handlers.get(IPC_CHANNELS.loginProvider)?.(
      harness.event,
      'browser'
    )
    harness.emitter.emit('event', {
      type: 'extension_ui_request',
      id: 'reload-input',
      method: 'input',
      message: '输入授权码'
    })
    electron.send.mockClear()

    electron.listeners.get(IPC_CHANNELS.rendererReady)?.()
    const replay = JSON.stringify(electron.send.mock.calls)
    expect(replay).toContain('reload-input')
    expect(replay).toContain('输入授权码')
    expect(replay).not.toContain('value')
    cleanup()
  })

  it('切换 Session 和 Workspace 前先停止并应用旧执行链状态', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const harness = createHarness()
    harness.supervisor.snapshot = {
      status: 'ready',
      isStreaming: true,
      queuedMessageCount: 0
    }
    harness.supervisor.stopCurrentRun.mockResolvedValue(null)
    harness.supervisor.switchSession.mockResolvedValue({
      status: 'ready',
      isStreaming: false,
      queuedMessageCount: 0
    })
    harness.supervisor.start.mockResolvedValue({
      status: 'ready',
      workspacePath: '/tmp/new-workspace',
      isStreaming: false,
      queuedMessageCount: 0
    })
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/new-workspace']
    })
    const cleanup = registerRuntimeIpc(
      harness.supervisor as unknown as RuntimeSupervisor,
      harness.getWindow
    )

    await electron.handlers.get(IPC_CHANNELS.switchSession)?.(
      harness.event,
      'session-2'
    )
    expect(harness.supervisor.stopCurrentRun).toHaveBeenCalledTimes(1)
    expect(harness.supervisor.switchSession).toHaveBeenCalledWith('session-2')
    expect(
      harness.supervisor.stopCurrentRun.mock.invocationCallOrder[0]
    ).toBeLessThan(
      harness.supervisor.switchSession.mock.invocationCallOrder[0] ?? Infinity
    )

    harness.supervisor.snapshot.isStreaming = true
    await electron.handlers.get(IPC_CHANNELS.chooseWorkspace)?.(harness.event)
    expect(harness.supervisor.stopCurrentRun).toHaveBeenCalledTimes(2)
    expect(harness.supervisor.start).toHaveBeenCalledWith('/tmp/new-workspace')
    expect(
      harness.supervisor.stopCurrentRun.mock.invocationCallOrder[1]
    ).toBeLessThan(
      harness.supervisor.start.mock.invocationCallOrder[0] ?? Infinity
    )
    cleanup()
  })

  it('事件批次达到数量、字节和单事件上限时立即发送', async () => {
    vi.useFakeTimers()
    try {
      const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
      const harness = createHarness()
      const cleanup = registerRuntimeIpc(
        harness.supervisor as unknown as RuntimeSupervisor,
        harness.getWindow
      )

      for (let index = 0; index < 100; index += 1) {
        harness.emitter.emit('event', {
          type: 'message_update',
          index,
          message: { role: 'assistant', content: [] }
        })
      }
      expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
        type: 'omp-event-batch',
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'message_update', index: 99 })
        ])
      })
      expect(
        vi.mocked(electron.send).mock.calls.find(
          (call) =>
            (
              call[1] as {
                type?: string
                events?: unknown[]
              }
            )?.type === 'omp-event-batch'
        )?.[1]
      ).toMatchObject({ events: { length: 100 } })

      electron.send.mockClear()
      const chunk = 'x'.repeat(140 * 1024)
      harness.emitter.emit('event', {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: chunk }] }
      })
      harness.emitter.emit('event', {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: chunk }] }
      })
      expect(electron.send).toHaveBeenCalledTimes(1)

      electron.send.mockClear()
      harness.emitter.emit('event', {
        type: 'message_update',
        payload: 'x'.repeat(260 * 1024)
      })
      expect(electron.send).toHaveBeenCalledTimes(2)
      cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Tool 进度每 100ms 最多刷新一次，覆盖旧进度且结束不会倒退', async () => {
    vi.useFakeTimers()
    try {
      const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
      const harness = createHarness()
      const cleanup = registerRuntimeIpc(
        harness.supervisor as unknown as RuntimeSupervisor,
        harness.getWindow
      )

      harness.emitter.emit('event', {
        type: 'tool_execution_update',
        toolCallId: 't1',
        partialResult: 'first'
      })
      await vi.advanceTimersByTimeAsync(24)
      harness.emitter.emit('event', {
        type: 'tool_execution_update',
        toolCallId: 't1',
        partialResult: 'stale'
      })
      harness.emitter.emit('event', {
        type: 'tool_execution_update',
        toolCallId: 't1',
        partialResult: 'latest'
      })
      await vi.advanceTimersByTimeAsync(100)

      const progress = vi
        .mocked(electron.send)
        .mock.calls.flatMap((call) => {
          const payload = call[1] as { events?: Array<Record<string, unknown>> }
          return payload.events ?? []
        })
        .filter((event) => event['type'] === 'tool_execution_update')
      expect(progress.map((event) => event['partialResult'])).toEqual([
        'first',
        'latest'
      ])

      harness.emitter.emit('event', {
        type: 'tool_execution_update',
        toolCallId: 't1',
        partialResult: 'must-not-arrive'
      })
      harness.emitter.emit('event', {
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: 'done'
      })
      await vi.advanceTimersByTimeAsync(200)
      const serialized = JSON.stringify(electron.send.mock.calls)
      expect(serialized).not.toContain('must-not-arrive')
      expect(serialized).toContain('tool_execution_end')
      cleanup()
    } finally {
      vi.useRealTimers()
    }
  })
})

type HarnessSupervisor = EventEmitter & {
  diagnosticsPath: string
  recordDiagnostic: ReturnType<typeof vi.fn>
  sendFrame: ReturnType<typeof vi.fn>
  loginProvider: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stopCurrentRun: ReturnType<typeof vi.fn>
  switchSession: ReturnType<typeof vi.fn>
  snapshot: {
    status: string
    isStreaming: boolean
    queuedMessageCount: number
  }
}

function createHarness(): {
  emitter: EventEmitter
  supervisor: HarnessSupervisor
  event: unknown
  getWindow: () => never
} {
  const emitter = new EventEmitter()
  const supervisor = Object.assign(emitter, {
    diagnosticsPath: '/tmp/runtime.log',
    recordDiagnostic: vi.fn(),
    sendFrame: vi.fn(),
    loginProvider: vi.fn(),
    start: vi.fn(),
    stopCurrentRun: vi.fn(),
    switchSession: vi.fn(),
    snapshot: {
      status: 'ready',
      isStreaming: false,
      queuedMessageCount: 0
    }
  })
  const mainFrame = { url: 'file:///tmp/index.html' }
  const webContents = {
    isDestroyed: () => false,
    mainFrame,
    send: electron.send
  }
  const window = {
    isDestroyed: () => false,
    webContents
  }
  return {
    emitter,
    supervisor,
    event: { sender: webContents, senderFrame: mainFrame },
    getWindow: () => window as never
  }
}
