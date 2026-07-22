import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import process from 'node:process'
import electronBinary from 'electron'

await access('out/main/index.js', constants.R_OK)

const useXvfb = process.platform === 'linux' && !process.env.DISPLAY
const displayServer = process.env.OMP_DISPLAY_SERVER
const softwareRendering = process.env.OMP_SMOKE_SOFTWARE_RENDERING === 'true'

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
const command = displayServer
  ? electronBinary
  : useXvfb
    ? 'xvfb-run'
    : electronBinary
const args = displayServer
  ? [...explicitElectronArgs, 'out/main/index.js', '--smoke']
  : useXvfb
    ? [
        '-a',
        electronBinary,
        '--ozone-platform=x11',
        'out/main/index.js',
        '--smoke'
      ]
    : ['out/main/index.js', '--smoke']

console.log(
  `Electron smoke 环境：arch=${process.arch} display=${displayServer ?? (useXvfb ? 'x11-xvfb' : 'auto')} rendering=${softwareRendering ? 'software' : 'default'}`
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
  if (stdout.includes('OMP_SMOKE_READY')) rendererReady = true
})

child.stderr.on('data', (chunk) => process.stderr.write(chunk))

const timeout = setTimeout(() => {
  terminateChild()
  console.error('Electron smoke 超时')
  process.exitCode = 1
}, 20_000)

child.on('error', (error) => {
  clearTimeout(timeout)
  console.error(`无法启动 Electron smoke：${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  clearTimeout(timeout)
  if (code !== 0 || !rendererReady) {
    console.error(
      `Electron smoke 失败：code=${String(code)} signal=${String(signal)}`
    )
    process.exitCode = 1
    return
  }
  console.log('Electron smoke 通过')
})
