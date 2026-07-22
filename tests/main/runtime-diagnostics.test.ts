import { describe, expect, it } from 'vitest'
import { redactRuntimeLog } from '../../src/main/runtime-diagnostics'

describe('redactRuntimeLog', () => {
  it('隐藏凭据、代理认证和 Prompt 消息', () => {
    const value = redactRuntimeLog(
      'API_KEY=secret proxy=http://user:pass@127.0.0.1:1080 {"message":"private prompt"}'
    )

    expect(value).not.toContain('secret')
    expect(value).not.toContain('user:pass')
    expect(value).not.toContain('private prompt')
  })
})
