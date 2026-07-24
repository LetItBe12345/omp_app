import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Link,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ContextReference,
  WorkspaceEntry,
  WorkspaceFilesEvent
} from '../shared/desktop-api'
import { CONTEXT_REFERENCE_MIME } from './context-drag'

const ROW_HEIGHT = 30
const workspaceTreeMemory = new Map<
  string,
  { expanded: Set<string>; scrollTop: number }
>()

type DirectoryState = {
  entries: WorkspaceEntry[]
  hasMore: boolean
  revision?: number
  loading: boolean
  error?: string
}

type TreeRow =
  | { type: 'root'; id: 'root'; depth: 0 }
  | {
      type: 'entry'
      id: string
      entry: WorkspaceEntry
      depth: number
      parent: string
    }
  | { type: 'more'; id: string; directory: string; depth: number }
  | { type: 'status'; id: string; text: string; depth: number }

function referenceFromEntry(entry: WorkspaceEntry): ContextReference {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    relativePath: entry.relativePath
  }
}

function flattenRows(
  rootName: string,
  directories: Map<string, DirectoryState>,
  expanded: Set<string>
): TreeRow[] {
  const rows: TreeRow[] = [{ type: 'root', id: 'root', depth: 0 }]
  if (!expanded.has('')) return rows
  const append = (directory: string, depth: number): void => {
    const state = directories.get(directory)
    if (!state) {
      rows.push({
        type: 'status',
        id: `loading:${directory || rootName}`,
        text: '正在读取…',
        depth
      })
      return
    }
    for (const entry of state.entries) {
      rows.push({
        type: 'entry',
        id: entry.id,
        entry,
        depth,
        parent: directory
      })
      if (
        entry.kind === 'folder' &&
        entry.expandable &&
        expanded.has(entry.relativePath)
      ) {
        append(entry.relativePath, depth + 1)
      }
    }
    if (state.error) {
      rows.push({
        type: 'status',
        id: `error:${directory || rootName}`,
        text: state.error,
        depth
      })
    } else if (!state.loading && state.entries.length === 0) {
      rows.push({
        type: 'status',
        id: `empty:${directory || rootName}`,
        text: '空目录',
        depth
      })
    }
    if (state.hasMore) {
      rows.push({
        type: 'more',
        id: `more:${directory}`,
        directory,
        depth
      })
    }
  }
  append('', 1)
  return rows
}

function linkTitle(entry: WorkspaceEntry): string | undefined {
  if (!entry.symbolicLink) return undefined
  if (entry.linkStatus === 'external') return '符号链接指向 Workspace 外'
  if (entry.linkStatus === 'broken') return '符号链接目标不存在'
  if (entry.linkStatus === 'cycle') return '符号链接形成目录循环'
  return 'Workspace 内符号链接'
}

