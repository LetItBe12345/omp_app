import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ContextReference,
  DesktopResult,
  DroppedReferenceResult,
  RuntimeErrorCode,
  WorkspaceEntry,
  WorkspaceEntryList
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { DesktopStateStore } from './desktop-state'

const MAX_DIRECTORY_ENTRIES = 500
const MAX_DROPPED_PATHS = 100
const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.cache'
])

type WindowGetter = () => BrowserWindow | null

class WorkspaceFileError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

function success<T>(data: T): DesktopResult<T> {
  return { ok: true, data }
}

function failure<T>(error: unknown): DesktopResult<T> {
  const mapped =
    error instanceof WorkspaceFileError
      ? error
      : new WorkspaceFileError(
          'INVALID_ARGUMENT',
          error instanceof Error ? error.message : String(error)
        )
  return {
    ok: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

function isTrustedSender(
  event: IpcMainInvokeEvent,
  getWindow: WindowGetter,
  developmentUrl?: string
): boolean {
  const window = getWindow()
  if (!window || window.isDestroyed()) return false
  if (event.sender !== window.webContents) return false
  if (event.senderFrame !== window.webContents.mainFrame) return false
  const frameUrl = event.senderFrame.url
  if (developmentUrl) {
    try {
      return new URL(frameUrl).origin === new URL(developmentUrl).origin
    } catch {
      return false
    }
  }
  return frameUrl.startsWith('file://')
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  getWindow: WindowGetter,
  developmentUrl?: string
): void {
  if (!isTrustedSender(event, getWindow, developmentUrl)) {
    throw new WorkspaceFileError('UNSUPPORTED', 'IPC 调用来源不受信任')
  }
}

function requireWorkspace(stateStore: DesktopStateStore, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') {
    throw new WorkspaceFileError('INVALID_ARGUMENT', 'Workspace ID 无效')
  }
  try {
    return stateStore.requireWorkspace(workspaceId)
  } catch {
    throw new WorkspaceFileError(
      'WORKSPACE_UNAVAILABLE',
      'Workspace 不存在',
      false
    )
  }
}

async function workspaceRoot(path: string): Promise<string> {
  return realpath(path).catch(() => {
    throw new WorkspaceFileError(
      'WORKSPACE_UNAVAILABLE',
      'Workspace 路径不可用',
      true
    )
  })
}

async function resolveDirectory(root: string, value: unknown): Promise<string> {
  const relativeDirectory = value === undefined ? '' : value
  if (
    typeof relativeDirectory !== 'string' ||
    relativeDirectory.includes('\0') ||
    isAbsolute(relativeDirectory)
  ) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '目录路径无效')
  }
  const lexical = resolve(root, relativeDirectory)
  if (!isWithin(root, lexical)) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '目录超出当前 Workspace')
  }
  const directory = await realpath(lexical).catch(() => {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '目录不存在')
  })
  if (!isWithin(root, directory)) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '目录超出当前 Workspace')
  }
  const info = await stat(directory)
  if (!info.isDirectory()) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '目标不是目录')
  }
  return directory
}

async function listEntries(
  workspacePath: string,
  relativeDirectory: unknown
): Promise<WorkspaceEntryList> {
  const root = await workspaceRoot(workspacePath)
  const directory = await resolveDirectory(root, relativeDirectory)
  const handle = await opendir(directory)
  const pending: Array<{
    name: string
    isDirectory: boolean
    isFile: boolean
    isSymbolicLink: boolean
  }> = []
  for await (const entry of handle) {
    if (entry.name.startsWith('.')) continue
    if (ignoredDirectoryNames.has(entry.name)) continue
    if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink())
      continue
    pending.push({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink()
    })
    if (pending.length > MAX_DIRECTORY_ENTRIES) break
  }
  const truncated = pending.length > MAX_DIRECTORY_ENTRIES
  const entries = (
    await Promise.all(
      pending.slice(0, MAX_DIRECTORY_ENTRIES).map(async (item) => {
        const absolute = join(directory, item.name)
        let isDirectory = item.isDirectory
        let isFile = item.isFile
        if (item.isSymbolicLink) {
          const link = await lstat(absolute).catch(() => null)
          if (!link?.isSymbolicLink()) return null
          const target = await realpath(absolute).catch(() => null)
          if (!target || !isWithin(root, target)) return null
          const targetInfo = await stat(target).catch(() => null)
          if (!targetInfo) return null
          isDirectory = targetInfo.isDirectory()
          isFile = targetInfo.isFile()
        }
        if (!isDirectory && !isFile) return null
        const kind = isDirectory ? 'folder' : 'file'
        const relativePath = relative(root, absolute)
        return {
          id: `${kind}:${relativePath}`,
          kind,
          name: item.name,
          relativePath,
          expandable: kind === 'folder' && !item.isSymbolicLink
        } satisfies WorkspaceEntry
      })
    )
  ).filter((entry): entry is WorkspaceEntry => entry !== null)
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
  return { entries, truncated }
}

async function resolveDroppedPaths(
  workspacePath: string,
  value: unknown
): Promise<DroppedReferenceResult> {
  if (!Array.isArray(value)) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '拖入路径无效')
  }
  const root = await workspaceRoot(workspacePath)
  const references: ContextReference[] = []
  const seen = new Set<string>()
  let rejectedCount = Math.max(0, value.length - MAX_DROPPED_PATHS)
  for (const raw of value.slice(0, MAX_DROPPED_PATHS)) {
    if (
      typeof raw !== 'string' ||
      !raw ||
      raw.includes('\0') ||
      !isAbsolute(raw)
    ) {
      rejectedCount += 1
      continue
    }
    const lexical = resolve(raw)
    if (!isWithin(root, lexical)) {
      rejectedCount += 1
      continue
    }
    const target = await realpath(lexical).catch(() => null)
    if (!target || !isWithin(root, target)) {
      rejectedCount += 1
      continue
    }
    const info = await stat(target).catch(() => null)
    if (!info || (!info.isFile() && !info.isDirectory())) {
      rejectedCount += 1
      continue
    }
    const relativePath = relative(root, lexical)
    if (!relativePath) {
      rejectedCount += 1
      continue
    }
    const kind = info.isDirectory() ? 'folder' : 'file'
    const id = `${kind}:${relativePath}`
    if (seen.has(id)) continue
    seen.add(id)
    references.push({
      id,
      kind,
      name: basename(lexical),
      relativePath
    })
  }
  return { references, rejectedCount }
}

export function registerWorkspaceFilesIpc(
  stateStore: DesktopStateStore,
  getWindow: WindowGetter,
  developmentUrl?: string
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.listWorkspaceEntries,
    async (event, workspaceId: unknown, relativeDirectory: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        return success(await listEntries(workspace.path, relativeDirectory))
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.resolveDroppedPaths,
    async (event, workspaceId: unknown, paths: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        return success(await resolveDroppedPaths(workspace.path, paths))
      } catch (error) {
        return failure(error)
      }
    }
  )
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.listWorkspaceEntries)
    ipcMain.removeHandler(IPC_CHANNELS.resolveDroppedPaths)
  }
}
