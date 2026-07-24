import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CONTEXT_REFERENCE_MIME } from '../../src/renderer/context-drag'
import { WorkspaceFileTree } from '../../src/renderer/workspace-file-tree'

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
              expandable: true,
              symbolicLink: false
            }
          ],
          total: 1,
          offset: 0,
          limit: 100,
          revision: 1,
          workspaceVersion: 1,
          hasMore: false
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
              symbolicLink: false
            }
          ],
          total: 1,
          offset: 0,
          limit: 100,
          revision: 1,
          workspaceVersion: 1,
          hasMore: false
        }
      })
    render(
      <WorkspaceFileTree
        onAddReference={vi.fn()}
        workspaceId="workspace"
        workspaceName="project"
        workspacePath="/tmp/project"
      />
    )

    const folder = await screen.findByRole('treeitem', { name: /src/ })
    fireEvent.click(folder)
    await waitFor(() =>
      expect(window.desktop.listWorkspaceEntries).toHaveBeenLastCalledWith(
        'workspace',
        'src',
        0,
        undefined,
        'interactive'
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
        workspaceId: 'workspace',
        id: 'folder:src',
        kind: 'folder',
        name: 'src',
        relativePath: 'src'
      })
    )
  })

  it('支持键盘单选、精确右键菜单和文件搜索', async () => {
    let filesListener:
      Parameters<typeof window.desktop.onWorkspaceFilesEvent>[0] | undefined
    vi.mocked(window.desktop.onWorkspaceFilesEvent).mockImplementation(
      (listener) => {
        filesListener = listener
        return vi.fn()
      }
    )
    vi.mocked(window.desktop.listWorkspaceEntries).mockResolvedValue({
      ok: true,
      data: {
        entries: [
          {
            id: 'file:README.md',
            kind: 'file',
            name: 'README.md',
            relativePath: 'README.md',
            expandable: false,
            symbolicLink: false
          }
        ],
        total: 1,
        offset: 0,
        limit: 100,
        revision: 1,
        workspaceVersion: 1,
        hasMore: false
      }
    })
    vi.mocked(window.desktop.searchWorkspaceEntries).mockResolvedValue({
      ok: true,
      data: {
        entries: [
          {
            id: 'folder:src',
            kind: 'folder',
            name: 'src',
            relativePath: 'src',
            expandable: true,
            symbolicLink: false
          }
        ],
        truncated: false,
        workspaceVersion: 1
      }
    })
    const onAddReference = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkspaceFileTree
        onAddReference={onAddReference}
        workspaceId="workspace"
        workspaceName="project"
        workspacePath="/tmp/project"
      />
    )

    const root = await screen.findByRole('treeitem', { name: /project/ })
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    const file = await screen.findByRole('treeitem', { name: /README/ })
    await waitFor(() => expect(file).toHaveAttribute('aria-selected', 'true'))

    fireEvent.contextMenu(file, { clientX: 20, clientY: 30 })
    expect(screen.getByRole('menuitem', { name: '加入上下文' })).toBeVisible()
    expect(
      screen.getByRole('menuitem', { name: '在文件管理器中显示' })
    ).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: '加入上下文' }))
    await waitFor(() =>
      expect(onAddReference).toHaveBeenCalledWith(
        expect.objectContaining({ relativePath: 'README.md' })
      )
    )
    await waitFor(() => expect(file).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: '搜索文件' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文件' }), {
      target: { value: 'src' }
    })
    expect(
      await screen.findByRole('treeitem', { name: /src/ })
    ).toBeInTheDocument()
    expect(window.desktop.searchWorkspaceEntries).toHaveBeenCalledWith(
      'workspace',
      'src'
    )
    const calls = vi.mocked(window.desktop.searchWorkspaceEntries).mock.calls
      .length
    filesListener?.({
      type: 'directory-invalidated',
      workspaceId: 'workspace',
      workspaceVersion: 1,
      relativeDirectory: '',
      revision: 2
    })
    await waitFor(() =>
      expect(window.desktop.searchWorkspaceEntries).toHaveBeenCalledTimes(
        calls + 1
      )
    )
  })
})
