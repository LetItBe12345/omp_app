import {
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { watch } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import type { EventEmitter } from 'node:events'
import ignore from 'ignore'
import type {
  ContextReference,
  DesktopResult,
  DroppedReferenceResult,
  RuntimeErrorCode,
  WorkspaceEntry,
  WorkspaceEntryList,
  WorkspaceFilesEvent,
  WorkspaceRefreshState,
  WorkspaceSearchResult,
  WorkspaceWatchState
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { DesktopStateStore } from './desktop-state'
import { log } from './logger'

const DIRECTORY_PAGE_SIZE = 100
const WORKER_TIMEOUT_MS = 5_000
const MAX_DROPPED_PATHS = 100
const MAX_WATCHERS = 256
const SEARCH_LIMIT = 100

type WindowGetter = () => BrowserWindow | null
type RuntimeEventSource = Pick<EventEmitter, 'on' | 'off'>

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

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/')
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

export type WorkerPage = {
  entries: Omit<WorkspaceEntry, 'id'>[]
  total: number
}

export type DirectoryWorker = {
  list(
    root: string,
    directory: string,
    relativeDirectory: string,
    revision: number,
    offset: number,
    limit: number,
    priority?: 'interactive' | 'background'
  ): Promise<WorkerPage>
  restart?(): void
  close(): void
}

class WorkspaceDirectoryWorker implements DirectoryWorker {
  #worker: Worker | null = null
  #nextId = 1
  #rebuilds = 0
  #pending = new Map<
    number,
    {
      resolve: (value: WorkerPage) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()

  async list(
    root: string,
    directory: string,
    relativeDirectory: string,
    revision: number,
    offset: number,
    limit: number
  ): Promise<WorkerPage> {
    const worker = this.#ensureWorker()
    const id = this.#nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#handleCrash(
          worker,
          new WorkspaceFileError('RPC_TIMEOUT', '文件读取超时', true)
        )
      }, WORKER_TIMEOUT_MS)
      this.#pending.set(id, { resolve: resolvePromise, reject, timer })
      worker.postMessage({
        id,
        root,
        directory,
        relativeDirectory,
        revision,
        offset,
        limit
      })
    })
  }

  restart(): void {
    this.#rebuilds = 0
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('文件读取服务已重启'))
    }
    this.#pending.clear()
    void this.#worker?.terminate()
    this.#worker = null
  }

  close(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('文件读取服务已关闭'))
    }
    this.#pending.clear()
    void this.#worker?.terminate()
    this.#worker = null
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker
    if (this.#rebuilds > 1) {
      throw new WorkspaceFileError('CRASHED', '文件读取服务连续失败', false)
    }
    const worker = new Worker(
      new URL('./workspace-file-worker.js', import.meta.url)
    )
    worker.on(
      'message',
      (message: {
        id?: unknown
        ok?: unknown
        entries?: unknown
        total?: unknown
        error?: unknown
      }) => {
        if (typeof message.id !== 'number') return
        const pending = this.#pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(message.id)
        if (
          message.ok === true &&
          Array.isArray(message.entries) &&
          typeof message.total === 'number'
        ) {
          this.#rebuilds = 0
          pending.resolve({
            entries: message.entries as Omit<WorkspaceEntry, 'id'>[],
            total: message.total
          })
        } else {
          pending.reject(
            new WorkspaceFileError(
              'PROTOCOL_ERROR',
              typeof message.error === 'string'
                ? message.error
                : '文件 Worker 返回无效结果',
              true
            )
          )
        }
      }
    )
    worker.once('error', (error) => this.#handleCrash(worker, error))
    worker.once('exit', (code) => {
      if (code !== 0)
        this.#handleCrash(worker, new Error(`Worker exit ${code}`))
    })
    this.#worker = worker
    return worker
  }

  #handleCrash(worker: Worker, error: Error): void {
    if (this.#worker !== worker) return
    this.#worker = null
    void worker.terminate()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(
        new WorkspaceFileError(
          'CRASHED',
          this.#rebuilds === 0
            ? '文件读取服务异常，可重试'
            : '文件读取服务连续失败',
          this.#rebuilds === 0
        )
      )
    }
    this.#pending.clear()
    this.#rebuilds += 1
    if (this.#rebuilds > 1) this.#worker = null
    void error
  }
}

