import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RuntimeDiagnostics,
  redactRuntimeLog
} from '../../src/main/runtime-diagnostics'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('RuntimeDiagnostics', () => {
  it('截断并清理常见秘密', () => {
    expect(
      redactRuntimeLog('token=secret proxy=http://u:p@host')
    ).not.toContain('secret')
    expect(
      redactRuntimeLog('token=secret proxy=http://u:p@host')
    ).not.toContain('u:p')
  })

  it('限制待写队列并在恢复后记录丢弃摘要', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omp-diagnostics-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'runtime.log')
    const diagnostics = new RuntimeDiagnostics(path, 1024 * 1024, 3, 180)
    for (let index = 0; index < 20; index += 1)
      diagnostics.write('x'.repeat(100))
    await diagnostics.flush()
    diagnostics.write('queue recovered')
    await diagnostics.flush()
    const contents = await readFile(path, 'utf8')
    expect(contents).toContain('LOG_OVERLOAD')
    expect(contents).toContain('queue recovered')
  })
})
