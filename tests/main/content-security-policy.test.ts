// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createContentSecurityPolicy } from '../../src/main/content-security-policy'

describe('createContentSecurityPolicy', () => {
  it('生产策略不允许动态脚本执行或远程连接', () => {
    const policy = createContentSecurityPolicy(false)

    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('http:')
    expect(policy).not.toContain('ws:')
    expect(policy).toContain("object-src 'none'")
  })

  it('开发策略只为 Vite HMR 放开脚本和本地开发连接', () => {
    const policy = createContentSecurityPolicy(true)

    expect(policy).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'")
    expect(policy).toContain("connect-src 'self' http: ws:")
  })
})
