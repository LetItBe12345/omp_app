import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextReferences } from '../../src/renderer/context-references'
import { CONTEXT_REFERENCE_MIME } from '../../src/renderer/workspace-file-tree'

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

  it('接收文件树拖拽并复用引用去重逻辑', () => {
    const onReferences = vi.fn()
    const { container } = render(
      <ContextReferences
        input=""
        onInput={vi.fn()}
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
    const transfer = {
      types: [CONTEXT_REFERENCE_MIME],
      files: [],
      dropEffect: 'none',
      getData: (type: string) =>
        type === CONTEXT_REFERENCE_MIME
          ? JSON.stringify({
              id: 'folder:src',
              kind: 'folder',
              name: 'src',
              relativePath: 'src'
            })
          : ''
    }

    fireEvent.dragEnter(container, { dataTransfer: transfer })
    expect(screen.getByText('松开以引用文件或文件夹')).toBeInTheDocument()
    fireEvent.drop(container, { dataTransfer: transfer })

    expect(onReferences).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'file:README.md' }),
      expect.objectContaining({ id: 'folder:src' })
    ])
  })

  it('把系统文件管理器拖入的多个文件转换为引用', async () => {
    vi.mocked(window.desktop.resolveDroppedFiles).mockResolvedValueOnce({
      ok: true,
      data: {
        references: [
          {
            id: 'file:README.md',
            kind: 'file',
            name: 'README.md',
            relativePath: 'README.md'
          },
          {
            id: 'folder:src',
            kind: 'folder',
            name: 'src',
            relativePath: 'src'
          }
        ],
        rejectedCount: 1
      }
    })
    const onReferences = vi.fn()
    const { container } = render(
      <ContextReferences
        input=""
        onInput={vi.fn()}
        onReferences={onReferences}
        recentReferences={[]}
        references={[]}
        workspaceId="workspace"
      />
    )
    const files = [
      new File(['readme'], 'README.md'),
      new File(['source'], 'src'),
      new File(['outside'], 'outside.txt')
    ]
    const transfer = {
      types: ['Files'],
      files,
      dropEffect: 'none',
      getData: () => ''
    }

    fireEvent.drop(container, { dataTransfer: transfer })

    await waitFor(() =>
      expect(window.desktop.resolveDroppedFiles).toHaveBeenCalledWith(
        'workspace',
        files
      )
    )
    expect(onReferences).toHaveBeenCalledWith([
      expect.objectContaining({ relativePath: 'README.md' }),
      expect.objectContaining({ relativePath: 'src' })
    ])
    expect(
      await screen.findByText('已加入 2 项，另有 1 项不在当前 Workspace')
    ).toBeInTheDocument()
  })
})
