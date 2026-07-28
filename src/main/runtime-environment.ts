import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  RuntimeEnvironmentDiagnostic,
  RuntimeNetworkConfig,
  RuntimeNetworkStatus,
  RuntimeToolDiagnostic
} from '../shared/desktop-api'

const execFileAsync = promisify(execFile)
const PROXY_KEYS = [
  'PI_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy'
] as const
const HTTP_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy'
] as const
const SOCKS_KEYS = ['ALL_PROXY', 'all_proxy'] as const
const LOOPBACK = 'localhost,127.0.0.1,::1'

export type ResolvedRuntimeEnvironment = {
  env: NodeJS.ProcessEnv
  network: RuntimeNetworkStatus
  sourceError?: string
}

type ReadShellEnvironment = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => Promise<string>

type DiscoveredLocalProxy = { url: string; source: string }
type DiscoverLocalProxy = () => Promise<DiscoveredLocalProxy | undefined>

export function extractV2rayNPorts(value: unknown): number[] {
  if (!value || typeof value !== 'object') return []
  const inbounds = (value as Record<string, unknown>)['Inbound']
  if (!Array.isArray(inbounds)) return []
  return [
    ...new Set(
      inbounds.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const port = (item as Record<string, unknown>)['LocalPort']
        return typeof port === 'number' &&
          Number.isInteger(port) &&
          port >= 1 &&
          port <= 65_535
          ? [port]
          : []
      })
    )
  ]
}

export async function discoverV2rayNProxy(
  dataHome = process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share')
): Promise<DiscoveredLocalProxy | undefined> {
  const configPath = join(dataHome, 'v2rayN', 'guiConfigs', 'guiNConfig.json')
  const config = await readFile(configPath, 'utf8')
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined)
  for (const port of extractV2rayNPorts(config)) {
    if (await checkLocalHttpProxy(port, 700)) {
      const url = `http://127.0.0.1:${port}`
      return { url, source: `v2rayN (${url})` }
    }
  }
  return undefined
}

function removeProxyVariables(env: NodeJS.ProcessEnv): void {
  for (const key of PROXY_KEYS) delete env[key]
}

function parseShellEnvironment(stdout: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const entry of stdout.split('\0')) {
    const separator = entry.indexOf('=')
    if (separator < 1) continue
    const key = entry.slice(0, separator)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    env[key] = entry.slice(separator + 1)
  }
  if (!env['PATH']) throw new Error('Login Shell 未返回 PATH')
  return env
}

function redactProxySource(key: string, raw: string): string {
  try {
    const url = new URL(raw)
    return `${key} (${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''})`
  } catch {
    return `${key}（值无效）`
  }
}

function networkStatus(
  config: RuntimeNetworkConfig,
  source: RuntimeNetworkStatus['source'],
  result: RuntimeNetworkStatus['result'],
  proxySource?: string,
  error?: string
): RuntimeNetworkStatus {
  return {
    config,
    source,
    result,
    ...(proxySource ? { proxySource } : {}),
    ...(error ? { error } : {})
  }
}

export class RuntimeEnvironmentResolver {
  #last?: ResolvedRuntimeEnvironment

  constructor(
    readonly runtimePath: string,
    private readonly electronEnv: NodeJS.ProcessEnv = process.env,
    timeoutMs = 5_000,
    private readonly readShellEnvironment: ReadShellEnvironment = async (
      shell,
      args,
      env
    ) =>
      (
        await execFileAsync(shell, args, {
          encoding: 'utf8',
          env,
          maxBuffer: 4 * 1024 * 1024,
          timeout: timeoutMs
        })
      ).stdout,
    private readonly discoverLocalProxy: DiscoverLocalProxy = () =>
      discoverV2rayNProxy(electronEnv['XDG_DATA_HOME'])
  ) {}

  async resolve(
    config: RuntimeNetworkConfig
  ): Promise<ResolvedRuntimeEnvironment> {
    const shell = this.electronEnv['SHELL'] || '/bin/sh'
    let base: NodeJS.ProcessEnv
    let source: RuntimeNetworkStatus['source'] = 'login-shell'
    let sourceError: string | undefined
    let discoveredProxySource: string | undefined
    try {
      base = parseShellEnvironment(
        await this.readShellEnvironment(
          shell,
          ['-ilc', 'env -0'],
          this.electronEnv
        )
      )
    } catch (error) {
      base = { ...this.electronEnv }
      source = 'electron-fallback'
      sourceError =
        error instanceof Error && error.name === 'AbortError'
          ? 'Login Shell 探测超时'
          : 'Login Shell 探测失败'
    }

    if (
      config.mode === 'auto' &&
      this.detectProxy(base, config, source).result !== 'http-proxy'
    ) {
      try {
        const interactive = parseShellEnvironment(
          await this.readShellEnvironment(
            shell,
            ['-ic', 'env -0'],
            this.electronEnv
          )
        )
        for (const key of PROXY_KEYS) {
          if (interactive[key]) base[key] = interactive[key]
        }
      } catch {
        // Login Shell 仍可用时，交互 Shell 探测失败不影响其他环境。
      }
    }

    if (
      config.mode === 'auto' &&
      this.detectProxy(base, config, source).result !== 'http-proxy'
    ) {
      const discovered = await this.discoverLocalProxy().catch(() => undefined)
      if (discovered) {
        base['HTTPS_PROXY'] = discovered.url
        discoveredProxySource = discovered.source
      }
    }

    const env = { ...base }
    const environmentDetection = this.detectProxy(base, config, source)
    const detected = discoveredProxySource
      ? { ...environmentDetection, proxySource: discoveredProxySource }
      : environmentDetection
    removeProxyVariables(env)
    if (config.mode === 'manual') {
      if (!config.manualPort) throw new Error('请输入 1–65535 的本地代理端口')
      const proxy = `http://127.0.0.1:${config.manualPort}`
      for (const key of [
        'PI_PROXY',
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy'
      ])
        env[key] = proxy
      env['NO_PROXY'] = LOOPBACK
      env['no_proxy'] = LOOPBACK
    } else if (config.mode === 'auto' && detected.result === 'http-proxy') {
      const raw = HTTP_KEYS.map((key) => base[key]).find(Boolean)
      if (raw) {
        for (const key of [
          'PI_PROXY',
          'HTTP_PROXY',
          'HTTPS_PROXY',
          'ALL_PROXY',
          'http_proxy',
          'https_proxy',
          'all_proxy'
        ])
          env[key] = raw
        env['NO_PROXY'] = LOOPBACK
        env['no_proxy'] = LOOPBACK
      }
    }
    const resolved = {
      env,
      network: detected,
      ...(sourceError ? { sourceError } : {})
    }
    this.#last = resolved
    return resolved
  }

