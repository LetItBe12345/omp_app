import { File, Folder, MessagesSquare, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ContextCandidate, ContextReference } from '../shared/desktop-api'

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

  const add = (candidate: ContextCandidate): void => {
    if (!references.some((reference) => reference.id === candidate.id)) {
      onReferences([
        ...references,
        {
          id: candidate.id,
          kind: candidate.kind,
          name: candidate.name,
          ...(candidate.relativePath
            ? { relativePath: candidate.relativePath }
            : {}),
          ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {})
        }
      ])
    }
    if (mention) onInput(input.slice(0, mention.start))
    setCandidates([])
  }

  return (
    <>
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