export function WorkspaceFileTree({
  workspaceId,
  workspaceName,
  workspacePath,
  onAddReference
}: {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  onAddReference: (reference: ContextReference) => Promise<string | undefined>
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<TreeRow[]>([])
  const lastScrollAt = useRef(0)
  const expandedRef = useRef(new Set(['']))
  const scrollTopRef = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const requestGeneration = useRef(new Map<string, number>())
  const workspaceVersion = useRef<number | undefined>(undefined)
  const [directories, setDirectories] = useState(
    () => new Map<string, DirectoryState>()
  )
  const [expanded, setExpanded] = useState(
    () => workspaceTreeMemory.get(workspaceId)?.expanded ?? new Set([''])
  )
  const [selectedId, setSelectedId] = useState('root')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchEntries, setSearchEntries] = useState<WorkspaceEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [menu, setMenu] = useState<{
    entry?: WorkspaceEntry
    root?: true
    x: number
    y: number
  }>()

  const loadDirectory = useCallback(
    async (
      relativeDirectory: string,
      targetCount = 100,
      priority: 'interactive' | 'background' = 'interactive'
    ): Promise<void> => {
      const scrollElement = scrollRef.current
      const anchorIndex = scrollElement
        ? Math.floor(scrollElement.scrollTop / ROW_HEIGHT)
        : -1
      const anchor =
        anchorIndex >= 0
          ? {
              id: rowsRef.current[anchorIndex]?.id,
              offset: (scrollElement?.scrollTop ?? 0) - anchorIndex * ROW_HEIGHT
            }
          : undefined
      const generation =
        (requestGeneration.current.get(relativeDirectory) ?? 0) + 1
      requestGeneration.current.set(relativeDirectory, generation)
      setDirectories((current) => {
        const next = new Map(current)
        const previous = next.get(relativeDirectory)
        next.set(relativeDirectory, {
          entries: previous?.entries ?? [],
          hasMore: previous?.hasMore ?? false,
          revision: previous?.revision,
          loading: true
        })
        return next
      })
      if (anchor?.id && Date.now() - lastScrollAt.current > 150) {
        window.requestAnimationFrame(() => {
          const nextIndex = rowsRef.current.findIndex(
            (row) => row.id === anchor.id
          )
          if (nextIndex >= 0 && scrollRef.current) {
            scrollRef.current.scrollTop = nextIndex * ROW_HEIGHT + anchor.offset
          }
        })
      }
      const entries: WorkspaceEntry[] = []
      let revision: number | undefined
      let hasMore = true
      let error: string | undefined
      while (entries.length < targetCount && hasMore) {
        const result = await window.desktop.listWorkspaceEntries(
          workspaceId,
          relativeDirectory || undefined,
          entries.length,
          revision,
          priority
        )
        if (requestGeneration.current.get(relativeDirectory) !== generation)
          return
        if (!result.ok) {
          error = result.error.message
          break
        }
        if (
          workspaceVersion.current !== undefined &&
          result.data.workspaceVersion !== workspaceVersion.current
        )
          return
        workspaceVersion.current = result.data.workspaceVersion
        revision = result.data.revision
        entries.push(...result.data.entries)
        hasMore = result.data.hasMore
      }
      setDirectories((current) => {
        const next = new Map(current)
        const previous = next.get(relativeDirectory)
        next.set(relativeDirectory, {
          entries: error && previous ? previous.entries : entries,
          hasMore: error && previous ? previous.hasMore : hasMore,
          revision: error && previous ? previous.revision : revision,
          loading: false,
          ...(error ? { error } : {})
        })
        return next
      })
    },
    [workspaceId]
  )

  useEffect(() => {
    const memory = workspaceTreeMemory.get(workspaceId)
    workspaceVersion.current = undefined
    requestGeneration.current.clear()
    setDirectories(new Map())
    const restoredExpanded = new Set(memory?.expanded ?? [''])
    setExpanded(restoredExpanded)
    expandedRef.current = restoredExpanded
    scrollTopRef.current = memory?.scrollTop ?? 0
    setSelectedId('root')
    setQuery('')
    setSearchEntries([])
    queueMicrotask(() => {
      void loadDirectory('')
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTopRef.current
    })
    return () => {
      workspaceTreeMemory.set(workspaceId, {
        expanded: new Set(expandedRef.current),
        scrollTop: scrollTopRef.current
      })
    }
  }, [loadDirectory, workspaceId])

  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])

  const treeRows = useMemo(
    () => flattenRows(workspaceName, directories, expanded),
    [directories, expanded, workspaceName]
  )
  const rows = useMemo<TreeRow[]>(
    () =>
      query
        ? searchEntries.map((entry) => ({
            type: 'entry',
            id: entry.id,
            entry,
            depth: 0,
            parent: ''
          }))
        : treeRows,
    [query, searchEntries, treeRows]
  )
  useEffect(() => {
    if (!rows.some((row) => row.id === selectedId)) {
      const previousIndex = rowsRef.current.findIndex(
        (row) => row.id === selectedId
      )
      const fallback =
        rows[Math.min(Math.max(0, previousIndex), rows.length - 1)]
      if (fallback) setSelectedId(fallback.id)
    }
    rowsRef.current = rows
  }, [rows, selectedId])

  const watchedDirectories = useMemo(() => {
    if (query) return []
    return rows.flatMap((row) =>
      row.type === 'entry' &&
      row.entry.kind === 'folder' &&
      expanded.has(row.entry.relativePath)
        ? [row.entry.relativePath]
        : []
    )
  }, [expanded, query, rows])

  useEffect(() => {
    void window.desktop
      .watchWorkspaceDirectories(workspaceId, watchedDirectories)
      .then((result) => {
        if (!result.ok) {
          setNotice(result.error.message)
          return
        }
        workspaceVersion.current = result.data.workspaceVersion
        setNotice(
          result.data.limited ? '部分目录未自动监听，可点击顶部刷新' : undefined
        )
      })
  }, [watchedDirectories, workspaceId])

  useEffect(
    () =>
      window.desktop.onWorkspaceFilesEvent((event: WorkspaceFilesEvent) => {
        if (
          event.workspaceId !== workspaceId ||
          (workspaceVersion.current !== undefined &&
            event.workspaceVersion !== workspaceVersion.current)
        )
          return
        if (event.type === 'watch-state') {
          setNotice(
            event.error ??
              (event.limited ? '部分目录未自动监听，可点击顶部刷新' : undefined)
          )
          return
        }
        if (query) {
          void window.desktop
            .searchWorkspaceEntries(workspaceId, query)
            .then((result) => {
              if (
                result.ok &&
                result.data.workspaceVersion === workspaceVersion.current
              ) {
                setSearchEntries(result.data.entries)
                setSearchTruncated(result.data.truncated)
              }
            })
          return
        }
        const current = directories.get(event.relativeDirectory)
        if (current) {
          void loadDirectory(
            event.relativeDirectory,
            Math.max(100, current.entries.length),
            'background'
          )
        }
      }),
    [directories, loadDirectory, query, workspaceId]
  )

  useEffect(() => {
    if (!query.trim()) {
      queueMicrotask(() => {
        setSearchEntries([])
        setSearchTruncated(false)
        setSearching(false)
      })
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.desktop
        .searchWorkspaceEntries(workspaceId, query)
        .then((result) => {
          if (cancelled) return
          if (!result.ok) {
            setNotice(result.error.message)
            setSearchEntries([])
          } else if (
            workspaceVersion.current === undefined ||
            result.data.workspaceVersion === workspaceVersion.current
          ) {
            setSearchEntries(result.data.entries)
            setSearchTruncated(result.data.truncated)
          }
          setSearching(false)
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, workspaceId])

  // TanStack Virtual 自行维护滚动状态，不交给 React Compiler 缓存。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    initialRect: { height: 300, width: 300 },
    overscan: 6
  })
  const virtualRows =
    virtualizer.getVirtualItems().length > 0
      ? virtualizer.getVirtualItems()
      : rows.slice(0, 10).map((_row, index) => ({
          index,
          key: rows[index]?.id ?? index,
          start: index * ROW_HEIGHT,
          end: (index + 1) * ROW_HEIGHT,
          size: ROW_HEIGHT,
          lane: 0
        }))

  const toggleDirectory = (path: string): void => {
    const opening = !expanded.has(path)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(path)
      else next.delete(path)
      return next
    })
    if (opening) {
      const cached = directories.get(path)
      void loadDirectory(path, Math.max(100, cached?.entries.length ?? 0))
    }
  }

  const selectIndex = (index: number): void => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index))
    const row = rows[bounded]
    if (!row) return
    setSelectedId(row.id)
    virtualizer.scrollToIndex(bounded, { align: 'auto' })
    window.requestAnimationFrame(() => rowRefs.current.get(row.id)?.focus())
  }

  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedId)
  )

  const refreshAll = async (): Promise<void> => {
    if (manualRefreshing) return
    setManualRefreshing(true)
    if (query) {
      const result = await window.desktop.searchWorkspaceEntries(
        workspaceId,
        query
      )
      if (result.ok) {
        setSearchEntries(result.data.entries)
        setSearchTruncated(result.data.truncated)
      } else setNotice(result.error.message)
    } else {
      const paths = [...new Set(['', ...watchedDirectories])]
      const refresh = await window.desktop.refreshWorkspaceDirectories(
        workspaceId,
        paths
      )
      if (!refresh.ok) {
        setNotice(refresh.error.message)
        setManualRefreshing(false)
        return
      }
      workspaceVersion.current = refresh.data.workspaceVersion
      await Promise.all(
        paths.map((path) => {
          const count = directories.get(path)?.entries.length ?? 100
          return loadDirectory(path, Math.max(100, count))
        })
      )
    }
    setManualRefreshing(false)
  }

  const openMenu = (
    event: React.MouseEvent | React.KeyboardEvent,
    value: { entry?: WorkspaceEntry; root?: true }
  ): void => {
    event.preventDefault()
    setSelectedId(value.root ? 'root' : (value.entry?.id ?? selectedId))
    const target = event.currentTarget.getBoundingClientRect()
    setMenu({
      ...value,
      x: 'clientX' in event && event.clientX ? event.clientX : target.left + 24,
      y: 'clientY' in event && event.clientY ? event.clientY : target.bottom
    })
  }

  const addReference = async (entry?: WorkspaceEntry): Promise<void> => {
    const error = await onAddReference(
      entry
        ? referenceFromEntry(entry)
        : {
            id: 'folder:.',
            kind: 'folder',
            name: workspaceName,
            relativePath: '.'
          }
    )
    if (error) setNotice(error)
    setMenu(undefined)
    queueMicrotask(() => rowRefs.current.get(selectedId)?.focus())
  }

  const reveal = async (entry?: WorkspaceEntry): Promise<void> => {
    const result = await window.desktop.openWorkspaceEntry(
      workspaceId,
      entry?.relativePath ?? '.'
    )
    if (!result.ok) setNotice(result.error.message)
    setMenu(undefined)
    queueMicrotask(() => rowRefs.current.get(selectedId)?.focus())
  }

  return (
    <aside
      className="panel-surface relative flex h-full min-w-0 flex-col"
      data-slot="file-tree"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu) {
          event.preventDefault()
          setMenu(undefined)
        }
      }}
    >
      <div className="flex h-16 shrink-0 items-center gap-1 px-4">
        {searchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2">
            <Search size={13} />
            <input
              aria-label="搜索文件"
              autoFocus
              className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文件和目录"
              value={query}
            />
            <button
              aria-label="关闭文件搜索"
              onClick={() => {
                setQuery('')
                setSearchOpen(false)
              }}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <h2 className="mr-auto text-[15px] font-semibold">文件</h2>
            <button
              aria-label="搜索文件"
              className="inline-grid size-8 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-selected)]"
              onClick={() => setSearchOpen(true)}
              type="button"
            >
              <Search size={15} />
            </button>
          </>
        )}
        <button
          aria-label="刷新文件树"
          className="inline-grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-selected)]"
          onClick={() => void refreshAll()}
          type="button"
        >
          <RefreshCw
            className={manualRefreshing ? 'animate-spin' : ''}
            size={15}
          />
        </button>
      </div>
      {notice && (
        <p className="mx-3 mb-1 text-[10px] text-amber-700" role="status">
          {notice}
        </p>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-2 pb-3"
        role="tree"
        aria-label="Workspace 文件"
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop
          lastScrollAt.current = Date.now()
        }}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            const style = {
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`
            }
            if (row.type === 'status') {
              return (
                <div
                  className="absolute top-0 left-0 flex w-full items-center text-[10px] text-[var(--text-muted)]"
                  key={row.id}
                  style={{ ...style, paddingLeft: `${10 + row.depth * 14}px` }}
                >
                  {row.text}
                </div>
              )
            }
            if (row.type === 'more') {
              return (
                <button
                  className="absolute top-0 left-0 w-full text-left text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-selected)]"
                  key={row.id}
                  onClick={() => {
                    const state = directories.get(row.directory)
                    void loadDirectory(
                      row.directory,
                      (state?.entries.length ?? 0) + 100
                    )
                  }}
                  style={{ ...style, paddingLeft: `${10 + row.depth * 14}px` }}
                  type="button"
                >
                  显示更多
                </button>
              )
            }
            const isRoot = row.type === 'root'
            const entry = row.type === 'entry' ? row.entry : undefined
            const path = isRoot ? '' : entry?.relativePath
            const isFolder = isRoot || entry?.kind === 'folder'
            const canExpand = isRoot || entry?.expandable === true
            const isExpanded = path !== undefined && expanded.has(path)
            const draggable =
              isRoot ||
              entry?.linkStatus === undefined ||
              entry.linkStatus === 'internal'
            return (
              <button
                ref={(element) => {
                  if (element) rowRefs.current.set(row.id, element)
                  else rowRefs.current.delete(row.id)
                }}
                aria-expanded={isFolder && canExpand ? isExpanded : undefined}
                aria-selected={selectedId === row.id}
                className="absolute top-0 left-0 flex w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-[var(--surface-selected)] focus-visible:outline-1 focus-visible:outline-[var(--text-muted)] aria-selected:bg-[var(--surface-selected)]"
                draggable={draggable}
                key={row.id}
                onClick={() => {
                  setSelectedId(row.id)
                  if (!query && isFolder && canExpand && path !== undefined)
                    toggleDirectory(path)
                }}
                onContextMenu={(event) =>
                  openMenu(event, isRoot ? { root: true } : { entry })
                }
                onDragStart={(event) => {
                  if (!draggable) {
                    event.preventDefault()
                    return
                  }
                  const reference = entry
                    ? referenceFromEntry(entry)
                    : {
                        id: 'folder:.',
                        kind: 'folder' as const,
                        name: workspaceName,
                        relativePath: '.'
                      }
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData(
                    CONTEXT_REFERENCE_MIME,
                    JSON.stringify({ workspaceId, ...reference })
                  )
                  event.dataTransfer.setData(
                    'text/plain',
                    `@${reference.relativePath}`
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    selectIndex(selectedIndex + 1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    selectIndex(selectedIndex - 1)
                  } else if (
                    event.key === 'ArrowRight' &&
                    !query &&
                    isFolder &&
                    canExpand &&
                    !isExpanded &&
                    path !== undefined
                  ) {
                    event.preventDefault()
                    toggleDirectory(path)
                  } else if (
                    (event.key === 'ArrowLeft' ||
                      (event.key === 'Enter' && !query)) &&
                    isFolder &&
                    canExpand &&
                    path !== undefined
                  ) {
                    event.preventDefault()
                    if (event.key === 'Enter' || isExpanded)
                      toggleDirectory(path)
                    else if (row.type === 'entry') {
                      const parentIndex = rows.findIndex(
                        (candidate) =>
                          (row.parent === '' && candidate.type === 'root') ||
                          (candidate.type === 'entry' &&
                            candidate.entry.relativePath === row.parent)
                      )
                      if (parentIndex >= 0) selectIndex(parentIndex)
                    }
                  } else if (
                    event.key === 'ContextMenu' ||
                    (event.shiftKey && event.key === 'F10')
                  ) {
                    openMenu(event, isRoot ? { root: true } : { entry })
                  }
                }}
                role="treeitem"
                style={{
                  ...style,
                  paddingLeft: `${8 + row.depth * 14}px`
                }}
                title={
                  isRoot
                    ? workspacePath
                    : (linkTitle(entry!) ?? entry?.relativePath)
                }
                type="button"
              >
                <span className="grid size-3.5 shrink-0 place-items-center text-[var(--text-muted)]">
                  {isFolder && canExpand ? (
                    isExpanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : null}
                </span>
                {entry?.symbolicLink ? (
                  <Link size={14} />
                ) : isFolder ? (
                  <Folder size={14} />
                ) : (
                  <File size={14} />
                )}
                <span className="truncate">
                  {isRoot ? workspaceName : entry?.name}
                </span>
              </button>
            )
          })}
        </div>
        {searching && (
          <p className="px-2 py-1 text-[10px] text-[var(--text-muted)]">
            正在搜索…
          </p>
        )}
        {query && !searching && searchEntries.length === 0 && (
          <p className="px-2 py-1 text-[10px] text-[var(--text-muted)]">
            没有匹配项
          </p>
        )}
        {searchTruncated && (
          <p className="px-2 py-1 text-[10px] text-[var(--text-muted)]">
            仅显示前 100 项，请缩小关键词
          </p>
        )}
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-40 rounded-lg border border-[var(--border)] bg-white p-1 text-xs shadow-lg"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-selected)] disabled:opacity-45"
            disabled={
              menu.entry?.linkStatus !== undefined &&
              menu.entry.linkStatus !== 'internal'
            }
            onClick={() => void addReference(menu.entry)}
            role="menuitem"
            type="button"
          >
            加入上下文
          </button>
          <button
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-selected)]"
            onClick={() => void reveal(menu.entry)}
            role="menuitem"
            type="button"
          >
            {menu.root || menu.entry?.kind === 'folder'
              ? '在文件管理器中打开'
              : '在文件管理器中显示'}
          </button>
        </div>
      )}
    </aside>
  )
}
