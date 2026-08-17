import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimePath = resolve(repositoryRoot, 'runtime/omp')
const parallelValues = [1, 5, 10]
const runsPerValue = 5
const cpuSampleMs = 5_000
const outputArgument = process.argv.find((argument) =>
  argument.startsWith('--output=')
)
const outputPath = outputArgument
  ? resolve(process.cwd(), outputArgument.slice('--output='.length))
  : undefined

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function summarize(values) {
  return {
    median: Number(median(values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2))
  }
}

async function processTable() {
  const { stdout } = await execFileAsync('ps', [
    '-e',
    '-o',
    'pid=',
    '-o',
    'ppid=',
    '-o',
    'rss=',
    '-o',
    'pcpu=',
    '-o',
    'comm='
  ])
  return stdout
    .trim()
    .split('\n')
    .flatMap((line) => {
      const match = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/u)
      return match
        ? [
            {
              pid: Number(match[1]),
              ppid: Number(match[2]),
              rssKiB: Number(match[3]),
              cpuPercent: Number(match[4]),
              command: match[5]
            }
          ]
        : []
    })
}

function selectProcessTree(processes, rootPids) {
  const included = new Set(rootPids)
  let changed = true
  while (changed) {
    changed = false
    for (const item of processes) {
      if (included.has(item.pid) || !included.has(item.ppid)) continue
      included.add(item.pid)
      changed = true
    }
  }
  return processes.filter((item) => included.has(item.pid))
}

async function cpuTicks(processes) {
  const values = await Promise.all(
    processes.map(async (item) => {
      const ticks = await readFile(`/proc/${item.pid}/stat`, 'utf8')
        .then((value) => {
          const fields = value.slice(value.lastIndexOf(')') + 2).split(' ')
          return Number(fields[11]) + Number(fields[12])
        })
        .catch(() => null)
      return [item.pid, ticks]
    })
  )
  return new Map(values.filter((entry) => Number.isFinite(entry[1])))
}

async function processSnapshot(rootPids) {
  const before = selectProcessTree(await processTable(), rootPids)
  const beforeTicks = await cpuTicks(before)
  const startedAt = performance.now()
  await new Promise((resolveWait) => setTimeout(resolveWait, cpuSampleMs))
  const selected = selectProcessTree(await processTable(), rootPids)
  const afterTicks = await cpuTicks(selected)
  const elapsedSeconds = (performance.now() - startedAt) / 1_000
  const { stdout: ticksOutput } = await execFileAsync('getconf', ['CLK_TCK'])
  const ticksPerSecond = Number(ticksOutput.trim())
  const intervalCpuPercent = selected.reduce((total, item) => {
    const start = beforeTicks.get(item.pid)
    const end = afterTicks.get(item.pid)
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? total + ((end - start) / ticksPerSecond / elapsedSeconds) * 100
      : total
  }, 0)
  return {
    totalRssMiB:
      selected.reduce((total, item) => total + item.rssKiB, 0) / 1024,
    totalCpuPercent: selected.reduce(
      (total, item) => total + item.cpuPercent,
      0
    ),
    intervalCpuPercent,
    processes: selected.map((item) => ({
      pid: item.pid,
      ppid: item.ppid,
      rssMiB: Number((item.rssKiB / 1024).toFixed(2)),
      cpuPercent: item.cpuPercent,
      command: item.command
    }))
  }
}

function startRuntime() {
  const startedAt = performance.now()
  const child = spawn(
    runtimePath,
    [
      '--mode',
      'rpc',
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-rules'
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PI_NO_PTY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    }
  )
  let buffer = ''
  let stderr = ''
  let settled = false
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(new Error(`OMP ready 超时: ${stderr.slice(-500)}`))
    }, 20_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const frame = JSON.parse(line)
        if (frame.type !== 'ready' || settled) continue
        settled = true
        clearTimeout(timer)
        resolveReady(performance.now() - startedAt)
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectReady(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      clearTimeout(timer)
      rejectReady(
        new Error(
          `OMP 在 ready 前退出: code=${String(code)} signal=${String(signal)} ${stderr.slice(-500)}`
        )
      )
    })
  })
  return { child, ready }
}

async function stopRuntime(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin.end()
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  let timeoutId
  const timeout = new Promise((resolveTimeout) => {
    timeoutId = setTimeout(resolveTimeout, 5_000, 'timeout')
  })
  const result = await Promise.race([exited, timeout])
  clearTimeout(timeoutId)
  if (result !== 'timeout') return
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // 进程组已退出时再尝试单进程。
    }
  }
  child.kill('SIGKILL')
}

async function runGroup(parallel) {
  const runtimes = Array.from({ length: parallel }, () => startRuntime())
  try {
    const readyMs = await Promise.all(runtimes.map((runtime) => runtime.ready))
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    const snapshot = await processSnapshot(
      runtimes.map((runtime) => runtime.child.pid).filter(Boolean)
    )
    return {
      readyMs: readyMs.map((value) => Number(value.toFixed(2))),
      groupReadyMs: Number(Math.max(...readyMs).toFixed(2)),
      totalRssMiB: Number(snapshot.totalRssMiB.toFixed(2)),
      totalCpuPercent: Number(snapshot.totalCpuPercent.toFixed(2)),
      intervalCpuPercent: Number(snapshot.intervalCpuPercent.toFixed(2)),
      processes: snapshot.processes
    }
  } finally {
    await Promise.all(runtimes.map((runtime) => stopRuntime(runtime.child)))
  }
}

const { stdout: runtimeVersionOutput } = await execFileAsync(runtimePath, [
  '--version'
])
const result = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    runtimeVersion: runtimeVersionOutput.trim()
  },
  method: {
    runsPerValue,
    parallelValues,
    warmupAfterReadyMs: 500,
    cpuSampleMs,
    runtimeArguments: [
      '--mode',
      'rpc',
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-rules'
    ],
    scope: 'OMP 进程树启动和 ready 后空闲资源，不调用模型'
  },
  groups: []
}

for (const parallel of parallelValues) {
  const runs = []
  for (let run = 1; run <= runsPerValue; run += 1) {
    process.stderr.write(`parallel=${parallel} run=${run}/${runsPerValue}\n`)
    runs.push(await runGroup(parallel))
  }
  result.groups.push({
    parallel,
    summary: {
      groupReadyMs: summarize(runs.map((run) => run.groupReadyMs)),
      totalRssMiB: summarize(runs.map((run) => run.totalRssMiB)),
      totalCpuPercent: summarize(runs.map((run) => run.totalCpuPercent)),
      intervalCpuPercent: summarize(runs.map((run) => run.intervalCpuPercent))
    },
    runs
  })
}

const serialized = `${JSON.stringify(result, null, 2)}\n`
if (outputPath) await writeFile(outputPath, serialized)
process.stdout.write(serialized)