type ScheduledRead = {
  key: string
  background: boolean
  run: () => Promise<WorkerPage>
  resolve: (value: WorkerPage) => void
  reject: (error: unknown) => void
}

export class DirectoryReadScheduler implements DirectoryWorker {
  #interactive: ScheduledRead[] = []
  #background: ScheduledRead[] = []
  #inflight = new Map<string, Promise<WorkerPage>>()
  #active = 0
  #activeBackground = 0

  constructor(private readonly delegate: DirectoryWorker) {}

  list(
    root: string,
    directory: string,
    relativeDirectory: string,
    revision: number,
    offset: number,
    limit: number,
    priority: 'interactive' | 'background' = 'interactive'
  ): Promise<WorkerPage> {
    const key = `${root}\0${directory}\0${revision}\0${offset}\0${limit}`
    const existing = this.#inflight.get(key)
    if (existing) return existing
    const promise = new Promise<WorkerPage>((resolvePromise, reject) => {
      const task: ScheduledRead = {
        key,
        background: priority === 'background',
        run: () =>
          this.delegate.list(
            root,
            directory,
            relativeDirectory,
            revision,
            offset,
            limit
          ),
        resolve: resolvePromise,
        reject
      }
      if (task.background) this.#background.push(task)
      else this.#interactive.push(task)
      this.#pump()
    })
    this.#inflight.set(key, promise)
    return promise
  }

