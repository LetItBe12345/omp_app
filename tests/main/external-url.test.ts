// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateExternalUrl } from '../../src/main/external-url'

describe('validateExternalUrl', () => {
  it.each(['https://example.com/path', 'http://localhost:3000'])(
    '允许 HTTP(S)：%s',
    (url) => {
      expect(validateExternalUrl(url)?.toString()).toBe(new URL(url).toString())
    }
  )

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,secret',
    'omp://settings',
    'https://user:password@example.com',
    'not a url'
  ])('拒绝不安全外链：%s', (url) => {
    expect(validateExternalUrl(url)).toBeNull()
  })
})
