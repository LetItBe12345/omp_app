import { homedir, tmpdir } from 'node:os'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ContextCandidate, SessionSummary } from '../shared/desktop-api'
import { findWorkspaceSearchEntries } from './workspace-files'

type SessionHeader = {
  type: 'session'
  version?: number
  id: string
  title?: string
  titleSource?: 'auto' | 'user'
  timestamp: string
  cwd: string
}

export type ParsedSession = Omit<SessionSummary, 'pinned' | 'archived'> & {
  header?: SessionHeader
  firstUserMessage?: string
  searchableText: string
  latestCompaction?: string
  visibleTurns: Array<{ role: 'user' | 'assistant'; text: string }>
}

function sessionDirectoryName(cwd: string): string {
  const resolved = resolve(cwd)
  const home = resolve(homedir())
  const temp = resolve(tmpdir())
  const homeRelative = relative(home, resolved)
  if (
    homeRelative === '' ||
    (!homeRelative.startsWith('..') && !isAbsolute(homeRelative))
  )
    return homeRelative ? `-${homeRelative.replace(/[/\\:]/gu, '-')}` : '-'
  const tempRelative = relative(temp, resolved)
  if (
    tempRelative === '' ||
    (!tempRelative.startsWith('..') && !isAbsolute(tempRelative))
  )
    return tempRelative
      ? `-tmp-${tempRelative.replace(/[/\\:]/gu, '-')}`
      : '-tmp'
  return `--${resolved.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`
}

export function getSessionDirectory(
  workspacePath: string,
  agentDirectory = join(homedir(), '.omp', 'agent')
): string {
  return join(agentDirectory, 'sessions', sessionDirectoryName(workspacePath))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .flatMap((block): string[] => {
      const item = record(block)
      return item?.['type'] === 'text' && typeof item['text'] === 'string'
        ? [item['text']]
        : []
    })
    .join('\n')
}

function cleanTitle(value: string): string {
  return (
    value
      .split(/\r?\n/u)[0]
      ?.split('')
      .filter((character) => {
        const code = character.charCodeAt(0)
        return code >= 32 && code !== 127
      })
      .join('')
      .trim()
      .slice(0, 160) || '新会话'
  )
}

function statusFromEntries(
  entries: Record<string, unknown>[]
): ParsedSession['status'] {
  const lastMessage = [...entries]
    .reverse()
    .find((entry) => entry['type'] === 'message')
  const message = record(lastMessage?.['message'])
  if (!message) return 'unknown'
  if (message['role'] === 'user') return 'pending'
  if (message['role'] === 'toolResult') return 'interrupted'
  if (message['role'] !== 'assistant') return 'unknown'
  if (message['stopReason'] === 'error') return 'error'
  if (message['stopReason'] === 'aborted') return 'aborted'
  if (message['stopReason'] === 'length') return 'interrupted'
  const content = message['content']
  if (
    Array.isArray(content) &&
    content.some((block) => record(block)?.['type'] === 'toolCall')
  )
    return 'interrupted'
  return 'complete'
}

export async function parseSessionFile(
  path: string,
  workspaceId: string
): Promise<ParsedSession> {
  const file = await stat(path)
  const raw = await readFile(path, 'utf8')
  const entries: Record<string, unknown>[] = []
  let malformed = false
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue
    try {
      const value = record(JSON.parse(line) as unknown)
      if (value) entries.push(value)
      else malformed = true
    } catch {
      malformed = true
    }
  }
  const titleSlot = entries[0]?.['type'] === 'title' ? entries.shift() : null
  const headerRecord = entries.shift()
  const version =
    typeof headerRecord?.['version'] === 'number'
      ? headerRecord['version']
      : undefined
  const validHeader =
    headerRecord?.['type'] === 'session' &&
    typeof headerRecord['id'] === 'string' &&
    typeof headerRecord['cwd'] === 'string' &&
    typeof headerRecord['timestamp'] === 'string' &&
    Number.isFinite(Date.parse(headerRecord['timestamp']))
  const compatibility: ParsedSession['compatibility'] =
    !validHeader || malformed
      ? 'corrupt'
      : version === undefined || version === 1
        ? 'v1'
        : version === 2
          ? 'v2'
          : version === 3
            ? 'v3'
            : 'future'
  const header: SessionHeader | undefined = validHeader
    ? {
        type: 'session',
        ...(version === undefined ? {} : { version }),
        id: headerRecord['id'] as string,
        cwd: headerRecord['cwd'] as string,
        timestamp: headerRecord['timestamp'] as string,
        ...(typeof headerRecord['title'] === 'string'
          ? { title: headerRecord['title'] }
          : {}),
        ...(headerRecord['titleSource'] === 'auto' ||
        headerRecord['titleSource'] === 'user'
          ? { titleSource: headerRecord['titleSource'] }
          : {})
      }
    : undefined
  const visibleTurns: ParsedSession['visibleTurns'] = []
  let firstUserMessage = ''
  let latestCompaction = ''
  let messageCount = 0
  for (const entry of entries) {
    if (entry['type'] === 'compaction' && typeof entry['summary'] === 'string')
      latestCompaction = entry['summary']
    if (entry['type'] !== 'message') continue
    messageCount += 1
    const message = record(entry['message'])
    const role = message?.['role']
    if (role !== 'user' && role !== 'assistant') continue
    const text = textContent(message?.['content']).trim()
    if (!text) continue
    if (role === 'user' && !firstUserMessage) firstUserMessage = text
    visibleTurns.push({ role, text })
  }
  const slotTitle =
    typeof titleSlot?.['title'] === 'string' ? titleSlot['title'].trim() : ''
  const title = cleanTitle(
    slotTitle ||
      header?.title ||
      firstUserMessage ||
      (compatibility === 'future' ? '不兼容的会话' : '损坏的会话')
  )
  return {
    id: header?.id ?? `invalid:${basename(path)}`,
    workspaceId,
    path,
    title,
    createdAt: header?.timestamp ?? file.birthtime.toISOString(),
    modifiedAt: file.mtime.toISOString(),
    messageCount,
    size: file.size,
    compatibility,
    status: statusFromEntries(entries),
    ...(header ? { header } : {}),
    ...(firstUserMessage ? { firstUserMessage } : {}),
    searchableText: [title, ...visibleTurns.map((turn) => turn.text)].join(
      '\n'
    ),
    ...(latestCompaction ? { latestCompaction } : {}),
    visibleTurns
  }
}

