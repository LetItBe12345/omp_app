import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  RefreshCw
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ContextReference, WorkspaceEntry } from '../shared/desktop-api'
import { CONTEXT_REFERENCE_MIME } from './context-drag'

function referenceFromEntry(entry: WorkspaceEntry): ContextReference {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    relativePath: entry.relativePath
  }
}

function WorkspaceTreeNode({
  entry,
  workspaceId,
  depth
}: {
  entry: WorkspaceEntry
  workspaceId: string
  depth: number
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (): Promise<void> => {
    if (entry.kind !== 'folder' || !entry.expandable || loading) return
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (children) return
    setLoading(true)
    setError(null)
    const result = await window.desktop.listWorkspaceEntries(
      workspaceId,
      entry.relativePath
    )
    if (result.ok) {
      setChildren(result.data.entries)
      setTruncated(result.data.truncated)
    } else {
      setExpanded(false)
      setError(result.error.message)
    }
    setLoading(false)
  }

  return (
    <li>
      <button
        aria-expanded={entry.kind === 'folder' ? expanded : undefined}
        className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs hover:bg-[var(--surface-selected)]"
        draggable
        onClick={() => void toggle()}
        onDragStart={(event) => {
          const reference = referenceFromEntry(entry)
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(
            CONTEXT_REFERENCE_MIME,
            JSON.stringify(reference)
          )
          event.dataTransfer.setData('text/plain', `@${entry.relativePath}`)
        }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={entry.relativePath}
        type="button"
      >
        <span className="grid size-3.5 shrink-0 place-items-center text-[var(--text-muted)]">
          {entry.kind === 'folder' && entry.expandable ? (
            expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : null}
        </span>
        {entry.kind === 'folder' ? <Folder size={14} /> : <File size={14} />}
        <span className="truncate">{entry.name}</span>
        {loading && (
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">
            读取中
          </span>
        )}
      </button>
      {error && (
        <p className="px-3 py-1 text-[10px] text-red-600" role="alert">
          {error}
        </p>
      )}
      {expanded && children && (
        <ul>
          {children.map((child) => (
            <WorkspaceTreeNode
              depth={depth + 1}
              entry={child}
              key={child.id}
              workspaceId={workspaceId}
            />
          ))}
          {children.length === 0 && (
            <li
              className="py-1 text-[10px] text-[var(--text-muted)]"
              style={{ paddingLeft: `${36 + depth * 14}px` }}
            >
              空目录
            </li>
          )}
          {truncated && (
            <li
              className="py-1 text-[10px] text-[var(--text-muted)]"
              style={{ paddingLeft: `${36 + depth * 14}px` }}
            >
              仅显示前 500 项
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function WorkspaceFileTree({
  workspaceId
}: {
  workspaceId: string
}): React.JSX.Element {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const result = await window.desktop.listWorkspaceEntries(workspaceId)
    if (result.ok) {
      setEntries(result.data.entries)
      setTruncated(result.data.truncated)
    } else {
      setEntries([])
      setTruncated(false)
      setError(result.error.message)
    }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  return (
    <aside
      className="panel-surface flex h-full min-w-0 flex-col"
      data-slot="file-tree"
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <h2 className="text-[15px] font-semibold">文件</h2>
        <button
          aria-label="刷新文件树"
          className="inline-grid size-8 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-selected)] disabled:opacity-45"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error ? (
          <div className="empty-card mx-1 mt-2" role="alert">
            <p className="text-xs">{error}</p>
          </div>
        ) : loading && entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
            正在读取文件…
          </p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[var(--text-muted)]">目录为空</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <WorkspaceTreeNode
                depth={0}
                entry={entry}
                key={entry.id}
                workspaceId={workspaceId}
              />
            ))}
          </ul>
        )}
        {truncated && (
          <p className="px-3 py-2 text-[10px] text-[var(--text-muted)]">
            当前目录仅显示前 500 项
          </p>
        )}
      </div>
    </aside>
  )
}
