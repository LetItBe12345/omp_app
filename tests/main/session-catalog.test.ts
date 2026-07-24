// @vitest-environment node
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findContextCandidates,
  getSessionDirectory,
  listWorkspaceSessions,
  parseSessionFile,
  sessionUriPage,
  validateWorkspaceReference
} from '../../src/main/session-catalog'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = join(
    tmpdir(),
    `omp-session-catalog-${process.pid}-${roots.length}-${Date.now()}`
  )
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  )
})

describe('Session catalog', () => {
  it('只读解析 OMP v1、v2、v3 fixture', async () => {
    const fixtures = ['v1', 'v2', 'v3'] as const
    for (const version of fixtures) {
      const path = join(
        process.cwd(),
        'tests',
        'fixtures',
        'sessions',
        `${version}.jsonl`
      )
      const before = await readFile(path, 'utf8')
      const session = await parseSessionFile(path, 'workspace')
      expect(session.compatibility).toBe(version)
      expect(session.id).toBe(`session-${version}`)
      expect(session.messageCount).toBeGreaterThan(0)
      expect(await readFile(path, 'utf8')).toBe(before)
    }
  })

  it('隔离损坏和未来版本 Session', async () => {
    const root = await temporaryRoot()
    const corrupt = join(root, 'corrupt.jsonl')
    const future = join(root, 'future.jsonl')
    await writeFile(corrupt, '{broken\n')
    await writeFile(
      future,
      `${JSON.stringify({
        type: 'session',
        version: 4,
        id: 'future',
        timestamp: new Date().toISOString(),
        cwd: root
      })}\n`
    )
    await expect(parseSessionFile(corrupt, 'workspace')).resolves.toMatchObject(
      { compatibility: 'corrupt' }
    )
    await expect(parseSessionFile(future, 'workspace')).resolves.toMatchObject({
      compatibility: 'future'
    })
  })

  it('扫描 OMP 编码目录并按 modifiedAt 倒序返回', async () => {
    const workspace = await temporaryRoot()
    const agent = await temporaryRoot()
    const directory = getSessionDirectory(workspace, agent)
    await mkdir(directory, { recursive: true })
    const source = join(process.cwd(), 'tests/fixtures/sessions/v3.jsonl')
    await cp(source, join(directory, 'one.jsonl'))
    const sessions = await listWorkspaceSessions('workspace', workspace, agent)
    expect(sessions.map((session) => session.id)).toEqual(['session-v3'])
  })

  it('按需搜索文件并排除 Workspace 外符号链接', async () => {
    const workspace = await temporaryRoot()
    const outside = await temporaryRoot()
    await mkdir(join(workspace, 'src'))
    await writeFile(join(workspace, 'src', 'session.ts'), 'export {}')
    await writeFile(join(workspace, 'report file.pdf'), '%PDF')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'secret.txt'))
    const candidates = await findContextCandidates(
      workspace,
      's',
      [],
      new AbortController().signal
    )
    expect(candidates.map((item) => item.detail)).toContain('src/session.ts')
    expect(candidates.map((item) => item.detail)).not.toContain('secret.txt')
    const binary = await findContextCandidates(workspace, 'report', [])
    expect(binary).toEqual([
      expect.objectContaining({
        kind: 'file',
        relativePath: 'report file.pdf'
      })
    ])
    await expect(
      validateWorkspaceReference(workspace, 'secret.txt')
    ).rejects.toThrow('Workspace')
  })

  it('Session URI 只返回可见对话并提供更早游标', async () => {
    const path = join(process.cwd(), 'tests/fixtures/sessions/v3.jsonl')
    const session = await parseSessionFile(path, 'workspace')
    const page = sessionUriPage(session)
    expect(page.content).toContain('检查 v3')
    expect(page.content).toContain('v3 正常')
    expect(page.content).not.toContain('toolResult')
  })

  it('裸 @ 根目录名额可在文件与文件夹之间转移', async () => {
    const workspace = await temporaryRoot()
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        writeFile(join(workspace, `file-${index}.txt`), String(index))
      )
    )
    const candidates = await findContextCandidates(workspace, '', [])
    expect(candidates).toHaveLength(12)
    expect(candidates.every((item) => item.kind === 'file')).toBe(true)
  })
})
