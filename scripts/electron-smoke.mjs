import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import process from 'node:process'
const packagedExecutable = process.env.OMP_SMOKE_EXECUTABLE
const electronBinary = packagedExecutable
  ? undefined
  : (await import('electron')).default
if (!packagedExecutable) await access('out/main/index.js', constants.R_OK)

const useXvfb = process.platform === 'linux' && !process.env.DISPLAY
const displayServer = process.env.OMP_DISPLAY_SERVER
const softwareRendering = process.env.OMP_SMOKE_SOFTWARE_RENDERING === 'true'
const terminateOnReady = process.env.OMP_SMOKE_TERMINATE_ON_READY === 'true'
const runtimeSmoke = process.env.OMP_SMOKE_RUNTIME === 'true'
const noSandbox = process.env.OMP_SMOKE_NO_SANDBOX === 'true'
const readyMarker = runtimeSmoke ? 'OMP_RUNTIME_SMOKE_READY' : 'OMP_SMOKE_READY'

if (displayServer && !['x11', 'wayland'].includes(displayServer)) {
  throw new Error(`不支持的 OMP_DISPLAY_SERVER：${displayServer}`)
}
if (displayServer === 'x11' && !process.env.DISPLAY) {
  throw new Error('X11 smoke 缺少 DISPLAY')
}
if (displayServer === 'wayland' && !process.env.WAYLAND_DISPLAY) {
  throw new Error('Wayland smoke 缺少 WAYLAND_DISPLAY')
}

const explicitElectronArgs =
  displayServer === 'x11'
    ? ['--ozone-platform=x11']
    : displayServer === 'wayland'
      ? ['--ozone-platform=wayland']
      : []
if (softwareRendering) explicitElectronArgs.push('--disable-gpu')
if (noSandbox) explicitElectronArgs.push('--no-sandbox')
const entrypoint = packagedExecutable ? undefined : 'out/main/index.js'
const smokeArgs = entrypoint
  ? [
      ...explicitElectronArgs,
      entrypoint,
      runtimeSmoke ? '--runtime-smoke' : '--smoke'
    ]
  : [...explicitElectronArgs, runtimeSmoke ? '--runtime-smoke' : '--smoke']
const command = displayServer
  ? (packagedExecutable ?? electronBinary)
  : useXvfb
    ? 'xvfb-run'
    : (packagedExecutable ?? electronBinary)
const args = displayServer
  ? smokeArgs
  : useXvfb
    ? [
        '-a',
        packagedExecutable ?? electronBinary,
        '--ozone-platform=x11',
        ...(entrypoint ? [entrypoint] : []),
        runtimeSmoke ? '--runtime-smoke' : '--smoke'
      ]
    : smokeArgs

console.log(
  `Electron smoke 环境：arch=${process.arch} display=${displayServer ?? (useXvfb ? 'x11-xvfb' : 'auto')} executable=${packagedExecutable ?? 'source'} rendering=${softwareRendering ? 'software' : 'default'} runtime=${runtimeSmoke ? 'required' : 'skipped'} shutdown=${terminateOnReady ? 'forced-after-ready' : 'normal'}`
)

const child = spawn(command, args, {
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32'
})

let rendererReady = false
let terminatedAfterReady = false
let stdout = ''

function terminateChild() {
  if (!child.pid) return
  if (process.platform === 'win32') {
    child.kill('SIGKILL')
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

child.stdout.on('data', (chunk) => {
  const output = String(chunk)
  stdout += output
  process.stdout.write(output)
  if (!rendererReady && stdout.includes(readyMarker)) {
    rendererReady = true
    clearTimeout(timeout)
    if (terminateOnReady) {
      terminatedAfterReady = true
      terminateChild()
    } else {
      timeout = setTimeout(() => {
        terminateChild()
        console.error('Electron smoke 退出超时')
        process.exitCode = 1
      }, 10_000)
    }
  }
})

child.stderr.on('data', (chunk) => process.stderr.write(chunk))

let timeout = setTimeout(
  () => {
    terminateChild()
    console.error('Electron smoke 超时')
    process.exitCode = 1
  },
  runtimeSmoke ? 45_000 : 20_000
)

child.on('error', (error) => {
  clearTimeout(timeout)
  console.error(`无法启动 Electron smoke：${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  clearTimeout(timeout)
  const expectedForcedExit = terminatedAfterReady && signal === 'SIGKILL'
  if ((!expectedForcedExit && code !== 0) || !rendererReady) {
    console.error(
      `Electron smoke 失败：code=${String(code)} signal=${String(signal)}`
    )
    process.exitCode = 1
    return
  }
  if (expectedForcedExit) console.log('Electron smoke 已在成功标记后主动终止')
  console.log('Electron smoke 通过')
})
