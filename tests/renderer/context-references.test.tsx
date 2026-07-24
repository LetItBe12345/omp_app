import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextReferences } from '../../src/renderer/context-references'

describe('ContextReferences', () => {
  it('裸 @ 显示单层候选并插入可移除标签', async () => {
    vi.mocked(window.desktop.getContextCandidates).mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 'file:README.md',
          kind: 'file',
          name: 'README.md',
          detail: 'README.md',
          relativePath: 'README.md',
          size: 20
        },
        {
          id: 'session:one',
          kind: 'session',
          name: '旧会话',
          detail: '2026-01-01',
          sessionId: 'one'
        }
      ]
    })
    const onInput = vi.fn()
    const onReferences = vi.fn()
    const { rerender } = render(
      <ContextReferences
        input="@"
        onInput={onInput}
        onReferences={onReferences}
        recentReferences={[]}
        references={[]}
        workspaceId="workspace"
      />
    )

    fireEvent.mouseDown(await screen.findByRole('button', { name: /README/ }))
    expect(onInput).toHaveBeenCalledWith('')
    expect(onReferences).toHaveBeenCalledWith([
      expect.objectContaining({ relativePath: 'README.md' })
    ])

    rerender(
      <ContextReferences
        input=""
        onInput={onInput}
        onReferences={onReferences}
        recentReferences={[]}
        references={[
          {
            id: 'file:README.md',
            kind: 'file',
            name: 'README.md',
            relativePath: 'README.md'
          }
        ]}
        workspaceId="workspace"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '移除 README.md' }))
    await waitFor(() => expect(onReferences).toHaveBeenLastCalledWith([]))
  })
})
