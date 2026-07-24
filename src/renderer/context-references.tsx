import { File, Folder, MessagesSquare, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContextCandidate, ContextReference } from '../shared/desktop-api'
import { CONTEXT_REFERENCE_MIME } from './context-drag'

function activeMention(input: string): { query: string; start: number } | null {
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(input)
  if (!match || match.index === undefined) return null
  return {
    query: match[1] ?? '',
    start: match.index + (match[0].startsWith(' ') ? 1 : 0)
  }
}

function icon(kind: ContextReference['kind']): React.JSX.Element {
  if (kind === 'folder') return <Folder size={12} />
  if (kind === 'session') return <MessagesSquare size={12} />
  return <File size={12} />
}

function referenceFromCandidate(candidate: ContextCandidate): ContextReference {
  return {
    id: candidate.id,
    kind: candidate.kind,
    name: candidate.name,
    ...(candidate.relativePath ? { relativePath: candidate.relativePath } : {}),
    ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {})
  }
}

function mergeReferences(
  references: ContextReference[],
  additions: ContextReference[]
): ContextReference[] {
  const merged = [...references]
  const ids = new Set(references.map((reference) => reference.id))
  for (const addition of additions) {
    if (ids.has(addition.id)) continue
    ids.add(addition.id)
    merged.push(addition)
  }
  return merged
}

function parseDraggedReference(value: string): ContextReference | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      typeof parsed['id'] !== 'string' ||
      typeof parsed['name'] !== 'string' ||
      typeof parsed['relativePath'] !== 'string' ||
      (parsed['kind'] !== 'file' && parsed['kind'] !== 'folder')
    ) {
      return null
    }
    return {
      id: parsed['id'],
      kind: parsed['kind'],
      name: parsed['name'],
      relativePath: parsed['relativePath']
    }
  } catch {
    return null
  }
}

export function ContextReferences({
  workspaceId,
  input,
  onInput,
  references,
  onReferences,
  recentReferences
}: {
  workspaceId?: string
  input: string
  onInput: (value: string) => void
  references: ContextReference[]
  onReferences: (value: ContextReference[]) => void
  recentReferences: ContextReference[]
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<ContextCandidate[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const dropMarker = useRef<HTMLSpanElement>(null)
  const mention = useMemo(() => activeMention(input), [input])

  useEffect(() => {
    if (!workspaceId || !mention) {
      queueMicrotask(() => setCandidates([]))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        void window.desktop
          .getContextCandidates(workspaceId, mention.query)
          .then((result) => {
            if (!cancelled) {
              const recent = mention.query
                ? []
                : recentReferences
                    .slice(-5)
                    .reverse()
                    .map((reference): ContextCandidate => ({
                      ...reference,
                      detail: reference.relativePath ?? '当前会话最近引用'
                    }))
              const returned = result.ok ? result.data : []
              setCandidates([
                ...recent,
                ...returned.filter(
                  (candidate) =>
                    !recent.some((reference) => reference.id === candidate.id)
                )
              ])
            }
          })
      },
      mention.query ? 120 : 0
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mention, recentReferences, workspaceId])

  useEffect(() => {
    const dropTarget = dropMarker.current?.parentElement
    if (!workspaceId || !dropTarget) return
    let depth = 0
    const supported = (transfer: DataTransfer | null): boolean => {
      if (!transfer) return false
      const types = Array.from(transfer.types)
      return types.includes(CONTEXT_REFERENCE_MIME) || types.includes('Files')
    }
    const reset = (): void => {
      depth = 0
      setDragActive(false)
    }
    const onDragEnter = (event: DragEvent): void => {
      if (!supported(event.dataTransfer)) return
      event.preventDefault()
      depth += 1
      setDragActive(true)
      setDropError(null)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!supported(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!supported(event.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!supported(event.dataTransfer)) return
      event.preventDefault()
      reset()
      const transfer = event.dataTransfer
      if (!transfer) return
      const internal = parseDraggedReference(
        transfer.getData(CONTEXT_REFERENCE_MIME)
      )
      if (internal) {
        onReferences(mergeReferences(references, [internal]))
        setDropError(null)
        return
      }
      const files = Array.from(transfer.files)
      if (files.length === 0 && transfer.items) {
        for (const item of Array.from(transfer.items)) {
          if (item.kind !== 'file') continue
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return
      void window.desktop
        .resolveDroppedFiles(workspaceId, files)
        .then((result) => {
          if (!result.ok) {
            setDropError(result.error.message)
            return
          }
          if (result.data.references.length > 0) {
            onReferences(mergeReferences(references, result.data.references))
          }
          setDropError(
            result.data.rejectedCount > 0
              ? result.data.references.length > 0
                ? `已加入 ${result.data.references.length} 项，另有 ${result.data.rejectedCount} 项不在当前 Workspace`
                : '只能引用当前 Workspace 内的文件或文件夹'
              : null
          )
        })
    }
    dropTarget.addEventListener('dragenter', onDragEnter)
    dropTarget.addEventListener('dragover', onDragOver)
    dropTarget.addEventListener('dragleave', onDragLeave)
    dropTarget.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      dropTarget.removeEventListener('dragenter', onDragEnter)
      dropTarget.removeEventListener('dragover', onDragOver)
      dropTarget.removeEventListener('dragleave', onDragLeave)
      dropTarget.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [onReferences, references, workspaceId])

  const add = (candidate: ContextCandidate): void => {
    onReferences(
      mergeReferences(references, [referenceFromCandidate(candidate)])
    )
    if (mention) onInput(input.slice(0, mention.start))
    setCandidates([])
  }

  return (
    <>
      <span aria-hidden="true" className="hidden" ref={dropMarker} />
      {dragActive && (
        <div className="pointer-events-none absolute inset-1 z-30 grid place-items-center rounded-xl border border-dashed border-[var(--text-secondary)] bg-white/95 text-xs font-medium">
          松开以引用文件或文件夹
        </div>
      )}
      {references.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          {references.map((reference) => (
            <span
              className="inline-flex max-w-52 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-app)] px-1.5 py-1 text-[11px]"
              key={reference.id}
              title={reference.relativePath ?? reference.name}
            >
              {icon(reference.kind)}
              <span className="truncate">{reference.name}</span>
              <button
                aria-label={`移除 ${reference.name}`}
                className="grid size-4 place-items-center rounded hover:bg-black/5"
                onClick={() =>
                  onReferences(
                    references.filter((item) => item.id !== reference.id)
                  )
                }
                type="button"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {dropError && (
        <p className="px-2 pb-2 text-[10px] text-red-600" role="alert">
          {dropError}
        </p>
      )}
      {mention && candidates.length > 0 && (
        <div className="absolute right-3 bottom-full left-3 z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-1 shadow-lg">
          {(['file', 'folder', 'session'] as const).map((kind) => {
            const items = candidates.filter(
              (candidate) => candidate.kind === kind
            )
            if (items.length === 0) return null
            return (
              <section key={kind}>
                <p className="px-2 pt-2 pb-1 text-[10px] font-medium text-[var(--text-muted)]">
                  {kind === 'file'
                    ? '文件'
                    : kind === 'folder'
                      ? '文件夹'
                      : 'Session'}
                </p>
                {items.map((candidate) => (
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-selected)]"
                    key={candidate.id}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      add(candidate)
                    }}
                    type="button"
                  >
                    {icon(candidate.kind)}
                    <span className="truncate">{candidate.name}</span>
                    <span className="ml-auto max-w-52 truncate text-[10px] text-[var(--text-muted)]">
                      {candidate.detail}
                    </span>
                  </button>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
