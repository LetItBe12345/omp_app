import { execFile, spawn } from 'node:child_process'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const executeModelCalls = process.argv.includes('--execute-model-calls')
const preflight = process.argv.includes('--preflight')
const outputArgument = process.argv.find((argument) =>
  argument.startsWith('--output=')
)
const outputPath = outputArgument
  ? resolve(outputArgument.slice('--output='.length))
  : undefined
const priorCallsArgument = process.argv.find((argument) =>
  argument.startsWith('--prior-calls=')
)
const priorCalls = priorCallsArgument
  ? Number(priorCallsArgument.slice('--prior-calls='.length))
  : 0
const callPlanArgument = process.argv.find((argument) =>
  argument.startsWith('--call-plan=')
)
const expectedCallsArgument = process.argv.find((argument) =>
  argument.startsWith('--expected-calls=')
)
const steadyState = process.argv.includes('--steady-state')
const model = 'openai-codex/gpt-5.4-mini'
const thinking = 'low'
const prompt =
  '不调用工具，不读取或修改文件。从 1 到 100，每行输出一个数字，不要添加其他文字。'
const matrix = [
  { parallel: 1, runs: 5 },
  { parallel: 5, runs: 5 },
  { parallel: 10, runs: 5 }
]
const matrixCalls = matrix.reduce(
  (total, item) => total + item.parallel * item.runs,
  0
)
const expectedCalls = expectedCallsArgument
  ? Number(expectedCallsArgument.slice('--expected-calls='.length))
  : matrixCalls
if (!Number.isInteger(expectedCalls) || expectedCalls < 0)
  throw new Error('--expected-calls 必须是非负整数')
if (
  !Number.isInteger(priorCalls) ||
  priorCalls < 0 ||
  priorCalls > expectedCalls
)
  throw new Error(`--prior-calls 必须是 0–${expectedCalls} 的整数`)

if (!preflight && !executeModelCalls) {
  throw new Error(
    '不会默认发送模型请求；请使用 --preflight 或 --execute-model-calls'
  )
}
if (preflight && executeModelCalls) {
  throw new Error('--preflight 和 --execute-model-calls 不能同时使用')
}

function percentile(values, ratio) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * ratio)]
}

function summarize(values) {
  const finite = values.filter(Number.isFinite)
  return {
    count: finite.length,
    median: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    max: finite.length ? Math.max(...finite) : null
  }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  )
  return port
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitFor(check, timeoutMs, description) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(
    `${description} 超时${lastError instanceof Error ? `: ${lastError.message}` : ''}`
  )
}

function cleanLocalProxy(environment) {
  const result = { ...environment }
  for (const key of [
    'ALL_PROXY',
    'all_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy'
  ]) {
    delete result[key]
  }
  result.NO_PROXY = '127.0.0.1,localhost'
  result.no_proxy = '127.0.0.1,localhost'
  return result
}

async function browser(session, ...arguments_) {
  const { stdout } = await execFileAsync(
    'agent-browser',
    ['--session', session, ...arguments_],
    {
      cwd: repositoryRoot,
      env: cleanLocalProxy(process.env),
      maxBuffer: 16 * 1024 * 1024,
      timeout: 90_000
    }
  )
  return stdout.trim()
}

async function evaluate(session, source) {
  const encoded = Buffer.from(source).toString('base64')
  const output = await browser(session, 'eval', '--json', '-b', encoded)
  const response = JSON.parse(output)
  if (!response.success) throw new Error(response.error ?? 'DOM 执行失败')
  return response.data?.result
}

async function prepareState(root, parallel) {
  const userData = join(root, 'user-data')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(userData), mkdir(workspace)])
  const now = new Date().toISOString()
  await writeFile(
    join(userData, 'desktop-state.json'),
    `${JSON.stringify(
      {
        version: 1,
        activeWorkspaceId: 'benchmark-workspace',
        workspaces: [
          {
            id: 'benchmark-workspace',
            path: workspace,
            addedAt: now,
            lastUsedAt: now,
            pinned: false
          }
        ],
        sessionPreferences: {},
        ui: {
          runtimeNetwork: { mode: 'auto' },
          maxParallelSessions: parallel,
          sessionNetworkConfigVersion: 1,
          sessionNetworkMigrationBaseline: { mode: 'auto' }
        }
      },
      null,
      2
    )}\n`
  )
  return { userData, workspace }
}

