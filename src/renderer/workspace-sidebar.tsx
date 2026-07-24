import {
  Archive,
  Folder,
  LoaderCircle,
  MessageSquare,
  Pin,
  Plus,
  Search
} from 'lucide-react'
import { useState } from 'react'
import type {
  RuntimeSnapshot,
  SessionSummary,
  WorkspaceOverview
} from '../shared/desktop-api'

type MenuTarget =
  | { kind: 'workspace'; id: string; pinned: boolean }
  | {
      kind: 'session'
      id: string
      pinned: boolean
      archived: boolean
      title: string
    }

function groupSessions(
  sessions: SessionSummary[],
  runtime: RuntimeSnapshot
): Array<{ title: string; sessions: SessionSummary[]; archived?: boolean }> {
  const running = sessions.filter(
    (session) => session.id === runtime.sessionId && !session.archived
  )
  const pinned = sessions.filter(
    (session) =>
      session.pinned && !session.archived && session.id !== runtime.sessionId
  )
  const ordinary = sessions.filter(
    (session) =>
      !session.pinned && !session.archived && session.id !== runtime.sessionId
  )
  const archived = sessions.filter((session) => session.archived)
  return [
    { title: '正在运行', sessions: running },
    { title: '已置顶', sessions: pinned },
    { title: '会话', sessions: ordinary },
    { title: '已归档', sessions: archived, archived: true }
  ]
}