export async function listWorkspaceSessions(
  workspaceId: string,
  workspacePath: string,
  agentDirectory?: string
): Promise<ParsedSession[]> {
  const directory = getSessionDirectory(workspacePath, agentDirectory)
  const files = await readdir(directory, { withFileTypes: true }).catch(
    () => []
  )
  const sessions = await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) =>
        parseSessionFile(join(directory, entry.name), workspaceId).catch(
          async (): Promise<ParsedSession> => {
            const filePath = join(directory, entry.name)
            const file = await stat(filePath)
            return {
              id: `invalid:${entry.name}`,
              workspaceId,
              path: filePath,
              title: '损坏的会话',
              createdAt: file.birthtime.toISOString(),
              modifiedAt: file.mtime.toISOString(),
              messageCount: 0,
              size: file.size,
              compatibility: 'corrupt',
              status: 'unknown',
              searchableText: '',
              visibleTurns: []
            }
          }
        )
      )
  )
  return sessions.sort(
    (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt)
  )
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

export async function validateWorkspaceReference(
  workspacePath: string,
  relativePath: string
): Promise<{ path: string; size: number; kind: 'file' | 'folder' }> {
  if (!relativePath || isAbsolute(relativePath)) throw new Error('引用路径无效')
  const [root, target] = await Promise.all([
    realpath(workspacePath),
    realpath(join(workspacePath, relativePath))
  ])
  if (!isWithin(root, target)) throw new Error('引用超出当前 Workspace')
  const info = await stat(target)
  if (!info.isFile() && !info.isDirectory()) throw new Error('引用类型不支持')
  return {
    path: target,
    size: info.size,
    kind: info.isDirectory() ? 'folder' : 'file'
  }
}

function matchRank(name: string, path: string, query: string): number {
  const normalizedName = name.toLocaleLowerCase()
  const normalizedPath = path.toLocaleLowerCase()
  const normalizedQuery = query.toLocaleLowerCase()
  if (normalizedName === normalizedQuery) return 0
  if (normalizedName.startsWith(normalizedQuery)) return 1
  if (
    normalizedPath
      .split(/[\\/]/u)
      .some((part) => part.startsWith(normalizedQuery))
  )
    return 2
  return normalizedPath.includes(normalizedQuery) ? 3 : 99
}

export async function findContextCandidates(
  workspacePath: string,
  query: string,
  sessions: ParsedSession[],
  signal?: AbortSignal
): Promise<ContextCandidate[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const workspaceEntries = await findWorkspaceSearchEntries(
    workspacePath,
    query,
    signal
  )
  const files = workspaceEntries
    .filter((entry) => entry.kind === 'file')
    .map((entry): ContextCandidate => ({
      ...entry,
      detail: entry.relativePath
    }))
  const folders = workspaceEntries
    .filter((entry) => entry.kind === 'folder')
    .map((entry): ContextCandidate => ({
      ...entry,
      detail: entry.relativePath
    }))
  const folderLimit = normalizedQuery
    ? 20
    : Math.min(15, 8 + Math.max(0, 7 - files.length))
  const fileLimit = normalizedQuery
    ? 20
    : Math.min(15, 7 + Math.max(0, 8 - folders.length))
  const sessionItems = sessions
    .filter(
      (session) =>
        session.compatibility !== 'corrupt' &&
        session.compatibility !== 'future' &&
        (!normalizedQuery ||
          matchRank(session.title, session.title, normalizedQuery) < 99)
    )
    .slice(0, normalizedQuery ? 20 : 5)
    .map((session): ContextCandidate => ({
      id: `session:${session.id}`,
      kind: 'session',
      name: session.title,
      detail: session.modifiedAt,
      sessionId: session.id
    }))
  return [
    ...files.slice(0, fileLimit),
    ...folders.slice(0, folderLimit),
    ...sessionItems
  ]
}

export function sessionUriPage(
  session: ParsedSession,
  cursor?: number
): { content: string; previousCursor?: number } {
  const turns = session.visibleTurns
  const end = Math.min(cursor ?? turns.length, turns.length)
  let start = Math.max(0, end - 20)
  const parts = [
    `# ${session.title}`,
    session.latestCompaction
      ? `\n## 最新压缩摘要\n${session.latestCompaction}`
      : '',
    session.firstUserMessage
      ? `\n## 首条用户消息\n${session.firstUserMessage}`
      : '',
    '\n## 最近对话'
  ]
  while (start < end) {
    const selected = turns.slice(start, end)
    const body = selected
      .map(
        (turn) =>
          `### ${turn.role === 'user' ? '用户' : 'Assistant'}\n${turn.text}`
      )
      .join('\n\n')
    const content = [...parts, body].filter(Boolean).join('\n')
    if (Buffer.byteLength(content, 'utf8') <= 50 * 1024)
      return { content, ...(start > 0 ? { previousCursor: start } : {}) }
    start += 1
  }
  return { content: parts.join('\n') }
}
