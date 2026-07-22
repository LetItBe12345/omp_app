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

  it('运行中拒绝模型变更和 Slash Follow-up', async () => {
    await supervisor.start(process.cwd())
    await supervisor.prompt({ message: '执行任务' })

    await expect(
      supervisor.setModel('test', 'another-model')
    ).rejects.toMatchObject({ code: 'RUNTIME_NOT_READY' })
    await expect(
      supervisor.followUp({ message: '/compact' })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
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
