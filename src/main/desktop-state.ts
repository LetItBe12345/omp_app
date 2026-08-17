import { randomUUID } from 'node:crypto'
import {
  chmod,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  ApprovalMode,
  RuntimeNetworkConfig,
  SessionSummary,
  WorkspaceOverview,
  WorkspaceSummary
} from '../shared/desktop-api'
import { isApprovalMode } from '../shared/approval-mode'

export type StoredWorkspace = {
  id: string
  path: string
  addedAt: string
  lastUsedAt: string
  pinned: boolean
  activeSessionId?: string
}

export type SessionPreference = {
  pinned?: boolean
  archived?: boolean
  approvalMode?: ApprovalMode
  network?: RuntimeNetworkConfig
  unreadCompletion?: boolean
}

export type DesktopState = {
  version: 1
  activeWorkspaceId?: string
  workspaces: StoredWorkspace[]
  sessionPreferences: Record<string, Record<string, SessionPreference>>
  ui: Record<string, unknown>
}

const emptyState = (): DesktopState => ({
  version: 1,
  workspaces: [],
  sessionPreferences: {},
  ui: {}
})

function isRuntimeNetworkConfig(value: unknown): value is RuntimeNetworkConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    record['mode'] !== 'off' &&
    record['mode'] !== 'auto' &&
    record['mode'] !== 'manual'
  )
    return false
  return (
    record['mode'] !== 'manual' ||
    (typeof record['manualPort'] === 'number' &&
      Number.isInteger(record['manualPort']) &&
      record['manualPort'] >= 1 &&
      record['manualPort'] <= 65_535)
  )
}

function parseState(value: unknown): DesktopState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return emptyState()
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return emptyState()
  const workspaces = Array.isArray(record['workspaces'])
    ? record['workspaces'].flatMap((value): StoredWorkspace[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return []
        const item = value as Record<string, unknown>
        if (
          typeof item['id'] !== 'string' ||
          typeof item['path'] !== 'string' ||
          typeof item['addedAt'] !== 'string' ||
          typeof item['lastUsedAt'] !== 'string'
        )
          return []
        return [
          {
            id: item['id'],
            path: item['path'],
            addedAt: item['addedAt'],
            lastUsedAt: item['lastUsedAt'],
            pinned: item['pinned'] === true,
            ...(typeof item['activeSessionId'] === 'string'
              ? { activeSessionId: item['activeSessionId'] }
              : {})
          }
        ]
      })
    : []
  const sessionPreferences =
    record['sessionPreferences'] &&
    typeof record['sessionPreferences'] === 'object' &&
    !Array.isArray(record['sessionPreferences'])
      ? (record['sessionPreferences'] as DesktopState['sessionPreferences'])
      : {}
  return {
    version: 1,
    ...(typeof record['activeWorkspaceId'] === 'string'
      ? { activeWorkspaceId: record['activeWorkspaceId'] }
      : {}),
    workspaces,
    sessionPreferences,
    ui:
      record['ui'] &&
      typeof record['ui'] === 'object' &&
      !Array.isArray(record['ui'])
        ? (record['ui'] as Record<string, unknown>)
        : {}
  }
}

export class DesktopStateStore {
  readonly #path: string
  readonly #legacyPath?: string
  #state: DesktopState = emptyState()
  #writeQueue = Promise.resolve()

  constructor(path: string, legacyPath?: string) {
    this.#path = path
    this.#legacyPath = legacyPath
  }