  restart(): void {
    const error = new Error('文件读取队列已重启')
    for (const task of [...this.#interactive, ...this.#background]) {
      this.#inflight.delete(task.key)
      task.reject(error)
    }
    this.#interactive = []
    this.#background = []
    this.delegate.restart?.()
  }

  close(): void {
    const error = new Error('文件读取队列已关闭')
    for (const task of [...this.#interactive, ...this.#background])
      task.reject(error)
    this.#interactive = []
    this.#background = []
    this.delegate.close()
  }

  #pump(): void {
    while (this.#active < 4) {
      const task =
        this.#interactive.shift() ??
        (this.#activeBackground < 3 ? this.#background.shift() : undefined)
      if (!task) return
      this.#active += 1
      if (task.background) this.#activeBackground += 1
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.#active -= 1
          if (task.background) this.#activeBackground -= 1
          this.#inflight.delete(task.key)
          this.#pump()
        })
    }
  }
}

async function listEntries(
  worker: DirectoryWorker,
  workspacePath: string,
  relativeDirectory: unknown,
  offsetValue: unknown,
  revisionValue: unknown,
  workspaceVersion: number,
  revisions: Map<string, number>,
  priorityValue: unknown
): Promise<WorkspaceEntryList> {
  const relativePath =
    relativeDirectory === undefined || relativeDirectory === ''
      ? ''
      : String(relativeDirectory)
  const offset =
    typeof offsetValue === 'number' &&
    Number.isInteger(offsetValue) &&
    offsetValue >= 0
      ? offsetValue
      : 0
  if (offset % DIRECTORY_PAGE_SIZE !== 0) {
    throw new WorkspaceFileError(
      'INVALID_ARGUMENT',
      '目录分页偏移必须按 100 项递增'
    )
  }
  const root = await workspaceRoot(workspacePath)
  const directory = await resolveDirectory(root, relativeDirectory)
  const revision = revisions.get(relativePath) ?? 1
  if (
    offset > 0 &&
    (typeof revisionValue !== 'number' || revisionValue !== revision)
  ) {
    throw new WorkspaceFileError(
      'INVALID_ARGUMENT',
      '目录内容已变化，请从第一页重新读取',
      true
    )
  }
  const page = await worker.list(
    root,
    directory,
    relativePath,
    revision,
    offset,
    DIRECTORY_PAGE_SIZE,
    priorityValue === 'background' ? 'background' : 'interactive'
  )
  return {
    entries: page.entries.map((entry) => ({
      ...entry,
      id: `${entry.kind}:${entry.relativePath}`
    })),
    total: page.total,
    offset,
    limit: DIRECTORY_PAGE_SIZE,
    revision,
    workspaceVersion,
    hasMore: offset + page.entries.length < page.total
  }
}

function searchRank(name: string, path: string, query: string): number {
  const normalizedName = name.toLocaleLowerCase()
  const normalizedPath = path.toLocaleLowerCase()
  if (normalizedName === query) return 0
  if (normalizedName.startsWith(query)) return 1
  if (normalizedPath.split('/').some((part) => part.startsWith(query))) return 2
  return normalizedPath.includes(query) ? 3 : 99
}

function searchEntries(
  paths: Iterable<string>,
  queryValue: string,
  workspaceVersion: number
): WorkspaceSearchResult {
  const query = queryValue.trim().toLocaleLowerCase()
  const byPath = new Map<string, WorkspaceEntry>()
  for (const rawPath of paths) {
    const path = rawPath.replace(/\/+$/u, '')
    if (!path) continue
    const parts = path.split('/')
    for (let index = 1; index <= parts.length; index += 1) {
      const relativePath = parts.slice(0, index).join('/')
      const kind =
        index === parts.length && !rawPath.endsWith('/') ? 'file' : 'folder'
      const name = parts[index - 1]
      if (
        !name ||
        (!query && relativePath.includes('/')) ||
        (query && searchRank(name, relativePath, query) === 99)
      )
        continue
      const existing = byPath.get(relativePath)
      if (existing?.kind === 'folder') continue
      byPath.set(relativePath, {
        id: `${kind}:${relativePath}`,
        kind,
        name,
        relativePath,
        expandable: kind === 'folder',
        symbolicLink: false
      })
    }
  }
  const ranked = [...byPath.values()].sort((left, right) => {
    const rank =
      searchRank(left.name, left.relativePath, query) -
      searchRank(right.name, right.relativePath, query)
    if (rank) return rank
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  })
  return {
    entries: ranked.slice(0, SEARCH_LIMIT),
    truncated: ranked.length > SEARCH_LIMIT,
    workspaceVersion
  }
}

export async function findWorkspaceSearchEntries(
  workspacePath: string,
  query: string,
  signal?: AbortSignal
): Promise<WorkspaceEntry[]> {
  return (await searchWorkspace(workspacePath, query, 1, signal)).entries
}

async function gitSearchPaths(
  root: string,
  signal?: AbortSignal
): Promise<string[] | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      'git',
      ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'],
      { stdio: ['ignore', 'pipe', 'ignore'], signal }
    )
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => resolvePromise(null))
    child.once('exit', (code) => {
      if (code !== 0) {
        resolvePromise(null)
        return
      }
      resolvePromise(
        Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean)
      )
    })
  })
}

async function ignoredSearchPaths(
  root: string,
  signal?: AbortSignal
): Promise<string[]> {
  const matcher = ignore()
  const gitignore = await readFile(resolve(root, '.gitignore'), 'utf8').catch(
    () => ''
  )
  matcher.add(gitignore)
  const paths: string[] = []
  const visit = async (directory: string, relativeDirectory: string) => {
    signal?.throwIfAborted()
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => []
    )
    for (const entry of entries) {
      signal?.throwIfAborted()
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      if (matcher.ignores(relativePath)) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        paths.push(`${relativePath}/`)
        await visit(resolve(directory, entry.name), relativePath)
      } else if (entry.isFile()) {
        paths.push(relativePath)
      }
    }
  }
  await visit(root, '')
  return paths
}