  detectProxy(
    env: NodeJS.ProcessEnv,
    config: RuntimeNetworkConfig,
    source: RuntimeNetworkStatus['source']
  ): RuntimeNetworkStatus {
    if (config.mode === 'off') return networkStatus(config, source, 'direct')
    if (config.mode === 'manual')
      return networkStatus(
        config,
        source,
        'http-proxy',
        `手动配置 (http://127.0.0.1:${config.manualPort ?? '未设置'})`
      )
    for (const key of HTTP_KEYS) {
      const raw = env[key]
      if (!raw) continue
      if (/^https?:\/\//iu.test(raw))
        return networkStatus(
          config,
          source,
          'http-proxy',
          redactProxySource(key, raw)
        )
    }
    for (const key of SOCKS_KEYS) {
      const raw = env[key]
      if (raw && /^socks[45]?:\/\//iu.test(raw))
        return networkStatus(
          config,
          source,
          'unsupported-socks',
          redactProxySource(key, raw),
          '只检测到 SOCKS 代理，请改用 VPN 的本地 HTTP 入站'
        )
    }
    return networkStatus(config, source, 'direct')
  }

  async diagnostic(
    config: RuntimeNetworkConfig,
    workspace?: string
  ): Promise<RuntimeEnvironmentDiagnostic> {
    const resolved = await this.resolve(config)
    const env = resolved.env
    const tools = await Promise.all(
      (['omp', 'git', 'node', 'python'] as const).map((name) =>
        this.inspectTool(name, env, workspace)
      )
    )
    const shell = env['SHELL'] || this.electronEnv['SHELL'] || '/bin/sh'
    const path = env['PATH'] || ''
    const lines = [
      `Shell: ${shell}`,
      `PATH: ${path}`,
      `Workspace: ${workspace ?? '未选择'}`,
      ...tools.map(
        (tool) =>
          `${tool.name}: ${tool.path ?? '未找到'}${tool.version ? ` (${tool.version})` : ''}${tool.error ? ` - ${tool.error}` : ''}`
      ),
      `网络模式: ${config.mode}`,
      `代理来源: ${resolved.network.proxySource ?? '无'}`,
      ...(resolved.sourceError ? [`环境探测: ${resolved.sourceError}`] : [])
    ]
    return {
      shell,
      path,
      ...(workspace ? { workspace } : {}),
      source: resolved.network.source,
      ...(resolved.sourceError ? { sourceError: resolved.sourceError } : {}),
      tools,
      network: resolved.network,
      copyText: lines.join('\n')
    }
  }

  async inspectTool(
    name: RuntimeToolDiagnostic['name'],
    env: NodeJS.ProcessEnv,
    cwd?: string
  ): Promise<RuntimeToolDiagnostic> {
    const path =
      name === 'omp'
        ? this.runtimePath
        : await findExecutable(name, env['PATH'])
    if (!path) return { name, error: 'PATH 中未找到' }
    try {
      const { stdout, stderr } = await execFileAsync(path, ['--version'], {
        env,
        ...(cwd ? { cwd } : {}),
        timeout: 3_000,
        maxBuffer: 128 * 1024
      })
      const version = `${stdout}${stderr}`
        .trim()
        .split(/\r?\n/u)[0]
        ?.slice(0, 160)
      return { name, path, ...(version ? { version } : {}) }
    } catch (error) {
      return {
        name,
        path,
        error:
          error instanceof Error ? error.message.slice(0, 160) : '版本检测失败'
      }
    }
  }

  get last(): ResolvedRuntimeEnvironment | undefined {
    return this.#last
  }
}

async function findExecutable(
  name: string,
  pathValue?: string
): Promise<string | undefined> {
  for (const directory of (pathValue ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    if (
      await access(candidate, constants.X_OK)
        .then(() => true)
        .catch(() => false)
    )
      return candidate
  }
  return undefined
}

export function checkLocalProxyPort(
  port: number,
  timeoutMs = 1_500
): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (result: boolean): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export function checkLocalHttpProxy(
  port: number,
  timeoutMs = 1_500
): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    let response = ''
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => {
      socket.write(
        'GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\nConnection: close\r\n\r\n'
      )
    })
    socket.on('data', (chunk) => {
      response += String(chunk)
      if (response.includes('\r\n'))
        finish(/^HTTP\/1\.[01] \d{3}/u.test(response))
      else if (response.length > 256) finish(false)
    })
    socket.once('end', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