  get state(): DesktopState {
    return structuredClone(this.#state)
  }

  async load(): Promise<DesktopState> {
    const current = await readFile(this.#path, 'utf8')
      .then((value) => parseState(JSON.parse(value) as unknown))
      .catch(() => null)
    if (current) {
      this.#state = current
      return this.state
    }
    await this.#migrateLegacy()
    return this.state
  }

  async addWorkspace(path: string): Promise<StoredWorkspace> {
    const canonicalPath = await realpath(path)
    const existing = this.#state.workspaces.find(
      (workspace) => workspace.path === canonicalPath
    )
    const now = new Date().toISOString()
    if (existing) {
      return this.#commit(() => {
        existing.lastUsedAt = now
        this.#state.activeWorkspaceId = existing.id
        return structuredClone(existing)
      })
    }
    const workspace: StoredWorkspace = {
      id: randomUUID(),
      path: canonicalPath,
      addedAt: now,
      lastUsedAt: now,
      pinned: false
    }
    return this.#commit(() => {
      this.#state.workspaces.push(workspace)
      this.#state.activeWorkspaceId = workspace.id
      return structuredClone(workspace)
    })
  }

  async activateWorkspace(id: string): Promise<StoredWorkspace> {
    const workspace = this.requireWorkspace(id)
    return this.#commit(() => {
      workspace.lastUsedAt = new Date().toISOString()
      this.#state.activeWorkspaceId = id
      return structuredClone(workspace)
    })
  }

  async setWorkspacePinned(id: string, pinned: boolean): Promise<void> {
    await this.#commit(() => {
      this.requireWorkspace(id).pinned = pinned
    })
  }

  async setActiveSession(
    workspaceId: string,
    sessionId: string | undefined
  ): Promise<void> {
    await this.#commit(() => {
      const workspace = this.requireWorkspace(workspaceId)
      workspace.activeSessionId = sessionId
      workspace.lastUsedAt = new Date().toISOString()
    })
  }

  async clearActiveSessionIfMatches(
    workspaceId: string,
    sessionId: string
  ): Promise<boolean> {
    return this.#commit(() => {
      const workspace = this.requireWorkspace(workspaceId)
      if (workspace.activeSessionId !== sessionId) return false
      workspace.activeSessionId = undefined
      return true
    })
  }

  async removeWorkspace(id: string): Promise<void> {
    await this.#commit(() => {
      this.requireWorkspace(id)
      this.#state.workspaces = this.#state.workspaces.filter(
        (workspace) => workspace.id !== id
      )
      delete this.#state.sessionPreferences[id]
      if (this.#state.activeWorkspaceId === id)
        this.#state.activeWorkspaceId = undefined
    })
  }

  runtimeNetworkConfig(): RuntimeNetworkConfig {
    const value = this.#state.ui['runtimeNetwork']
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { mode: 'auto' }
    const record = value as Record<string, unknown>
    const mode =
      record['mode'] === 'off' ||
      record['mode'] === 'auto' ||
      record['mode'] === 'manual'
        ? record['mode']
        : 'auto'
    const manualPort =
      typeof record['manualPort'] === 'number' &&
      Number.isInteger(record['manualPort']) &&
      record['manualPort'] >= 1 &&
      record['manualPort'] <= 65_535
        ? record['manualPort']
        : undefined
    return { mode, ...(manualPort ? { manualPort } : {}) }
  }

  async setRuntimeNetworkConfig(config: RuntimeNetworkConfig): Promise<void> {
    await this.#commit(() => {
      this.#state.ui['runtimeNetwork'] = { ...config }
    })
  }

  sessionNetworkMigrationBaseline(): RuntimeNetworkConfig {
    const value = this.#state.ui['sessionNetworkMigrationBaseline']
    return isRuntimeNetworkConfig(value) ? value : this.runtimeNetworkConfig()
  }

  async ensureSessionNetworkMigrationBaseline(): Promise<void> {
    if (
      this.#state.ui['sessionNetworkConfigVersion'] === 1 &&
      isRuntimeNetworkConfig(this.#state.ui['sessionNetworkMigrationBaseline'])
    )
      return
    await this.#commit(() => {
      this.#state.ui['sessionNetworkConfigVersion'] = 1
      this.#state.ui['sessionNetworkMigrationBaseline'] = {
        ...this.runtimeNetworkConfig()
      }
    })
  }

  maxParallelSessions(): number {
    const value = this.#state.ui['maxParallelSessions']
    return typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 10
      ? value
      : 5
  }

  async setMaxParallelSessions(value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 1 || value > 10)
      throw new Error('最大并行数量必须是 1–10 的整数')
    await this.#commit(() => {
      this.#state.ui['maxParallelSessions'] = value
    })
  }

  sessionPreference(workspaceId: string, sessionId: string): SessionPreference {
    const preference =
      this.#state.sessionPreferences[workspaceId]?.[sessionId] ?? {}
    return {
      ...(typeof preference.pinned === 'boolean'
        ? { pinned: preference.pinned }
        : {}),
      ...(typeof preference.archived === 'boolean'
        ? { archived: preference.archived }
        : {}),
      ...(isApprovalMode(preference.approvalMode)
        ? { approvalMode: preference.approvalMode }
        : {}),
      ...(isRuntimeNetworkConfig(preference.network)
        ? { network: preference.network }
        : {}),
      ...(typeof preference.unreadCompletion === 'boolean'
        ? { unreadCompletion: preference.unreadCompletion }
        : {})
    }
  }

  async updateSessionPreference(
    workspaceId: string,
    sessionId: string,
    patch: SessionPreference
  ): Promise<void> {
    await this.#commit(() => {
      this.requireWorkspace(workspaceId)
      const workspace =
        this.#state.sessionPreferences[workspaceId] ??
        (this.#state.sessionPreferences[workspaceId] = {})
      const current = workspace[sessionId] ?? {}
      workspace[sessionId] = { ...current, ...patch }
    })
  }

  async removeSessionPreference(
    workspaceId: string,
    sessionId: string
  ): Promise<void> {
    await this.#commit(() => {
      delete this.#state.sessionPreferences[workspaceId]?.[sessionId]
      const workspace = this.#state.workspaces.find(
        (item) => item.id === workspaceId
      )
      if (workspace?.activeSessionId === sessionId)
        workspace.activeSessionId = undefined
    })
  }

  requireWorkspace(id: string): StoredWorkspace {
    const workspace = this.#state.workspaces.find((item) => item.id === id)
    if (!workspace) throw new Error('Workspace 不存在')
    return workspace
  }

  overview(
    availability: Map<string, boolean>,
    offset = 0,
    now = Date.now()
  ): WorkspaceOverview {
    const recentBoundary = now - 7 * 24 * 60 * 60 * 1000
    const ordered = [...this.#state.workspaces].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return Date.parse(b.addedAt) - Date.parse(a.addedAt)
    })
    const initiallyVisible = ordered.filter(
      (item) =>
        item.id === this.#state.activeWorkspaceId ||
        item.pinned ||
        Date.parse(item.lastUsedAt) >= recentBoundary
    )
    const older = ordered.filter((item) => !initiallyVisible.includes(item))
    const selected =
      offset === 0
        ? initiallyVisible
        : [...initiallyVisible, ...older.slice(0, offset)]
    return {
      ...(this.#state.activeWorkspaceId
        ? { activeWorkspaceId: this.#state.activeWorkspaceId }
        : {}),
      workspaces: selected.map((item): WorkspaceSummary => ({
        ...item,
        name: basename(item.path),
        available: availability.get(item.id) ?? false,
        unreadCompletion: Object.values(
          this.#state.sessionPreferences[item.id] ?? {}
        ).some((preference) => preference.unreadCompletion === true)
      })),
      hasMore: older.length > offset
    }
  }

  applyPreferences(
    workspaceId: string,
    session: Omit<SessionSummary, 'pinned' | 'archived'>
  ): SessionSummary {
    const preference = this.sessionPreference(workspaceId, session.id)
    return {
      ...session,
      pinned: preference.pinned === true && preference.archived !== true,
      archived: preference.archived === true,
      unreadCompletion: preference.unreadCompletion === true
    }
  }

  async #migrateLegacy(): Promise<void> {
    if (!this.#legacyPath) return
    const legacy = await readFile(this.#legacyPath, 'utf8')
      .then((value) => JSON.parse(value) as Record<string, unknown>)
      .catch(() => null)
    if (!legacy || typeof legacy['workspacePath'] !== 'string') return
    try {
      await this.addWorkspace(legacy['workspacePath'])
    } catch {
      // 旧路径失效时不阻止应用启动。
    }
  }

  async #commit<T>(mutation: () => T): Promise<T> {
    const previous = structuredClone(this.#state)
    const result = mutation()
    try {
      await this.#persist()
      return result
    } catch (error) {
      this.#state = previous
      throw error
    }
  }

  async #persist(): Promise<void> {
    const serialized = JSON.stringify(this.#state, null, 2)
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const directory = dirname(this.#path)
        const temporary = join(
          directory,
          `.desktop-state.${process.pid}.${randomUUID()}.tmp`
        )
        const handle = await open(temporary, 'w', 0o600)
        try {
          await handle.writeFile(serialized, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        try {
          await chmod(temporary, 0o600)
          await rename(temporary, this.#path)
          const directoryHandle = await open(directory, 'r')
          try {
            await directoryHandle.sync()
          } finally {
            await directoryHandle.close()
          }
        } catch (error) {
          await unlink(temporary).catch(() => undefined)
          throw error
        }
      })
    await this.#writeQueue
  }
}