async function processRows() {
  const { stdout } = await execFileAsync(
    'ps',
    ['-e', '-o', 'pid=,ppid=,rss=,pcpu=,comm=,args='],
    { maxBuffer: 32 * 1024 * 1024 }
  )
  return stdout.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/u
    )
    return match
      ? [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            rssKiB: Number(match[3]),
            cpuPercent: Number(match[4]),
            command: match[5],
            arguments: match[6]
          }
        ]
      : []
  })
}

function descendants(rows, rootPid) {
  const selected = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (selected.has(row.ppid) && !selected.has(row.pid)) {
        selected.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid))
}

function electronKind(type) {
  const normalized = type.toLowerCase()
  if (normalized === 'browser') return 'main'
  if (normalized === 'tab' || normalized.includes('renderer')) return 'renderer'
  if (normalized.includes('gpu')) return 'gpu'
  if (normalized.includes('utility')) return 'utility'
  if (normalized.includes('zygote')) return 'zygote'
  if (normalized.includes('sandbox')) return 'sandbox'
  return 'electron-other'
}

function processKind(row, rootPid, electronKinds) {
  const electron = electronKinds.get(row.pid)
  if (electron) return electron
  if (row.pid === rootPid) return 'main'
  if (row.arguments.includes('--type=renderer')) return 'renderer'
  if (row.arguments.includes('--type=gpu-process')) return 'gpu'
  if (row.command === 'omp' || /\/runtime\/omp(?:\s|$)/u.test(row.arguments))
    return 'omp'
  if (row.arguments.includes('--type=utility')) return 'utility'
  return 'other'
}

async function readElectronMetrics(metricsPath) {
  return readFile(metricsPath, 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => ({ timestamp: null, metrics: [] }))
}

let clockTicksPerSecond
async function clockTicks() {
  if (clockTicksPerSecond) return clockTicksPerSecond
  const { stdout } = await execFileAsync('getconf', ['CLK_TCK'])
  clockTicksPerSecond = Number(stdout.trim())
  return clockTicksPerSecond
}

async function processCpuTicks(rows) {
  const values = await Promise.all(
    rows.map(async (row) => {
      const ticks = await readFile(`/proc/${row.pid}/stat`, 'utf8')
        .then((value) => {
          const fields = value.slice(value.lastIndexOf(')') + 2).split(' ')
          return Number(fields[11]) + Number(fields[12])
        })
        .catch(() => null)
      return [row.pid, ticks]
    })
  )
  return new Map(values.filter((entry) => Number.isFinite(entry[1])))
}

async function resourceSnapshot(rootPid, label, metricsPath, sampleMs = 0) {
  const beforeRows = descendants(await processRows(), rootPid)
  const beforeTicks = sampleMs ? await processCpuTicks(beforeRows) : new Map()
  const sampleStartedAt = performance.now()
  if (sampleMs) await delay(sampleMs)
  const rows = descendants(await processRows(), rootPid)
  const elapsedSeconds = (performance.now() - sampleStartedAt) / 1_000
  const afterTicks = sampleMs ? await processCpuTicks(rows) : new Map()
  const ticksPerSecond = sampleMs ? await clockTicks() : 0
  const electronMetrics = await readElectronMetrics(metricsPath)
  const electronKinds = new Map(
    electronMetrics.metrics.map((metric) => [
      metric.pid,
      electronKind(metric.type)
    ])
  )
  const byKind = {}
  for (const row of rows) {
    const kind = processKind(row, rootPid, electronKinds)
    const current = byKind[kind] ?? {
      count: 0,
      rssMiB: 0,
      lifetimeCpuPercent: 0,
      intervalCpuPercent: 0
    }
    current.count += 1
    current.rssMiB += row.rssKiB / 1024
    current.lifetimeCpuPercent += row.cpuPercent
    const before = beforeTicks.get(row.pid)
    const after = afterTicks.get(row.pid)
    if (
      sampleMs &&
      Number.isFinite(before) &&
      Number.isFinite(after) &&
      after >= before
    )
      current.intervalCpuPercent +=
        ((after - before) / ticksPerSecond / elapsedSeconds) * 100
    byKind[kind] = current
  }
  for (const value of Object.values(byKind)) {
    value.rssMiB = Number(value.rssMiB.toFixed(2))
    value.lifetimeCpuPercent = Number(value.lifetimeCpuPercent.toFixed(2))
    value.intervalCpuPercent = Number(value.intervalCpuPercent.toFixed(2))
  }
  return {
    label,
    timestamp: new Date().toISOString(),
    sampleMs,
    totalRssMiB: Number(
      rows.reduce((total, row) => total + row.rssKiB / 1024, 0).toFixed(2)
    ),
    byKind,
    electronMetrics,
    processes: rows.map((row) => ({
      pid: row.pid,
      ppid: row.ppid,
      command: row.command,
      arguments: row.arguments
    }))
  }
}