export function WorkspaceSidebar({
  runtime,
  overview,
  sessions,
  search,
  error,
  archivedExpanded,
  onArchivedExpanded,
  onOpenWorkspace,
  onNewSession,
  onSearch,
  onActivateWorkspace,
  onSwitchSession,
  onPinWorkspace,
  onPinSession,
  onArchiveSession,
  onRenameSession,
  onDeleteSession,
  onLoadMoreSessions,
  hasMoreSessions,
  onLoadMoreWorkspaces,
  openingWorkspace
}: {
  runtime: RuntimeSnapshot
  overview: WorkspaceOverview
  sessions: SessionSummary[]
  search: string
  error: string | null
  archivedExpanded: boolean
  onArchivedExpanded: (expanded: boolean) => void
  onOpenWorkspace: () => void
  onNewSession: () => void
  onSearch: (query: string) => void
  onActivateWorkspace: (id: string) => void
  onSwitchSession: (id: string) => void
  onPinWorkspace: (id: string, pinned: boolean) => void
  onPinSession: (id: string, pinned: boolean) => void
  onArchiveSession: (id: string, archived: boolean) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onLoadMoreSessions: () => void
  hasMoreSessions: boolean
  onLoadMoreWorkspaces: () => void
  openingWorkspace: boolean
}): React.JSX.Element {
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const activeWorkspace = overview.workspaces.find(
    (workspace) => workspace.id === overview.activeWorkspaceId
  )
  const openMenu = (
    event: React.MouseEvent | React.KeyboardEvent,
    target: MenuTarget
  ): void => {
    event.preventDefault()
    setMenu(target)
  }
  return (
    <aside
      className="panel-surface relative flex h-full min-w-0 flex-col"
      data-slot="conversation-sidebar"
      onClick={() => setMenu(null)}
    >
      <div className="flex h-16 items-center justify-between px-5">
        <h1 className="text-[15px] font-semibold">对话</h1>
        <button
          aria-label="新建对话"
          className="inline-grid size-8 place-items-center rounded-lg"
          disabled={!activeWorkspace || runtime.status !== 'ready'}
          onClick={(event) => {
            event.stopPropagation()
            onNewSession()
          }}
          type="button"
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Workspace
          </span>
          <button
            aria-label={
              openingWorkspace ? '正在打开目录选择器' : '打开 Workspace'
            }
            className="inline-grid size-8 place-items-center rounded-lg"
            disabled={openingWorkspace || runtime.status === 'starting'}
            onClick={(event) => {
              event.stopPropagation()
              onOpenWorkspace()
            }}
            type="button"
          >
            {openingWorkspace ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <Plus size={15} />
            )}
          </button>
        </div>
        {openingWorkspace && (
          <p
            className="mb-2 px-2 text-[11px] text-[var(--text-muted)]"
            role="status"
          >
            正在打开目录选择器…
          </p>
        )}
        {overview.workspaces.length === 0 ? (
          <div className="empty-card mt-2" data-slot="workspace-empty-state">
            <Folder size={20} strokeWidth={1.6} />
            <p className="mt-3 text-sm font-medium">尚未打开 Workspace</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              选择一个本地目录后开始。
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {overview.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <button
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                    workspace.id === overview.activeWorkspaceId
                      ? 'bg-[var(--surface-selected)]'
                      : ''
                  }`}
                  disabled={
                    runtime.status === 'starting' ||
                    runtime.status === 'stopping'
                  }
                  onClick={() => onActivateWorkspace(workspace.id)}
                  onContextMenu={(event) =>
                    openMenu(event, {
                      kind: 'workspace',
                      id: workspace.id,
                      pinned: workspace.pinned
                    })
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ContextMenu' ||
                      (event.shiftKey && event.key === 'F10')
                    )
                      openMenu(event, {
                        kind: 'workspace',
                        id: workspace.id,
                        pinned: workspace.pinned
                      })
                  }}
                  type="button"
                >
                  <Folder size={15} />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.pinned && <Pin className="ml-auto" size={12} />}
                  {!workspace.available && (
                    <span className="ml-auto text-[10px] text-red-600">
                      不可用
                    </span>
                  )}
                </button>
              </li>
            ))}
            {overview.hasMore && (
              <li>
                <button
                  className="w-full rounded-lg py-2 text-xs text-[var(--text-secondary)]"
                  onClick={onLoadMoreWorkspaces}
                  type="button"
                >
                  更多 Workspace
                </button>
              </li>
            )}
          </ul>
        )}
        {activeWorkspace && (
          <>
            <label className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-xs">
              <Search size={14} />
              <input
                aria-label="搜索会话"
                className="min-w-0 flex-1 outline-none"
                onChange={(event) => onSearch(event.target.value)}
                placeholder="搜索会话"
                value={search}
              />
            </label>
            {groupSessions(sessions, runtime).map((group) => {
              if (group.sessions.length === 0) return null
              const hidden = group.archived && !archivedExpanded
              return (
                <section className="mt-5" key={group.title}>
                  <button
                    className="mb-1 flex w-full items-center gap-1 px-2 text-[11px] font-medium text-[var(--text-muted)]"
                    disabled={!group.archived}
                    onClick={() =>
                      group.archived && onArchivedExpanded(!archivedExpanded)
                    }
                    type="button"
                  >
                    {group.archived && <Archive size={12} />}
                    {group.title}
                  </button>
                  {!hidden && (
                    <ul className="space-y-1">
                      {group.sessions.map((session) => (
                        <li key={session.id}>
                          <button
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                              session.id === runtime.sessionId
                                ? 'bg-[var(--surface-selected)]'
                                : ''
                            }`}
                            disabled={
                              session.compatibility === 'corrupt' ||
                              session.compatibility === 'future'
                            }
                            onClick={() => onSwitchSession(session.id)}
                            onContextMenu={(event) =>
                              openMenu(event, {
                                kind: 'session',
                                id: session.id,
                                pinned: session.pinned,
                                archived: session.archived,
                                title: session.title
                              })
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === 'ContextMenu' ||
                                (event.shiftKey && event.key === 'F10')
                              )
                                openMenu(event, {
                                  kind: 'session',
                                  id: session.id,
                                  pinned: session.pinned,
                                  archived: session.archived,
                                  title: session.title
                                })
                            }}
                            title={session.path}
                            type="button"
                          >
                            <MessageSquare size={14} />
                            <span className="truncate">{session.title}</span>
                            {session.pinned && (
                              <Pin className="ml-auto" size={11} />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
            {hasMoreSessions && (
              <button
                className="mt-3 w-full rounded-lg py-2 text-xs text-[var(--text-secondary)]"
                onClick={onLoadMoreSessions}
                type="button"
              >
                更多
              </button>
            )}
          </>
        )}
        {error && <p className="mt-3 px-2 text-xs text-red-600">{error}</p>}
      </div>
      {menu && (
        <div
          className="absolute top-24 right-3 z-30 min-w-36 rounded-lg border border-[var(--border)] bg-white p-1 text-xs shadow-lg"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full rounded px-3 py-2 text-left hover:bg-[var(--surface-selected)]"
            onClick={() => {
              if (menu.kind === 'workspace')
                onPinWorkspace(menu.id, !menu.pinned)
              else onPinSession(menu.id, !menu.pinned)
              setMenu(null)
            }}
            role="menuitem"
            type="button"
          >
            {menu.pinned ? '取消置顶' : '置顶'}
          </button>
          {menu.kind === 'session' && (
            <>
              <button
                className="w-full rounded px-3 py-2 text-left hover:bg-[var(--surface-selected)]"
                onClick={() => {
                  onArchiveSession(menu.id, !menu.archived)
                  setMenu(null)
                }}
                role="menuitem"
                type="button"
              >
                {menu.archived ? '取消归档' : '归档'}
              </button>
              <button
                className="w-full rounded px-3 py-2 text-left hover:bg-[var(--surface-selected)]"
                onClick={() => {
                  const title = window.prompt('会话名称', menu.title)
                  if (title) onRenameSession(menu.id, title)
                  setMenu(null)
                }}
                role="menuitem"
                type="button"
              >
                重命名
              </button>
              <button
                className="w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"
                onClick={() => {
                  if (window.confirm('将此会话移入系统废纸篓？'))
                    onDeleteSession(menu.id)
                  setMenu(null)
                }}
                role="menuitem"
                type="button"
              >
                删除
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
