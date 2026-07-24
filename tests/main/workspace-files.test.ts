import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopStateStore } from '../../src/main/desktop-state'
import { IPC_CHANNELS } from '../../src/shared/desktop-api'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      electron.removeHandler(channel)
      electron.handlers.delete(channel)
    }
  }
}))

function harness(workspacePath: string) {
  const mainFrame = { url: 'file:///app/index.html' }
  const webContents = { mainFrame }
  const event = { sender: webContents, senderFrame: mainFrame }
  const stateStore = {
    requireWorkspace: (id: string) => {
      if (id !== 'workspace') throw new Error('missing')
      return { id, path: workspacePath }
    }
  } as unknown as DesktopStateStore
  return {
    event,
    stateStore,
    getWindow: () =>
      ({
        isDestroyed: () => false,
        webContents
      }) as never
  }
}

describe('registerWorkspaceFilesIpc', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.removeHandler.mockClear()
  })

  it('按目录懒加载文件树并过滤隐藏和常见构建目录', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-files-${process.pid}-${Date.now()}`
    )
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# test')
    await writeFile(join(root, 'src', 'index.ts'), 'export {}')
    const { registerWorkspaceFilesIpc } =
      await import('../../src/main/workspace-files')
    const test = harness(root)
    const cleanup = registerWorkspaceFilesIpc(test.stateStore, test.getWindow)

    const rootResult = await electron.handlers.get(
      IPC_CHANNELS.listWorkspaceEntries
    )?.(test.event, 'workspace', undefined)
    expect(rootResult).toMatchObject({
      ok: true,
      data: {
        entries: [
          expect.objectContaining({ kind: 'folder', relativePath: 'src' }),
          expect.objectContaining({ kind: 'file', relativePath: 'README.md' })
        ],
        truncated: false
      }
    })
    expect(JSON.stringify(rootResult)).not.toContain('.git')
    expect(JSON.stringify(rootResult)).not.toContain('node_modules')

    const childResult = await electron.handlers.get(
      IPC_CHANNELS.listWorkspaceEntries
    )?.(test.event, 'workspace', 'src')
    expect(childResult).toMatchObject({
      ok: true,
      data: {
        entries: [
          expect.objectContaining({ relativePath: join('src', 'index.ts') })
        ]
      }
    })
    cleanup()
  })

  it('只把当前 Workspace 内的拖入路径转换为上下文引用', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-drop-${process.pid}-${Date.now()}`
    )
    const outside = join(
      tmpdir(),
      `omp-workspace-outside-${process.pid}-${Date.now()}`
    )
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(root, 'README.md'), '# test')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'outside-link'))
    const { registerWorkspaceFilesIpc } =
      await import('../../src/main/workspace-files')
    const test = harness(root)
    registerWorkspaceFilesIpc(test.stateStore, test.getWindow)

    const result = await electron.handlers.get(
      IPC_CHANNELS.resolveDroppedPaths
    )?.(test.event, 'workspace', [
      join(root, 'README.md'),
      join(root, 'src'),
      join(outside, 'secret.txt'),
      join(root, 'outside-link')
    ])
    expect(result).toMatchObject({
      ok: true,
      data: {
        references: [
          expect.objectContaining({ kind: 'file', relativePath: 'README.md' }),
          expect.objectContaining({ kind: 'folder', relativePath: 'src' })
        ],
        rejectedCount: 2
      }
    })
  })
})