async function terminateGroup(child) {
  if (!child.pid || child.pid <= 1) return { forceKilled: false }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false)
  ])
  if (!exited) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  return { forceKilled: !exited }
}

async function launch(parallel) {
  const root = await mkdtemp(join(tmpdir(), 'omp-headed-benchmark-'))
  const { userData, workspace } = await prepareState(root, parallel)
  const port = await freePort()
  const browserSession = `omp-benchmark-${port}`
  const electronModule = await import('electron')
  const electronPath = electronModule.default
  const child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${port}`,
      '--ozone-platform=x11',
      'out/main/index.js',
      '--runtime-benchmark'
    ],
    {
      cwd: repositoryRoot,
      detached: true,
      env: {
        ...process.env,
        OMP_DESKTOP_BENCHMARK_USER_DATA: userData,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  try {
    await waitFor(
      () => stdout.includes('OMP_BENCHMARK_READY'),
      30_000,
      'Electron Renderer 就绪'
    )
    await waitFor(
      async () => {
        const connected = await browser(
          browserSession,
          'connect',
          `http://127.0.0.1:${port}`,
          '--json'
        )
        return connected || true
      },
      15_000,
      'agent-browser 连接 Electron CDP'
    )
    await waitFor(
      async () => {
        const tabs = await browser(browserSession, 'tab', 'list')
        return tabs && !tabs.includes('about:blank') ? tabs : null
      },
      15_000,
      'agent-browser 连接 Electron'
    )
    return {
      child,
      port,
      browserSession,
      root,
      userData,
      workspace,
      logs: () => ({ stdout, stderr })
    }
  } catch (error) {
    await terminateGroup(child)
    await rm(root, { recursive: true, force: true })
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${stderr.slice(-4_000)}`
    )
  }
}

async function inspectUi(browserSession) {
  return evaluate(
    browserSession,
    `(() => ({
      title: document.title,
      bodyText: document.body.innerText.slice(0, 3000),
      composer: Boolean(document.querySelector('[aria-label="任务输入"]')),
      newSession: Boolean(document.querySelector('[aria-label="新建对话"]')),
      model: document.querySelector('[aria-label="选择模型"]')?.textContent?.trim(),
      thinking: document.querySelector('[aria-label="选择推理强度"]')?.textContent?.trim(),
      status: [...document.querySelectorAll('span')].map((node) => node.textContent?.trim()).find((text) => text === 'Runtime 已就绪')
    }))()`
  )
}

async function runPreflight() {
  const app = await launch(1)
  try {
    const initialUi = await waitFor(
      async () => {
        const value = await inspectUi(app.browserSession)
        return value?.composer && value?.model ? value : null
      },
      30_000,
      '基准页面可操作'
    )
    await evaluate(
      app.browserSession,
      `(() => {
        const button = document.querySelector('[aria-label="新建对话"]');
        if (!(button instanceof HTMLButtonElement) || button.disabled)
          throw new Error('新建对话按钮不可用');
        button.click();
        return true;
      })()`
    )
    const composerEnabled = await waitFor(
      async () =>
        evaluate(
          app.browserSession,
          `(() => {
            const composer = document.querySelector('[aria-label="任务输入"]');
            return composer instanceof HTMLTextAreaElement && !composer.disabled;
          })()`
        ),
      10_000,
      '新会话输入区可用'
    )
    const readyUi = await waitFor(
      async () => {
        const value = await inspectUi(app.browserSession)
        return value?.status === 'Runtime 已就绪' ? value : null
      },
      60_000,
      'Runtime 就绪'
    )
    if (readyUi.model !== 'GPT-5.4-Mini' || readyUi.thinking !== '低') {
      throw new Error(
        `模型预检不符合预期: model=${String(readyUi.model)}, thinking=${String(readyUi.thinking)}`
      )
    }
    const screenshot = outputPath
      ? `${outputPath.replace(/\.json$/u, '')}.png`
      : join(app.root, 'preflight.png')
    await mkdir(dirname(screenshot), { recursive: true })
    await browser(app.browserSession, 'screenshot', screenshot)
    return {
      mode: 'preflight',
      model,
      thinking,
      promptCalls: 0,
      runtimeStarted: true,
      initialUi,
      readyUi,
      composerEnabled,
      screenshot,
      resources: await resourceSnapshot(
        app.child.pid,
        'ready',
        join(app.userData, 'benchmark-app-metrics.json'),
        5_000
      )
    }
  } finally {
    await terminateGroup(app.child)
    if (!outputPath) await rm(app.root, { recursive: true, force: true })
  }
}

async function installVisibleMark(browserSession) {
  return evaluate(
    browserSession,
    `(() => {
      window.__ompBenchmark = { submitAt: null, firstVisibleAt: null };
      const observe = () => {
        if (window.__ompBenchmark.firstVisibleAt !== null) return;
        const visible = [...document.querySelectorAll('[data-slot="assistant-visible-text"]')]
          .some((node) => node.textContent?.trim().length > 0);
        if (visible) window.__ompBenchmark.firstVisibleAt = performance.now();
      };
      new MutationObserver(observe).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
      return true;
    })()`
  )
}

async function submitPrompts(browserSession, count, onSubmitted) {
  const submitted = []
  for (let index = 0; index < count; index += 1) {
    const previousTemporary = await evaluate(
      browserSession,
      `(() => {
        const main = document.querySelector('[data-slot="conversation-main"]');
        return {
          active: main?.getAttribute('data-temporary-session'),
          id: main?.getAttribute('data-temporary-session-id') ?? '',
          runtimeId: main?.getAttribute('data-runtime-session-id') ?? ''
        };
      })()`
    )
    await evaluate(
      browserSession,
      `(() => {
      const newSession = document.querySelector('[aria-label="新建对话"]');
      if (!(newSession instanceof HTMLButtonElement) || newSession.disabled)
        throw new Error('新建对话按钮不可用');
      newSession.click();
      return true;
    })()`
    )
    await waitFor(
      async () => {
        const current = await evaluate(
          browserSession,
          `(() => {
            const main = document.querySelector('[data-slot="conversation-main"]');
            return {
              active: main?.getAttribute('data-temporary-session'),
              id: main?.getAttribute('data-temporary-session-id') ?? '',
              runtimeId: main?.getAttribute('data-runtime-session-id') ?? ''
            };
          })()`
        )
        return (
          current?.active === 'true' &&
          current.id === '' &&
          (previousTemporary?.active !== 'true' || previousTemporary.id !== '')
        )
      },
      10_000,
      '新会话状态切换'
    )
    await waitFor(
      () =>
        evaluate(
          browserSession,
          `(() => {
        const element = document.querySelector('[aria-label="任务输入"]');
        return element instanceof HTMLTextAreaElement && !element.disabled;
      })()`
        ),
      60_000,
      '任务输入框可用'
    )
    await evaluate(
      browserSession,
      `(() => {
      const composer = document.querySelector('[aria-label="任务输入"]');
      if (!(composer instanceof HTMLTextAreaElement))
        throw new Error('任务输入框不存在');
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      ).set;
      setValue.call(composer, ${JSON.stringify(prompt)});
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
    )
    await waitFor(
      () =>
        evaluate(
          browserSession,
          `(() => {
        const element = document.querySelector('[aria-label="发送"]');
        return element instanceof HTMLButtonElement && !element.disabled;
      })()`
        ),
      60_000,
      '发送按钮可用'
    )
    const value = await evaluate(
      browserSession,
      `(() => {
      const send = document.querySelector('[aria-label="发送"]');
      if (!(send instanceof HTMLButtonElement) || send.disabled)
        throw new Error('发送按钮不可用');
      const now = performance.now();
      if (${index === count - 1}) window.__ompBenchmark.submitAt = now;
      send.click();
      return now;
    })()`
    )
    if (!Number.isFinite(value))
      throw new Error(`第 ${index + 1} 条提交没有返回时间标记`)
    submitted.push(value)
    await onSubmitted(index + 1)
    await waitFor(
      () =>
        evaluate(
          browserSession,
          `(() => {
            const main = document.querySelector('[data-slot="conversation-main"]');
            const temporaryId = main?.getAttribute('data-temporary-session-id') ?? '';
            const runtimeId = main?.getAttribute('data-runtime-session-id') ?? '';
            return Boolean(
              temporaryId ||
              (runtimeId && runtimeId !== ${JSON.stringify(previousTemporary.runtimeId)})
            );
          })()`
        ),
      60_000,
      '新会话获取 temporary Session ID'
    )
  }
  return submitted
}