async function searchWorkspace(
  workspacePath: string,
  query: string,
  workspaceVersion: number,
  signal?: AbortSignal
): Promise<WorkspaceSearchResult> {
  const root = await workspaceRoot(workspacePath)
  const paths =
    (await gitSearchPaths(root, signal)) ??
    (await ignoredSearchPaths(root, signal))
  return searchEntries(paths, query, workspaceVersion)
}

type WatchRecord = {
  controller: AbortController
  immediateTimer?: NodeJS.Timeout
  correctionTimer?: NodeJS.Timeout
  lastRefreshAt: number
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

async function resolveWorkspaceReferences(
  workspacePath: string,
  value: unknown
): Promise<DroppedReferenceResult> {
  if (!Array.isArray(value)) {
    throw new WorkspaceFileError('INVALID_ARGUMENT', '上下文引用无效')
  }
  const root = await workspaceRoot(workspacePath)
  const references: ContextReference[] = []
  const seen = new Set<string>()
  let rejectedCount = 0
  for (const item of value.slice(0, MAX_DROPPED_PATHS)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      rejectedCount += 1
      continue
    }
    const candidate = item as Record<string, unknown>
    const relativePath = candidate['relativePath']
    const requestedKind = candidate['kind']
    if (
      typeof relativePath !== 'string' ||
      relativePath.includes('\0') ||
      isAbsolute(relativePath) ||
      (requestedKind !== 'file' && requestedKind !== 'folder')
    ) {
      rejectedCount += 1
      continue
    }
    const lexical = resolve(root, relativePath)
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
    const actualKind = info?.isDirectory()
      ? 'folder'
      : info?.isFile()
        ? 'file'
        : undefined
    if (!actualKind || actualKind !== requestedKind) {
      rejectedCount += 1
      continue
    }
    const normalizedPath =
      relativePath === '.'
        ? '.'
        : normalizeRelativePath(relative(root, lexical))
    const id = `${actualKind}:${normalizedPath}`
    if (seen.has(id)) continue
    seen.add(id)
    references.push({
      id,
      kind: actualKind,
      name:
        typeof candidate['name'] === 'string' && candidate['name']
          ? candidate['name']
          : normalizedPath === '.'
            ? basename(root)
            : basename(lexical),
      relativePath: normalizedPath
    })
  }
  rejectedCount += Math.max(0, value.length - MAX_DROPPED_PATHS)
  return { references, rejectedCount }
}

