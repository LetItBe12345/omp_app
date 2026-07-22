import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnostics } from '../../src/main/runtime-diagnostics'
import { RuntimeSupervisor } from '../../src/main/runtime-supervisor'

describe('RuntimeSupervisor', () => {
  let temporaryDirectory: string
  let diagnostics: RuntimeDiagnostics
  let supervisor: RuntimeSupervisor

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'omp-runtime-test-'))
    const fixture = resolve('tests/fixtures/fake-omp.mjs')
    diagnostics = new RuntimeDiagnostics(
      join(temporaryDirectory, 'runtime.log')
    )
    supervisor = new RuntimeSupervisor({
      runtimePath: process.execPath,
      diagnostics,
      spawnRuntime: (_executable, args, options) =>
        spawn(process.execPath, [fixture, ...args], {
          ...options,
          stdio: ['pipe', 'pipe', 'pipe']
        })
    })
  })

  afterEach(async () => {
    await supervisor.stop()
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('完成 ready、初始化和 get_state 主链路', async () => {
    const state = await supervisor.start(process.cwd())

    expect(state).toMatchObject({
      status: 'ready',
      sessionId: 'fake-session',
      model: 'test/fake-model',
      thinkingLevel: 'medium'
    })
  })

  it('关闭前刷新 Runtime 诊断日志', async () => {
    const flush = vi.spyOn(diagnostics, 'flush')
    await supervisor.start(process.cwd())

    await supervisor.stop()

    expect(flush).toHaveBeenCalledOnce()
  })

  it('Stop 恢复当前 Prompt 并清空 Follow-up', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '实现功能' })
    await supervisor.followUp({ message: '补充测试' })

    const restored = await supervisor.stopCurrentRun()

    expect(restored).toEqual({ message: '实现功能' })
    expect(supervisor.snapshot).toMatchObject({
      status: 'ready',
      isStreaming: false,
      queuedMessageCount: 0
    })
  })

  it('请求超时后返回稳定错误码', async () => {
    await supervisor.start(process.cwd())

    await expect(
      supervisor.request({ type: 'never' }, 20)
    ).rejects.toMatchObject({
      code: 'RPC_TIMEOUT',
      retryable: true
    })
  })

  it('ready 超时后结束启动并返回 START_FAILED', async () => {
    supervisor = new RuntimeSupervisor({
      runtimePath: process.execPath,
      diagnostics: new RuntimeDiagnostics(
        join(temporaryDirectory, 'runtime.log')
      ),
      readyTimeoutMs: 30,
      spawnRuntime: (_executable, _args, options) =>
        spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          ...options,
          stdio: ['pipe', 'pipe', 'pipe']
        })
    })

    await expect(supervisor.start(process.cwd())).rejects.toMatchObject({
      code: 'START_FAILED'
    })
    expect(supervisor.snapshot.status).toBe('failed')
  })

  it('同一 Workspace 仅自动恢复首次崩溃', async () => {
    await supervisor.start(process.cwd())

    await expect(
      supervisor.request({ type: 'crash' }, 500)
    ).rejects.toMatchObject({ code: 'CRASHED' })
    await waitForStatus(supervisor, 'ready')

    await expect(
      supervisor.request({ type: 'crash' }, 500)
    ).rejects.toMatchObject({ code: 'CRASHED' })
    await waitForStatus(supervisor, 'failed')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(supervisor.snapshot.status).toBe('failed')
  })

  it('单条畸形消息后继续工作，连续三条则终止连接', async () => {
    const protocolErrors: unknown[] = []
    supervisor.on('event', (event) => {
      if ((event as { type?: string }).type === 'RPC_PROTOCOL_ERROR') {
        protocolErrors.push(event)
      }
    })
    await supervisor.start(process.cwd())

    await supervisor.request({ type: 'malformed_once' }, 500)
    expect(supervisor.snapshot.status).toBe('ready')
    expect(protocolErrors).toHaveLength(1)

    await expect(
      supervisor.request({ type: 'malformed_three' }, 500)
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(protocolErrors).toHaveLength(4)
  })

  it('运行中暂存模型变更，并拒绝 Slash Follow-up', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '执行任务' })

    await expect(
      supervisor.selectModel({
        provider: 'test',
        modelId: 'fast-model'
      })
    ).resolves.toMatchObject({
      model: 'test/fake-model',
      pendingModelSelection: {
        provider: 'test',
        modelId: 'fast-model'
      }
    })
    await expect(
      supervisor.followUp({ message: '/compact' })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await supervisor.stopCurrentRun()
    expect(supervisor.snapshot).toMatchObject({ model: 'test/fast-model' })
    expect(supervisor.snapshot.pendingModelSelection).toBeUndefined()
  })

  it('只向 Renderer 投影 Provider 和模型所需字段', async () => {
    await supervisor.start(process.cwd())

    await expect(supervisor.getLoginProviders()).resolves.toEqual([
      { id: 'test', name: 'Test Provider', available: true },
      { id: 'browser', name: 'Browser Login', available: true },
      { id: 'terminal-only', name: 'Terminal Only', available: true },
      { id: 'disabled', name: 'Disabled Provider', available: false }
    ])
    await expect(supervisor.getAvailableModels()).resolves.toEqual([
      {
        provider: 'test',
        id: 'fake-model',
        name: 'Fake Model',
        reasoning: true,
        thinking: {
          efforts: ['medium', 'high'],
          defaultLevel: 'medium'
        }
      },
      {
        provider: 'test',
        id: 'fast-model',
        name: 'Fast Model',
        reasoning: false
      }
    ])
  })

  it('通过 Extension UI 输入完成 Provider 登录', async () => {
    await supervisor.start(process.cwd())
    const inputRequest = new Promise<string>((resolveInput) => {
      supervisor.on('event', (event: unknown) => {
        const value = event as { type?: string; method?: string; id?: string }
        if (
          value.type === 'extension_ui_request' &&
          value.method === 'input' &&
          value.id
        ) {
          resolveInput(value.id)
        }
      })
    })

    const login = supervisor.loginProvider('browser')
    expect(supervisor.snapshot.isAuthenticating).toBe(true)
    supervisor.sendFrame({
      type: 'extension_ui_response',
      id: await inputRequest,
      value: 'fake-code'
    })

    await expect(login).resolves.toBeUndefined()
    expect(supervisor.snapshot.isAuthenticating).toBe(false)
  })

  it('模型成功但 Thinking 设置失败时保留 OMP 真实模型状态', async () => {
    await supervisor.start(process.cwd())

    await expect(
      supervisor.selectModel({
        provider: 'test',
        modelId: 'fast-model',
        thinkingLevel: 'fail'
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(supervisor.snapshot).toMatchObject({
      model: 'test/fast-model',
      thinkingLevel: 'medium'
    })
  })

  it('待切换配置只保留最后一次，并可取消', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '执行任务' })

    await supervisor.selectModel({ provider: 'test', modelId: 'first-model' })
    await supervisor.selectModel({
      provider: 'test',
      modelId: 'fast-model',
      thinkingLevel: 'high'
    })
    expect(supervisor.snapshot.pendingModelSelection).toEqual({
      provider: 'test',
      modelId: 'fast-model',
      thinkingLevel: 'high'
    })

    supervisor.cancelPendingModelSelection()
    expect(supervisor.snapshot.pendingModelSelection).toBeUndefined()
  })

  it('执行链正常结束后应用待切换配置', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '执行任务' })
    await supervisor.selectModel({
      provider: 'test',
      modelId: 'fast-model',
      thinkingLevel: 'high'
    })

    await supervisor.request({ type: 'emit_agent_end' }, 500)
    await waitForModel(supervisor, 'test/fast-model')
    expect(supervisor.snapshot).toMatchObject({
      thinkingLevel: 'high',
      pendingModelSelection: undefined
    })
  })

  it('Runtime 崩溃恢复 Session 后应用待切换配置', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '执行任务' })
    await supervisor.selectModel({
      provider: 'test',
      modelId: 'fast-model',
      thinkingLevel: 'high'
    })

    await expect(
      supervisor.request({ type: 'crash' }, 500)
    ).rejects.toMatchObject({ code: 'CRASHED' })
    await waitForStatus(supervisor, 'ready')
    await waitForModel(supervisor, 'test/fast-model')
    expect(supervisor.snapshot.thinkingLevel).toBe('high')
  })

  it('没有可用模型时返回 OMP_UNCONFIGURED', async () => {
    const fixture = resolve('tests/fixtures/fake-omp.mjs')
    supervisor = new RuntimeSupervisor({
      runtimePath: process.execPath,
      diagnostics: new RuntimeDiagnostics(
        join(temporaryDirectory, 'runtime.log')
      ),
      spawnRuntime: (_executable, args, options) =>
        spawn(process.execPath, [fixture, ...args], {
          ...options,
          env: { ...options.env, FAKE_NO_MODELS: '1' },
          stdio: ['pipe', 'pipe', 'pipe']
        })
    })

    await expect(supervisor.start(process.cwd())).rejects.toMatchObject({
      code: 'OMP_UNCONFIGURED',
      message: 'OMP 尚未配置'
    })
  })

  it('将传入的 Runtime env 原样交给 OMP', async () => {
    await supervisor.start(process.cwd(), {
      ...process.env,
      OMP_TEST_ENV: 'injected-value'
    })

    const response = await supervisor.request({ type: 'get_test_env' }, 500)
    expect(response.data).toEqual({ value: 'injected-value' })
  })

  it('按 ID 关联乱序响应，并忽略超时后的迟到响应', async () => {
    await supervisor.start(process.cwd())

    const slow = supervisor.request(
      { type: 'delayed', value: 'slow', delay: 40 },
      200
    )
    const fast = supervisor.request(
      { type: 'delayed', value: 'fast', delay: 5 },
      200
    )
    await expect(Promise.all([slow, fast])).resolves.toMatchObject([
      { data: { value: 'slow' } },
      { data: { value: 'fast' } }
    ])

    await expect(
      supervisor.request({ type: 'delayed', value: 'late', delay: 50 }, 10)
    ).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(supervisor.snapshot.status).toBe('ready')
  })

  it('abort 超时后重启 Runtime 并恢复可用状态', async () => {
    const fixture = resolve('tests/fixtures/fake-omp.mjs')
    supervisor = new RuntimeSupervisor({
      runtimePath: process.execPath,
      diagnostics: new RuntimeDiagnostics(
        join(temporaryDirectory, 'runtime.log')
      ),
      stopTimeoutMs: 30,
      spawnRuntime: (_executable, args, options) =>
        spawn(process.execPath, [fixture, ...args], {
          ...options,
          env: { ...options.env, FAKE_ABORT_HANG: '1' },
          stdio: ['pipe', 'pipe', 'pipe']
        })
    })
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '会被中止' })

    await expect(supervisor.stopCurrentRun()).resolves.toEqual({
      message: '会被中止'
    })
    expect(supervisor.snapshot.status).toBe('ready')
  })

  it.runIf(process.platform !== 'win32')(
    '正常关闭后不遗留 Runtime 子进程',
    async () => {
      const fixture = resolve('tests/fixtures/fake-omp.mjs')
      const pidFile = join(temporaryDirectory, 'grandchild.pid')
      supervisor = new RuntimeSupervisor({
        runtimePath: process.execPath,
        diagnostics: new RuntimeDiagnostics(
          join(temporaryDirectory, 'runtime.log')
        ),
        spawnRuntime: (_executable, args, options) =>
          spawn(process.execPath, [fixture, ...args], {
            ...options,
            env: { ...options.env, FAKE_GRANDCHILD_PID_FILE: pidFile },
            stdio: ['pipe', 'pipe', 'pipe']
          })
      })
      await supervisor.start(process.cwd())
      const grandchildPid = Number(await waitForFile(pidFile))

      await supervisor.stop()

      await waitForProcessExit(grandchildPid)
      expect(() => process.kill(grandchildPid, 0)).toThrow()
    }
  )

  it.runIf(process.platform !== 'win32')(
    'Runtime 崩溃后清理旧进程组的子进程',
    async () => {
      const fixture = resolve('tests/fixtures/fake-omp.mjs')
      const pidFile = join(temporaryDirectory, 'crashed-grandchild.pid')
      supervisor = new RuntimeSupervisor({
        runtimePath: process.execPath,
        diagnostics: new RuntimeDiagnostics(
          join(temporaryDirectory, 'runtime.log')
        ),
        spawnRuntime: (_executable, args, options) =>
          spawn(process.execPath, [fixture, ...args], {
            ...options,
            env: { ...options.env, FAKE_GRANDCHILD_PID_FILE: pidFile },
            stdio: ['pipe', 'pipe', 'pipe']
          })
      })
      await supervisor.start(process.cwd())
      const oldGrandchildPid = Number(await waitForFile(pidFile))

      await expect(
        supervisor.request({ type: 'crash' }, 500)
      ).rejects.toMatchObject({ code: 'CRASHED' })

      await waitForProcessExit(oldGrandchildPid)
      expect(() => process.kill(oldGrandchildPid, 0)).toThrow()
    }
  )
})

async function waitForStatus(
  supervisor: RuntimeSupervisor,
  status: 'ready' | 'failed'
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (supervisor.snapshot.status !== status) {
    if (Date.now() > deadline) throw new Error(`等待 ${status} 超时`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForModel(
  supervisor: RuntimeSupervisor,
  model: string
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (supervisor.snapshot.model !== model) {
    if (Date.now() > deadline) throw new Error(`等待模型 ${model} 超时`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 2_000
  while (true) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      if (Date.now() > deadline) throw new Error('等待 PID 文件超时')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (true) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    if (Date.now() > deadline) throw new Error('Runtime 子进程未退出')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
