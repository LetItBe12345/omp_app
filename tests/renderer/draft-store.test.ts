import { describe, expect, it } from 'vitest'
import {
  cleanExpiredDrafts,
  loadDraft,
  saveDraft
} from '../../src/renderer/draft-store'

describe('draft-store', () => {
  it('按 Workspace ID 和 Session ID 保存文字与引用描述', () => {
    const result = saveDraft(localStorage, 'workspace', 'session', '草稿', [
      {
        id: 'file:README.md',
        kind: 'file',
        name: 'README.md',
        relativePath: 'README.md'
      }
    ])
    expect(result).toEqual({ saved: true })
    expect(loadDraft(localStorage, 'workspace', 'session')).toMatchObject({
      text: '草稿',
      references: [{ relativePath: 'README.md' }]
    })
  })

  it('单草稿超限时不截断当前输入', () => {
    const text = '字'.repeat(100_000)
    expect(saveDraft(localStorage, 'workspace', 'large', text, [])).toEqual({
      saved: false,
      reason: 'item-too-large'
    })
    expect(loadDraft(localStorage, 'workspace', 'large')).toBeNull()
  })

  it('清理超过 30 天的草稿', () => {
    const now = Date.now()
    saveDraft(localStorage, 'workspace', 'old', 'old', [], now - 31 * 864e5)
    cleanExpiredDrafts(localStorage, now)
    expect(loadDraft(localStorage, 'workspace', 'old')).toBeNull()
  })

  it('总量超过 2 MiB 时先清理最旧的非当前草稿', () => {
    const chunk = 'x'.repeat(200_000)
    for (let index = 0; index < 12; index += 1)
      expect(
        saveDraft(
          localStorage,
          'workspace',
          `session-${index}`,
          chunk,
          [],
          Date.now() + index
        )
      ).toEqual({ saved: true })
    expect(loadDraft(localStorage, 'workspace', 'session-0')).toBeNull()
    expect(loadDraft(localStorage, 'workspace', 'session-11')).not.toBeNull()
  })

  it('存储首次失败时清理后重试一次', () => {
    let attempts = 0
    const values = new Map<string, string>()
    const storage = {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
      setItem: (key: string, value: string) => {
        attempts += 1
        if (attempts === 1) throw new DOMException('quota')
        values.set(key, value)
      }
    } satisfies Storage
    expect(saveDraft(storage, 'workspace', 'retry', '保留输入', [])).toEqual({
      saved: true
    })
    expect(attempts).toBe(2)
  })
})