export function registerWorkspaceFilesIpc(
  stateStore: DesktopStateStore,
  getWindow: WindowGetter,
  developmentUrl?: string,
  createWorker: () => DirectoryWorker = () => new WorkspaceDirectoryWorker(),
  runtimeEvents?: RuntimeEventSource
): () => void {
  const worker = new DirectoryReadScheduler(createWorker())
  const workspaceVersions = new Map<string, number>()
  const revisions = new Map<string, Map<string, number>>()
  const watchers = new Map<string, WatchRecord>()
  const watcherUse = new Map<string, number>()
  const pendingToolPaths = new Map<string, string[]>()
  let requestedDirectories = new Set<string>()
  let activeWatcherWorkspace: string | undefined
  let searchController: AbortController | undefined

  const sendFilesEvent = (event: WorkspaceFilesEvent): void => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.workspaceFilesEvent, event)
  }

  const clearWatchers = (): void => {
    for (const record of watchers.values()) {
      record.controller.abort()
      if (record.immediateTimer) clearTimeout(record.immediateTimer)
      if (record.correctionTimer) clearTimeout(record.correctionTimer)
    }
    watchers.clear()
    watcherUse.clear()
    pendingToolPaths.clear()
    requestedDirectories = new Set()
  }

  const invalidateDirectory = (
    workspaceId: string,
    workspaceVersion: number,
    relativeDirectory: string,
    record: WatchRecord
  ): void => {
    const directoryRevisions =
      revisions.get(workspaceId) ?? new Map<string, number>()
    revisions.set(workspaceId, directoryRevisions)
    const publish = (): void => {
      record.immediateTimer = undefined
      record.lastRefreshAt = Date.now()
      const revision = (directoryRevisions.get(relativeDirectory) ?? 1) + 1
      directoryRevisions.set(relativeDirectory, revision)
      sendFilesEvent({
        type: 'directory-invalidated',
        workspaceId,
        workspaceVersion,
        relativeDirectory,
        revision
      })
    }
    const elapsed = Date.now() - record.lastRefreshAt
    if (!record.immediateTimer) {
      if (elapsed >= 250) publish()
      else record.immediateTimer = setTimeout(publish, 250 - elapsed)
    }
    if (record.correctionTimer) clearTimeout(record.correctionTimer)
    record.correctionTimer = setTimeout(() => {
      record.correctionTimer = undefined
      if (Date.now() - record.lastRefreshAt >= 120) publish()
    }, 120)
    if (Date.now() - record.lastRefreshAt >= 500 && !record.immediateTimer)
      publish()
  }

  const watchDirectories = async (
    workspaceId: string,
    workspacePath: string,
    relativeDirectories: unknown
  ): Promise<WorkspaceWatchState> => {
    if (
      !Array.isArray(relativeDirectories) ||
      !relativeDirectories.every((item) => typeof item === 'string')
    ) {
      throw new WorkspaceFileError('INVALID_ARGUMENT', '展开目录列表无效')
    }
    if (activeWatcherWorkspace !== workspaceId) {
      clearWatchers()
      searchController?.abort()
      worker.restart?.()
      const nextVersion =
        activeWatcherWorkspace === undefined
          ? (workspaceVersions.get(workspaceId) ?? 1)
          : (workspaceVersions.get(workspaceId) ?? 1) + 1
      workspaceVersions.set(workspaceId, nextVersion)
      activeWatcherWorkspace = workspaceId
    }
    const workspaceVersion = workspaceVersions.get(workspaceId) ?? 1
    const requested = [
      '',
      ...relativeDirectories
        .filter((item) => item !== '')
        .map(normalizeRelativePath)
    ]
    const unique = [...new Set(requested)]
    const now = Date.now()
    const nextRequested = new Set(unique)
    for (const relativeDirectory of unique) {
      if (!requestedDirectories.has(relativeDirectory))
        watcherUse.set(relativeDirectory, now)
    }
    requestedDirectories = nextRequested
    const candidates = unique
      .filter((item) => item !== '')
      .map((relativeDirectory) => ({
        relativeDirectory,
        lastUsed: watcherUse.get(relativeDirectory) ?? now
      }))
      .sort((left, right) => right.lastUsed - left.lastUsed)
    const accepted = [
      '',
      ...candidates
        .slice(0, MAX_WATCHERS - 1)
        .map((item) => item.relativeDirectory)
    ]
    const acceptedSet = new Set(accepted)
    for (const [key, record] of watchers) {
      if (acceptedSet.has(key)) continue
      record.controller.abort()
      if (record.immediateTimer) clearTimeout(record.immediateTimer)
      if (record.correctionTimer) clearTimeout(record.correctionTimer)
      watchers.delete(key)
    }

    const root = await workspaceRoot(workspacePath)
    let watchError: string | undefined
    for (const relativeDirectory of accepted) {
      const existing = watchers.get(relativeDirectory)
      if (existing) {
        continue
      }
      try {
        const directory = await resolveDirectory(root, relativeDirectory)
        const controller = new AbortController()
        const record: WatchRecord = {
          controller,
          lastRefreshAt: 0
        }
        watch(directory, { recursive: false, signal: controller.signal }, () =>
          invalidateDirectory(
            workspaceId,
            workspaceVersion,
            relativeDirectory,
            record
          )
        ).on('error', () => {
          watchError = '部分目录无法自动监听，可点击顶部刷新'
          sendFilesEvent({
            type: 'watch-state',
            workspaceId,
            workspaceVersion,
            watchedDirectories: watchers.size,
            limited: unique.length > MAX_WATCHERS,
            error: watchError
          })
        })
        watchers.set(relativeDirectory, record)
      } catch {
        watchError = '部分目录无法自动监听，可点击顶部刷新'
      }
    }
    const state: WorkspaceWatchState = {
      workspaceId,
      workspaceVersion,
      watchedDirectories: watchers.size,
      limited: unique.length > MAX_WATCHERS
    }
    sendFilesEvent({
      type: 'watch-state',
      ...state,
      ...(watchError ? { error: watchError } : {})
    })
    return state
  }

  const onRuntimeEvent = (event: Record<string, unknown>): void => {
    const toolCallId =
      typeof event['toolCallId'] === 'string'
        ? event['toolCallId']
        : typeof event['id'] === 'string'
          ? event['id']
          : undefined
    const toolName =
      typeof event['toolName'] === 'string'
        ? event['toolName'].toLocaleLowerCase()
        : undefined
    const knownWriteTool =
      toolName !== undefined &&
      new Set(['write', 'write_file', 'edit', 'edit_file', 'apply_patch']).has(
        toolName
      )
    const args =
      typeof event['args'] === 'object' &&
      event['args'] !== null &&
      !Array.isArray(event['args'])
        ? (event['args'] as Record<string, unknown>)
        : {}
    const values = [
      args['path'],
      args['filePath'],
      args['file_path'],
      ...(Array.isArray(args['paths']) ? args['paths'] : [])
    ].filter((value): value is string => typeof value === 'string')
    if (event['type'] === 'tool_execution_start') {
      if (toolCallId && knownWriteTool) pendingToolPaths.set(toolCallId, values)
      return
    }
    if (event['type'] !== 'tool_execution_end') return
    const stored = toolCallId ? pendingToolPaths.get(toolCallId) : undefined
    if (toolCallId) pendingToolPaths.delete(toolCallId)
    if (event['isError'] === true || (!knownWriteTool && !stored)) return
    const paths = values.length > 0 ? values : (stored ?? [])
    const workspaceId = activeWatcherWorkspace
    if (!workspaceId) return
    const workspace = (() => {
      try {
        return stateStore.requireWorkspace(workspaceId)
      } catch {
        return undefined
      }
    })()
    if (!workspace) return
    const version = workspaceVersions.get(workspaceId) ?? 1
    for (const value of paths) {
      const absolute = isAbsolute(value)
        ? resolve(value)
        : resolve(workspace.path, value)
      if (!isWithin(workspace.path, absolute)) continue
      const directory = normalizeRelativePath(
        relative(workspace.path, resolve(absolute, '..'))
      )
      const record = watchers.get(directory) ?? {
        controller: new AbortController(),
        lastRefreshAt: 0
      }
      invalidateDirectory(workspaceId, version, directory, record)
    }
  }
  runtimeEvents?.on('event', onRuntimeEvent)

  ipcMain.handle(
    IPC_CHANNELS.listWorkspaceEntries,
    async (
      event,
      workspaceId: unknown,
      relativeDirectory: unknown,
      offset: unknown,
      revision: unknown,
      priority: unknown
    ) => {
      const startedAt = performance.now()
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        const version = workspaceVersions.get(workspace.id) ?? 1
        workspaceVersions.set(workspace.id, version)
        const directoryRevisions =
          revisions.get(workspace.id) ?? new Map<string, number>()
        revisions.set(workspace.id, directoryRevisions)
        const result = await listEntries(
          worker,
          workspace.path,
          relativeDirectory,
          offset,
          revision,
          version,
          directoryRevisions,
          priority
        )
        log.debug('workspace_files_list', {
          workspaceId: workspace.id,
          relativePath:
            typeof relativeDirectory === 'string' ? relativeDirectory : '',
          count: result.entries.length,
          elapsedMs: Math.round(performance.now() - startedAt),
          source: priority === 'background' ? 'automatic' : 'interactive'
        })
        return success(result)
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.searchWorkspaceEntries,
    async (event, workspaceId: unknown, query: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        if (typeof query !== 'string') {
          throw new WorkspaceFileError('INVALID_ARGUMENT', '文件搜索内容无效')
        }
        searchController?.abort()
        searchController = new AbortController()
        const version = workspaceVersions.get(workspace.id) ?? 1
        return success(
          await searchWorkspace(
            workspace.path,
            query,
            version,
            searchController.signal
          )
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return success({
            entries: [],
            truncated: false,
            workspaceVersion:
              typeof workspaceId === 'string'
                ? (workspaceVersions.get(workspaceId) ?? 1)
                : 1
          })
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.watchWorkspaceDirectories,
    async (event, workspaceId: unknown, relativeDirectories: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        return success(
          await watchDirectories(
            workspace.id,
            workspace.path,
            relativeDirectories
          )
        )
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refreshWorkspaceDirectories,
    async (event, workspaceId: unknown, relativeDirectories: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        if (
          !Array.isArray(relativeDirectories) ||
          !relativeDirectories.every((item) => typeof item === 'string')
        ) {
          throw new WorkspaceFileError('INVALID_ARGUMENT', '刷新目录列表无效')
        }
        const directoryRevisions =
          revisions.get(workspace.id) ?? new Map<string, number>()
        revisions.set(workspace.id, directoryRevisions)
        const root = await workspaceRoot(workspace.path)
        const requested = [
          ...new Set(relativeDirectories.map(normalizeRelativePath))
        ]
        await Promise.all(
          requested.map((relativeDirectory) =>
            resolveDirectory(root, relativeDirectory)
          )
        )
        worker.restart?.()
        const refreshed: Record<string, number> = {}
        for (const relativeDirectory of requested) {
          const revision = (directoryRevisions.get(relativeDirectory) ?? 1) + 1
          directoryRevisions.set(relativeDirectory, revision)
          refreshed[relativeDirectory] = revision
        }
        const result: WorkspaceRefreshState = {
          workspaceVersion: workspaceVersions.get(workspace.id) ?? 1,
          revisions: refreshed
        }
        return success(result)
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.openWorkspaceEntry,
    async (event, workspaceId: unknown, relativePath: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        if (
          typeof relativePath !== 'string' ||
          relativePath.includes('\0') ||
          isAbsolute(relativePath)
        ) {
          throw new WorkspaceFileError('INVALID_ARGUMENT', '文件路径无效')
        }
        const root = await workspaceRoot(workspace.path)
        const lexical = resolve(root, relativePath)
        if (!isWithin(root, lexical)) {
          throw new WorkspaceFileError(
            'INVALID_ARGUMENT',
            '文件路径超出当前 Workspace'
          )
        }
        const entry = await stat(lexical).catch(() => null)
        if (!entry) {
          throw new WorkspaceFileError('INVALID_ARGUMENT', '文件路径不存在')
        }
        if (entry.isDirectory()) {
          const error = await shell.openPath(lexical)
          if (error) throw new Error(error)
        } else {
          shell.showItemInFolder(lexical)
        }
        return success(true)
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
  ipcMain.handle(
    IPC_CHANNELS.resolveWorkspaceReferences,
    async (event, workspaceId: unknown, references: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(stateStore, workspaceId)
        return success(
          await resolveWorkspaceReferences(workspace.path, references)
        )
      } catch (error) {
        return failure(error)
      }
    }
  )
  return () => {
    runtimeEvents?.off('event', onRuntimeEvent)
    searchController?.abort()
    clearWatchers()
    worker.close()
    ipcMain.removeHandler(IPC_CHANNELS.listWorkspaceEntries)
    ipcMain.removeHandler(IPC_CHANNELS.searchWorkspaceEntries)
    ipcMain.removeHandler(IPC_CHANNELS.watchWorkspaceDirectories)
    ipcMain.removeHandler(IPC_CHANNELS.refreshWorkspaceDirectories)
    ipcMain.removeHandler(IPC_CHANNELS.openWorkspaceEntry)
    ipcMain.removeHandler(IPC_CHANNELS.resolveDroppedPaths)
    ipcMain.removeHandler(IPC_CHANNELS.resolveWorkspaceReferences)
  }
}
