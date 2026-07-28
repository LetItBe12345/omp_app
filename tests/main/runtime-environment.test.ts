// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkLocalHttpProxy,
  checkLocalProxyPort,
  discoverV2rayNProxy,
  extractV2rayNPorts,
  RuntimeEnvironmentResolver
} from '../../src/main/runtime-environment'

describe('RuntimeEnvironmentResolver', () => {
  it('从 Login Shell 读取 PATH 和普通环境变量', async () => {
    const resolver = new RuntimeEnvironmentResolver(process.execPath, {
      SHELL: '/bin/sh',
      PATH: '/usr/bin:/bin',
      OMP_LOGIN_ENV_MARKER: 'preserved'
    })

    const resolved = await resolver.resolve({ mode: 'off' })

    expect(resolved.network.source).toBe('login-shell')
    expect(resolved.env['PATH']).toBeTruthy()
    expect(resolved.env['OMP_LOGIN_ENV_MARKER']).toBe('preserved')
  })

  it('关闭模式从回退环境显式删除全部代理变量', async () => {
    const resolver = new RuntimeEnvironmentResolver(process.execPath, {
      SHELL: '/path/that/does/not/exist',
      PATH: process.env['PATH'],
      HTTP_PROXY: 'http://user:secret@127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
      PI_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'example.com'
    })

    const resolved = await resolver.resolve({ mode: 'off' })

    expect(resolved.network.source).toBe('electron-fallback')
    expect(resolved.env).not.toHaveProperty('HTTP_PROXY')
    expect(resolved.env).not.toHaveProperty('http_proxy')
    expect(resolved.env).not.toHaveProperty('PI_PROXY')
    expect(resolved.env).not.toHaveProperty('NO_PROXY')
  })

  it('手动模式生成大小写代理变量和固定回环绕过', async () => {
    const resolver = new RuntimeEnvironmentResolver(process.execPath, {
      SHELL: '/missing-shell',
      PATH: process.env['PATH']
    })

    const resolved = await resolver.resolve({
      mode: 'manual',
      manualPort: 3210
    })

    expect(resolved.env).toMatchObject({
      PI_PROXY: 'http://127.0.0.1:3210',
      HTTP_PROXY: 'http://127.0.0.1:3210',
      HTTPS_PROXY: 'http://127.0.0.1:3210',
      ALL_PROXY: 'http://127.0.0.1:3210',
      http_proxy: 'http://127.0.0.1:3210',
      https_proxy: 'http://127.0.0.1:3210',
      all_proxy: 'http://127.0.0.1:3210',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1'
    })
  })

  it('自动模式脱敏认证信息并拒绝仅 SOCKS 的环境', () => {
    const resolver = new RuntimeEnvironmentResolver(process.execPath)
    const http = resolver.detectProxy(
      { HTTPS_PROXY: 'http://name:password@127.0.0.1:8080' },
      { mode: 'auto' },
      'login-shell'
    )
    const socks = resolver.detectProxy(
      { ALL_PROXY: 'socks5://name:password@127.0.0.1:1080' },
      { mode: 'auto' },
      'login-shell'
    )

    expect(http.proxySource).toBe('HTTPS_PROXY (http://127.0.0.1:8080)')
    expect(JSON.stringify(http)).not.toContain('password')
    expect(socks.result).toBe('unsupported-socks')
    expect(socks.error).toContain('本地 HTTP 入站')
  })

  it('自动模式在 Login Shell 没有代理时读取交互 Shell 配置', async () => {
    const calls: string[][] = []
    const resolver = new RuntimeEnvironmentResolver(
      process.execPath,
      { SHELL: '/bin/bash', PATH: '/usr/bin:/bin' },
      5_000,
      async (_shell, args, env) => {
        calls.push(args)
        const values =
          args[0] === '-ic'
            ? { ...env, https_proxy: 'http://127.0.0.1:10808' }
            : env
        return `${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join('\0')}\0`
      }
    )

    const resolved = await resolver.resolve({ mode: 'auto' })

    expect(calls).toEqual([
      ['-ilc', 'env -0'],
      ['-ic', 'env -0']
    ])
    expect(resolved.network.result).toBe('http-proxy')
    expect(resolved.env).toMatchObject({
      PI_PROXY: 'http://127.0.0.1:10808',
      HTTPS_PROXY: 'http://127.0.0.1:10808',
      https_proxy: 'http://127.0.0.1:10808'
    })
  })

  it('自动模式在 Shell 没有代理时读取可达的 v2rayN 入站', async () => {
    const resolver = new RuntimeEnvironmentResolver(
      process.execPath,
      { SHELL: '/bin/bash', PATH: '/usr/bin:/bin' },
      5_000,
      async (_shell, _args, env) =>
        `${Object.entries(env)
          .map(([key, value]) => `${key}=${value}`)
          .join('\0')}\0`,
      async () => ({
        url: 'http://127.0.0.1:10808',
        source: 'v2rayN (http://127.0.0.1:10808)'
      })
    )

    const resolved = await resolver.resolve({ mode: 'auto' })

    expect(resolved.network).toMatchObject({
      result: 'http-proxy',
      proxySource: 'v2rayN (http://127.0.0.1:10808)'
    })
    expect(resolved.env).toMatchObject({
      PI_PROXY: 'http://127.0.0.1:10808',
      HTTPS_PROXY: 'http://127.0.0.1:10808',
      https_proxy: 'http://127.0.0.1:10808'
    })
  })

  it('只提取 v2rayN 配置中合法且去重的本地端口', () => {
    expect(
      extractV2rayNPorts({
        Inbound: [
          { LocalPort: 10808 },
          { LocalPort: 10808 },
          { LocalPort: 0 },
          { LocalPort: '7890' }
        ]
      })
    ).toEqual([10808])
  })

  it('诊断复制结果不包含代理凭据或普通环境变量', async () => {
    const resolver = new RuntimeEnvironmentResolver(process.execPath, {
      SHELL: '/missing-shell',
      PATH: process.env['PATH'],
      HTTPS_PROXY: 'http://name:password@127.0.0.1:8080',
      SECRET_VALUE: 'must-not-be-copied'
    })

    const diagnostic = await resolver.diagnostic(
      { mode: 'auto' },
      process.cwd()
    )

    expect(diagnostic.copyText).toContain('http://127.0.0.1:8080')
    expect(diagnostic.copyText).not.toContain('password')
    expect(diagnostic.copyText).not.toContain('must-not-be-copied')
  })

  it('检测本地端口可达与不可达状态', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('监听失败')
    await expect(checkLocalProxyPort(address.port)).resolves.toBe(true)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await expect(checkLocalProxyPort(address.port, 50)).resolves.toBe(false)
    await expect(checkLocalProxyPort(0)).resolves.toBe(false)
  })

  it('只把返回 HTTP 响应的本地端口当作 HTTP 代理', async () => {
    const httpProxy = createServer((socket) => {
      socket.once('data', () =>
        socket.end(
          'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'
        )
      )
    })
    await new Promise<void>((resolve) =>
      httpProxy.listen(0, '127.0.0.1', resolve)
    )
    const address = httpProxy.address()
    if (!address || typeof address === 'string') throw new Error('监听失败')

    const dataHome = await mkdtemp(join(tmpdir(), 'omp-v2rayn-test-'))
    const configDirectory = join(dataHome, 'v2rayN', 'guiConfigs')
    try {
      await mkdir(configDirectory, { recursive: true })
      await writeFile(
        join(configDirectory, 'guiNConfig.json'),
        JSON.stringify({ Inbound: [{ LocalPort: address.port }] })
      )

      await expect(checkLocalHttpProxy(address.port, 200)).resolves.toBe(true)
      await expect(discoverV2rayNProxy(dataHome)).resolves.toEqual({
        url: `http://127.0.0.1:${address.port}`,
        source: `v2rayN (http://127.0.0.1:${address.port})`
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpProxy.close((error) => (error ? reject(error) : resolve()))
      )
      await rm(dataHome, { recursive: true, force: true })
    }
  })
})