async function sessionState(browserSession) {
  return evaluate(
    browserSession,
    `(() => {
      const sessions = [...document.querySelectorAll('[data-session-id]')].map((node) => ({
        id: node.getAttribute('data-session-id'),
        phase: node.getAttribute('data-session-phase'),
        active: node.getAttribute('aria-current') === 'true'
      }));
      const mark = window.__ompBenchmark ?? {};
      return { sessions, submitAt: mark.submitAt, firstVisibleAt: mark.firstVisibleAt };
    })()`
  )
}

async function measureSwitches(browserSession, sessions) {
  const values = []
  for (const session of sessions) {
    const duration = await evaluate(
      browserSession,
      `(async () => {
        const button = document.querySelector('[data-session-id="${session.id}"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Session 按钮不存在');
        const start = performance.now();
        button.click();
        while (button.getAttribute('aria-current') !== 'true') {
          if (performance.now() - start > 10000) throw new Error('Session 切换超时');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return performance.now() - start;
      })()`
    )
    values.push(Number(duration))
  }
  return values
}

async function runRound(parallel, runIndex, promptCount = parallel) {
  process.stdout.write(
    `parallel=${parallel} run=${runIndex}/5: 启动 Electron\n`
  )
  const app = await launch(parallel)
  const resources = []
  const cleanup = {}
  try {
    await waitFor(
      async () => {
        const value = await inspectUi(app.browserSession)
        return value?.composer && value?.newSession ? value : null
      },
      30_000,
      '基准页面可操作'
    )
    const metricsPath = join(app.userData, 'benchmark-app-metrics.json')
    resources.push(
      await resourceSnapshot(
        app.child.pid,
        'ready',
        metricsPath,
        steadyState ? 5_000 : 0
      )
    )
    await installVisibleMark(app.browserSession)
    const submitted = await submitPrompts(
      app.browserSession,
      promptCount,
      async (sequence) => {
        if (outputPath)
          await appendFile(
            `${outputPath}.progress.ndjson`,
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              parallel,
              runIndex,
              sequence,
              submitted: 1
            })}\n`
          )
      }
    )
    process.stdout.write(
      `parallel=${parallel} run=${runIndex}/5: 已提交 ${submitted.length} 条\n`
    )
    const runtimeUi = await waitFor(
      async () => {
        const value = await inspectUi(app.browserSession)
        return value?.model === 'GPT-5.4-Mini' && value?.thinking === '低'
          ? value
          : null
      },
      60_000,
      'Runtime 模型与推理档位确认'
    )
    await delay(1_000)
    resources.push(
      await resourceSnapshot(
        app.child.pid,
        'running',
        metricsPath,
        steadyState ? 5_000 : 0
      )
    )
    const completed = await waitFor(
      async () => {
        const state = await sessionState(app.browserSession)
        if (!state?.sessions || state.sessions.length < promptCount) return null
        const relevant = state.sessions.slice(0, promptCount)
        const active = new Set([
          'queued',
          'starting',
          'running',
          'waiting-interaction',
          'stopping'
        ])
        return relevant.every((session) => !active.has(session.phase))
          ? state
          : null
      },
      10 * 60_000,
      '所有 Session 完成'
    )
    resources.push(
      await resourceSnapshot(
        app.child.pid,
        'completed',
        metricsPath,
        steadyState ? 5_000 : 0
      )
    )
    const failed = completed.sessions
      .slice(0, promptCount)
      .filter((session) => session.phase === 'failed')
    const firstVisibleMs =
      Number.isFinite(completed.submitAt) &&
      Number.isFinite(completed.firstVisibleAt)
        ? completed.firstVisibleAt - completed.submitAt
        : null
    const switchMs = await measureSwitches(
      app.browserSession,
      completed.sessions.slice(0, promptCount)
    )
    if (steadyState) {
      process.stdout.write(
        `parallel=${parallel} run=${runIndex}/5: 等待后台 Runtime 回收\n`
      )
      await delay(55_000)
      resources.push(
        await resourceSnapshot(
          app.child.pid,
          'idle-after-60s',
          metricsPath,
          5_000
        )
      )
      if (outputPath)
        await writeFile(
          `${outputPath}.parallel-${parallel}-run-${runIndex}.resources.json`,
          `${JSON.stringify(resources, null, 2)}\n`
        )
    }
    process.stdout.write(
      `parallel=${parallel} run=${runIndex}/5: 完成，失败 ${failed.length}\n`
    )
    return {
      parallel,
      promptCount,
      runIndex,
      submitted: submitted.length,
      failedSessionIds: failed.map((session) => session.id),
      firstVisibleMs,
      switchMs,
      resources,
      cleanup,
      runtimeUi,
      logTail: app.logs().stderr.slice(-2_000)
    }
  } finally {
    cleanup.termination = await terminateGroup(app.child)
    cleanup.remainingProcessCount = descendants(
      await processRows(),
      app.child.pid
    ).length
    await rm(app.root, { recursive: true, force: true })
  }
}

async function runBenchmark() {
  const rounds = []
  let submitted = 0
  let skippedCalls = 0
  const defaultPlan = matrix.flatMap((item) =>
    Array.from({ length: item.runs }, (_, index) => ({
      parallel: item.parallel,
      promptCount: item.parallel,
      runIndex: index + 1
    }))
  )
  const customPlan = callPlanArgument
    ? callPlanArgument
        .slice('--call-plan='.length)
        .split(',')
        .map((item, index) => {
          const match = item.match(/^(\d+):(\d+)$/u)
          if (!match) throw new Error(`无效 --call-plan 项: ${item}`)
          const parallel = Number(match[1])
          const promptCount = Number(match[2])
          if (
            !Number.isInteger(parallel) ||
            parallel < 1 ||
            parallel > 10 ||
            !Number.isInteger(promptCount) ||
            promptCount < 1 ||
            promptCount > parallel
          )
            throw new Error(`无效 --call-plan 项: ${item}`)
          return { parallel, promptCount, runIndex: index + 1 }
        })
    : defaultPlan
  for (const item of customPlan) {
    const { parallel, promptCount, runIndex } = item
    if (!callPlanArgument && skippedCalls < priorCalls) {
      if (skippedCalls + parallel > priorCalls)
        throw new Error('--prior-calls 必须对齐完整测试轮次')
      skippedCalls += parallel
      continue
    }
    const round = await runRound(parallel, runIndex, promptCount)
    rounds.push(round)
    submitted += round.submitted
    if (priorCalls + submitted > expectedCalls) {
      throw new Error(`提交数超过 ${expectedCalls}，已停止`)
    }
  }
  if (priorCalls + submitted !== expectedCalls) {
    throw new Error(
      `预期累计 ${expectedCalls} 次调用，实际为 ${priorCalls + submitted} 次`
    )
  }
  return {
    mode: 'headed-runtime-benchmark',
    timestamp: new Date().toISOString(),
    model,
    thinking,
    prompt,
    expectedCalls,
    priorCalls,
    submittedThisRun: submitted,
    submitted: priorCalls + submitted,
    autoRetry: false,
    rounds,
    summaries: matrix.map((item) => {
      const selected = rounds.filter(
        (round) => round.parallel === item.parallel
      )
      return {
        parallel: item.parallel,
        priorCallsNotMeasured: item.parallel === 1 ? priorCalls : 0,
        calls: selected.reduce((total, round) => total + round.submitted, 0),
        failedSessions: selected.reduce(
          (total, round) => total + round.failedSessionIds.length,
          0
        ),
        firstVisibleMs: summarize(
          selected.map((round) => round.firstVisibleMs)
        ),
        switchMs: summarize(selected.flatMap((round) => round.switchMs)),
        peakRssMiB: summarize(
          selected.map((round) =>
            Math.max(...round.resources.map((snapshot) => snapshot.totalRssMiB))
          )
        )
      }
    })
  }
}

const result = preflight ? await runPreflight() : await runBenchmark()
const serialized = `${JSON.stringify(result, null, 2)}\n`
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, serialized)
  process.stdout.write(`结果已写入 ${outputPath}\n`)
} else {
  process.stdout.write(serialized)
}
