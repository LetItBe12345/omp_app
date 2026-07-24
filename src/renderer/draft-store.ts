import type { ContextReference, DraftRecord } from '../shared/desktop-api'

const prefix = 'omp-draft:v1:'
const itemLimit = 256 * 1024
const totalLimit = 2 * 1024 * 1024
const expiryMs = 30 * 24 * 60 * 60 * 1000

type StoredDraft = DraftRecord & {
  workspaceId: string
  sessionId: string
}

export type DraftSaveResult =
  | { saved: true }
  | { saved: false; reason: 'item-too-large' | 'storage-failed' }

function key(workspaceId: string, sessionId: string): string {
  return `${prefix}${workspaceId}:${sessionId}`
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function readStored(
  storage: Storage
): Array<{ key: string; draft: StoredDraft }> {
  const drafts: Array<{ key: string; draft: StoredDraft }> = []
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index)
    if (!storageKey?.startsWith(prefix)) continue
    const value = storage.getItem(storageKey)
    if (!value) continue
    try {
      const parsed = JSON.parse(value) as StoredDraft
      if (
        typeof parsed.text === 'string' &&
        Array.isArray(parsed.references) &&
        typeof parsed.updatedAt === 'string' &&
        typeof parsed.workspaceId === 'string' &&
        typeof parsed.sessionId === 'string'
      )
        drafts.push({ key: storageKey, draft: parsed })
    } catch {
      storage.removeItem(storageKey)
    }
  }
  return drafts
}

function removeExpired(storage: Storage, now: number): void {
  for (const item of readStored(storage)) {
    if (now - Date.parse(item.draft.updatedAt) > expiryMs)
      storage.removeItem(item.key)
  }
}

function makeRoom(
  storage: Storage,
  currentKey: string,
  requiredBytes: number,
  now: number
): void {
  removeExpired(storage, now)
  const entries = readStored(storage)
  let total = entries.reduce((sum, item) => {
    const value = storage.getItem(item.key)
    return sum + (value ? bytes(value) : 0)
  }, 0)
  const current = storage.getItem(currentKey)
  total -= current ? bytes(current) : 0
  const oldest = entries
    .filter((item) => item.key !== currentKey)
    .sort(
      (a, b) => Date.parse(a.draft.updatedAt) - Date.parse(b.draft.updatedAt)
    )
  for (const item of oldest) {
    if (total + requiredBytes <= totalLimit) break
    const value = storage.getItem(item.key)
    storage.removeItem(item.key)
    total -= value ? bytes(value) : 0
  }
}

export function loadDraft(
  storage: Storage,
  workspaceId: string,
  sessionId: string
): DraftRecord | null {
  const value = storage.getItem(key(workspaceId, sessionId))
  if (!value) return null
  try {
    const draft = JSON.parse(value) as StoredDraft
    if (
      typeof draft.text !== 'string' ||
      !Array.isArray(draft.references) ||
      typeof draft.updatedAt !== 'string'
    )
      return null
    return {
      text: draft.text,
      references: draft.references,
      updatedAt: draft.updatedAt
    }
  } catch {
    return null
  }
}

export function saveDraft(
  storage: Storage,
  workspaceId: string,
  sessionId: string,
  text: string,
  references: ContextReference[],
  now = Date.now()
): DraftSaveResult {
  const storageKey = key(workspaceId, sessionId)
  if (!text && references.length === 0) {
    storage.removeItem(storageKey)
    return { saved: true }
  }
  const serialized = JSON.stringify({
    workspaceId,
    sessionId,
    text,
    references,
    updatedAt: new Date(now).toISOString()
  } satisfies StoredDraft)
  const itemBytes = bytes(serialized)
  if (itemBytes > itemLimit) return { saved: false, reason: 'item-too-large' }
  const attempt = (): boolean => {
    try {
      storage.setItem(storageKey, serialized)
      return true
    } catch {
      return false
    }
  }
  makeRoom(storage, storageKey, itemBytes, now)
  if (attempt()) return { saved: true }
  makeRoom(storage, storageKey, itemBytes, now)
  return attempt()
    ? { saved: true }
    : { saved: false, reason: 'storage-failed' }
}

export function clearDraft(
  storage: Storage,
  workspaceId: string,
  sessionId: string
): void {
  storage.removeItem(key(workspaceId, sessionId))
}

export function cleanExpiredDrafts(storage: Storage, now = Date.now()): void {
  removeExpired(storage, now)
}
