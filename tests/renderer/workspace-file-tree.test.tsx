import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_REFERENCE_MIME,
  WorkspaceFileTreePortal
} from '../../src/renderer/workspace-file-tree'

describe('WorkspaceFileTreePortal', () => {
  it('懒加载目录并把节点编码为统一拖拽引用', async () => {
    vi.mocked(window.desktop.listWorkspaceEntries)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          entries: [
            {
              id: 'folder:src',
              kind: 'folder',
              name: 'src',
              relativePath: 'src',
              expandable: true
            }
          ],
          truncated: false
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          entries: [
            {
              id: 'file:src/index.ts',
              kind: 'file',
              name: 'index.ts',
              relativePath: 'src/index.ts',
              expandable: false,
              size: 10
            }
          ],
          truncated: false
        }
      })
    render(
      <>
        <aside data-slot="file-tree" />
        <WorkspaceFileTreePortal workspaceId="workspace" />
      </>
    )

    const folder = await screen.findByRole('button', { name: /src/ })
    fireEvent.click(folder)
    await waitFor(() =>
      expect(window.desktop.listWorkspaceEntries).toHaveBeenLastCalledWith(
        'workspace',
        'src'
      )
    )
    expect(await screen.findByText('index.ts')).toBeInTheDocument()

    const setData = vi.fn()
    fireEvent.dragStart(folder, {
      dataTransfer: { effectAllowed: 'none', setData }
    })
    expect(setData).toHaveBeenCalledWith(
      CONTEXT_REFERENCE_MIME,
      JSON.stringify({
        id: 'folder:src',
        kind: 'folder',
        name: 'src',
        relativePath: 'src'
      })
    )
  })
})
