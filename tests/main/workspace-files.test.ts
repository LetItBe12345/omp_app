import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopStateStore } from '../../src/main/desktop-state'
import { IPC_CHANNELS } from '../../src/shared/desktop-api'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      electron.removeHandler(channel)
      electron.handlers.delete(channel)
    }
  },
  shell: {
    openPath: electron.openPath,
    showItemInFolder: electron.showItemInFolder
  }
}))

function harness(workspacePath: string) {
  const mainFrame = { url: 'file:///app/index.html' }
  const webContents = { mainFrame }
  const send = vi.fn()
  Object.assign(webContents, { send })
  const event = { sender: webContents, senderFrame: mainFrame }
  const stateStore = {
    requireWorkspace: (id: string) => {
      if (id !== 'workspace') throw new Error('missing')
      return { id, path: workspacePath }
    }
  } as unknown as DesktopStateStore
  return {
    event,
    send,
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
    electron.openPath.mockClear()
    electron.showItemInFolder.mockClear()
  })

  it('按目录懒加载文件树并显示点文件和被忽略目录', async () => {
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
    const { listWorkerDirectory } =
      await import('../../src/main/workspace-file-worker')
    const test = harness(root)
    const cleanup = registerWorkspaceFilesIpc(
      test.stateStore,
      test.getWindow,
      undefined,
      () => ({
        list: async (
          workspaceRoot,
          directory,
          relativeDirectory,
          revision,
          offset,
          limit
        ) =>
          listWorkerDirectory({
            id: 1,
            root: workspaceRoot,
            directory,
            relativeDirectory,
            revision,
            offset,
            limit
          }),
        close: vi.fn()
      })
    )

    const rootResult = await electron.handlers.get(
      IPC_CHANNELS.listWorkspaceEntries
    )?.(test.event, 'workspace', undefined)
    expect(rootResult).toMatchObject({
      ok: true,
      data: {
        entries: [
          expect.objectContaining({ kind: 'folder', relativePath: '.git' }),
          expect.objectContaining({
            kind: 'folder',
            relativePath: 'node_modules'
          }),
          expect.objectContaining({ kind: 'folder', relativePath: 'src' }),
          expect.objectContaining({ kind: 'file', relativePath: 'README.md' })
        ],
        offset: 0,
        limit: 100,
        total: 4,
        hasMore: false
      }
    })

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
    const { listWorkerDirectory } =
      await import('../../src/main/workspace-file-worker')
    const test = harness(root)
    registerWorkspaceFilesIpc(
      test.stateStore,
      test.getWindow,
      undefined,
      () => ({
        list: async (
          workspaceRoot,
          directory,
          relativeDirectory,
          revision,
          offset,
          limit
        ) =>
          listWorkerDirectory({
            id: 1,
            root: workspaceRoot,
            directory,
            relativeDirectory,
            revision,
            offset,
            limit
          }),
        close: vi.fn()
      })
    )

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

  it('Worker 自然排序并且每次只返回请求页', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-worker-${process.pid}-${Date.now()}`
    )
    await mkdir(root, { recursive: true })
    await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        writeFile(join(root, `file${index + 1}.txt`), '')
      )
    )
    const { listWorkerDirectory } =
      await import('../../src/main/workspace-file-worker')
    const canonicalRoot = await realpath(root)
    const first = await listWorkerDirectory({
      id: 1,
      root: canonicalRoot,
      directory: canonicalRoot,
      relativeDirectory: '',
      revision: 1,
      offset: 0,
      limit: 100
    })
    await writeFile(join(root, 'file106.txt'), '')
    const second = await listWorkerDirectory({
      id: 2,
      root: canonicalRoot,
      directory: canonicalRoot,
      relativeDirectory: '',
      revision: 1,
      offset: 100,
      limit: 100
    })

    expect(first.total).toBe(105)
    expect(first.entries).toHaveLength(100)
    expect(first.entries.slice(0, 3).map((entry) => entry.name)).toEqual([
      'file1.txt',
      'file2.txt',
      'file3.txt'
    ])
    expect(second.entries).toHaveLength(5)
    const refreshed = await listWorkerDirectory({
      id: 3,
      root: canonicalRoot,
      directory: canonicalRoot,
      relativeDirectory: '',
      revision: 2,
      offset: 100,
      limit: 100
    })
    expect(refreshed.total).toBe(106)
    expect(refreshed.entries).toHaveLength(6)
  })

  it('非 Git Workspace 使用 .gitignore 回退并允许搜索点文件', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-search-${process.pid}-${Date.now()}`
    )
    await mkdir(join(root, 'ignored'), { recursive: true })
    await writeFile(join(root, '.gitignore'), 'ignored/\n')
    await writeFile(join(root, '.env.example'), 'TOKEN=')
    await writeFile(join(root, 'ignored', 'secret.txt'), 'secret')
    const { registerWorkspaceFilesIpc } =
      await import('../../src/main/workspace-files')
    const test = harness(root)
    registerWorkspaceFilesIpc(
      test.stateStore,
      test.getWindow,
      undefined,
      () => ({ list: vi.fn(), close: vi.fn() })
    )

    const visible = await electron.handlers.get(
      IPC_CHANNELS.searchWorkspaceEntries
    )?.(test.event, 'workspace', 'env')
    expect(visible).toMatchObject({
      ok: true,
      data: {
        entries: [expect.objectContaining({ relativePath: '.env.example' })]
      }
    })
    const ignored = await electron.handlers.get(
      IPC_CHANNELS.searchWorkspaceEntries
    )?.(test.event, 'workspace', 'secret')
    expect(ignored).toMatchObject({
      ok: true,
      data: { entries: [] }
    })
  })

  it('监听根目录和展开目录，并通过受控 IPC 打开文件', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-watch-${process.pid}-${Date.now()}`
    )
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'README.md'), 'readme')
    const { registerWorkspaceFilesIpc } =
      await import('../../src/main/workspace-files')
    const test = harness(root)
    const runtime = new EventEmitter()
    const restart = vi.fn()
    const cleanup = registerWorkspaceFilesIpc(
      test.stateStore,
      test.getWindow,
      undefined,
      () => ({ list: vi.fn(), restart, close: vi.fn() }),
      runtime
    )

    const state = await electron.handlers.get(
      IPC_CHANNELS.watchWorkspaceDirectories
    )?.(test.event, 'workspace', ['src'])
    expect(state).toMatchObject({
      ok: true,
      data: { watchedDirectories: 2, limited: false }
    })
    expect(test.send).toHaveBeenCalledWith(
      IPC_CHANNELS.workspaceFilesEvent,
      expect.objectContaining({ type: 'watch-state' })
    )

    await electron.handlers.get(IPC_CHANNELS.openWorkspaceEntry)?.(
      test.event,
      'workspace',
      'README.md'
    )
    expect(electron.showItemInFolder).toHaveBeenCalledWith(
      join(root, 'README.md')
    )
    const refreshed = await electron.handlers.get(
      IPC_CHANNELS.refreshWorkspaceDirectories
    )?.(test.event, 'workspace', ['', 'src'])
    expect(refreshed).toMatchObject({
      ok: true,
      data: {
        workspaceVersion: 1,
        revisions: { '': 2, src: 2 }
      }
    })
    expect(restart).toHaveBeenCalled()

    runtime.emit('event', {
      type: 'tool_execution_start',
      toolCallId: 'write-1',
      toolName: 'write',
      args: { path: 'src/generated.ts' }
    })
    runtime.emit('event', {
      type: 'tool_execution_end',
      toolCallId: 'write-1'
    })
    expect(test.send).toHaveBeenCalledWith(
      IPC_CHANNELS.workspaceFilesEvent,
      expect.objectContaining({
        type: 'directory-invalidated',
        relativeDirectory: 'src'
      })
    )
    const before = test.send.mock.calls.length
    runtime.emit('event', {
      type: 'tool_execution_end',
      toolName: 'bash',
      args: { command: 'touch src/guessed.ts' }
    })
    expect(test.send).toHaveBeenCalledTimes(before)
    cleanup()
  })

  it('读取队列限制后台并发并优先启动交互请求', async () => {
    const { DirectoryReadScheduler } =
      await import('../../src/main/workspace-files')
    const pending: Array<{
      directory: string
      resolve: () => void
    }> = []
    let active = 0
    let maximum = 0
    const scheduler = new DirectoryReadScheduler({
      list: async (_root, directory) =>
        new Promise((resolvePromise) => {
          active += 1
          maximum = Math.max(maximum, active)
          pending.push({
            directory,
            resolve: () => {
              active -= 1
              resolvePromise({ entries: [], total: 0 })
            }
          })
        }),
      close: vi.fn()
    })

    const background = Array.from({ length: 5 }, (_, index) =>
      scheduler.list(
        '/root',
        `/root/bg-${index}`,
        `bg-${index}`,
        1,
        0,
        100,
        'background'
      )
    )
    await Promise.resolve()
    expect(pending.map((item) => item.directory)).toEqual([
      '/root/bg-0',
      '/root/bg-1',
      '/root/bg-2'
    ])

    const interactive = scheduler.list(
      '/root',
      '/root/user',
      'user',
      1,
      0,
      100,
      'interactive'
    )
    await Promise.resolve()
    expect(pending.map((item) => item.directory)).toContain('/root/user')
    expect(maximum).toBe(4)

    const duplicate = scheduler.list(
      '/root',
      '/root/user',
      'user',
      1,
      0,
      100,
      'interactive'
    )
    expect(duplicate).toBe(interactive)

    for (const task of pending.splice(0)) task.resolve()
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
    for (const task of pending.splice(0)) task.resolve()
    await Promise.all([...background, interactive])
    scheduler.close()
  })

  it('watcher 上限包含根目录并报告部分目录暂停', async () => {
    const root = join(
      tmpdir(),
      `omp-workspace-watch-limit-${process.pid}-${Date.now()}`
    )
    const directories = Array.from(
      { length: 260 },
      (_, index) => `directory-${index}`
    )
    await Promise.all(
      directories.map((directory) =>
        mkdir(join(root, directory), { recursive: true })
      )
    )
    const { registerWorkspaceFilesIpc } =
      await import('../../src/main/workspace-files')
    const test = harness(root)
    const cleanup = registerWorkspaceFilesIpc(
      test.stateStore,
      test.getWindow,
      undefined,
      () => ({ list: vi.fn(), close: vi.fn() })
    )

    const result = await electron.handlers.get(
      IPC_CHANNELS.watchWorkspaceDirectories
    )?.(test.event, 'workspace', directories)
    expect(result).toMatchObject({
      ok: true,
      data: { watchedDirectories: 256, limited: true }
    })
    cleanup()
  })
})
