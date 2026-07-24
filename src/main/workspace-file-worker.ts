import { parentPort } from 'node:worker_threads'
import { opendir, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

type WorkerRequest = {
  id: number
  root: string
  directory: string
  relativeDirectory: string
  revision: number
  offset: number
  limit: number
}

type WorkerEntry = {
  kind: 'file' | 'folder'
  name: string
  relativePath: string
  expandable: boolean
  symbolicLink: boolean
  linkStatus?: 'internal' | 'external' | 'broken' | 'cycle'
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

function naturalCompare(left: WorkerEntry, right: WorkerEntry): number {
  if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
  const insensitive = left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
  return (
    insensitive ||
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'variant'
    })
  )
}

async function readEntry(
  request: WorkerRequest,
  name: string,
  directoryEntry: {
    isDirectory(): boolean
    isFile(): boolean
    isSymbolicLink(): boolean
  }
): Promise<WorkerEntry | null> {
  const absolute = join(request.directory, name)
  const relativePath = request.relativeDirectory
    ? join(request.relativeDirectory, name)
    : name
  if (!directoryEntry.isSymbolicLink()) {
    if (!directoryEntry.isDirectory() && !directoryEntry.isFile()) return null
    const kind = directoryEntry.isDirectory() ? 'folder' : 'file'
    return {
      kind,
      name,
      relativePath,
      expandable: kind === 'folder',
      symbolicLink: false
    }
  }

  const target = await realpath(absolute).catch(() => null)
  if (!target) {
    return {
      kind: 'file',
      name,
      relativePath,
      expandable: false,
      symbolicLink: true,
      linkStatus: 'broken'
    }
  }
  if (!isWithin(request.root, target)) {
    return {
      kind: 'file',
      name,
      relativePath,
      expandable: false,
      symbolicLink: true,
      linkStatus: 'external'
    }
  }
  const ancestor = isWithin(target, request.directory)
  if (ancestor) {
    return {
      kind: 'file',
      name,
      relativePath,
      expandable: false,
      symbolicLink: true,
      linkStatus: 'cycle'
    }
  }
  const targetInfo = await stat(target).catch(() => null)
  const kind = targetInfo?.isDirectory() ? 'folder' : 'file'
  return {
    kind,
    name,
    relativePath,
    expandable: kind === 'folder',
    symbolicLink: true,
    linkStatus: 'internal'
  }
}

const directoryCache = new Map<
  string,
  { revision: number; entries: WorkerEntry[] }
>()

export async function listWorkerDirectory(request: WorkerRequest): Promise<{
  entries: WorkerEntry[]
  total: number
}> {
  const key = `${request.root}\0${request.directory}`
  let cached = directoryCache.get(key)
  if (!cached || cached.revision !== request.revision) {
    const handle = await opendir(request.directory)
    const entries: WorkerEntry[] = []
    for await (const directoryEntry of handle) {
      const entry = await readEntry(
        request,
        directoryEntry.name,
        directoryEntry
      )
      if (entry) entries.push(entry)
    }
    entries.sort(naturalCompare)
    cached = { revision: request.revision, entries }
    directoryCache.set(key, cached)
  }
  return {
    entries: cached.entries.slice(
      request.offset,
      request.offset + request.limit
    ),
    total: cached.entries.length
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  void listWorkerDirectory(request)
    .then((result) =>
      parentPort?.postMessage({ id: request.id, ok: true, ...result })
    )
    .catch((error: unknown) =>
      parentPort?.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    )
})
