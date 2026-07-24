import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLocalPathValue } from '../../src/main/runtime-ipc'

describe('resolveLocalPathValue', () => {
  it('完整名称优先于行列号后缀，并支持四种常见格式', async () => {
    const root = join(tmpdir(), `omp-local-path-${process.pid}-${Date.now()}`)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'main.ts'), '')
    await writeFile(join(root, 'src', 'main.ts:12'), '')

    await expect(
      resolveLocalPathValue('src/main.ts:12', root)
    ).resolves.toMatchObject({ path: join(root, 'src', 'main.ts:12') })
    await expect(
      resolveLocalPathValue('src/main.ts:13:4', root)
    ).resolves.toMatchObject({ path: join(root, 'src', 'main.ts') })
    await expect(
      resolveLocalPathValue('src/main.ts#L13', root)
    ).resolves.toMatchObject({ path: join(root, 'src', 'main.ts') })
    await expect(
      resolveLocalPathValue('src/main.ts#L13C4', root)
    ).resolves.toMatchObject({ path: join(root, 'src', 'main.ts') })
  })

  it('安全解码 URL、支持用户目录和 Workspace 外绝对路径', async () => {
    const root = join(
      tmpdir(),
      `omp-local-path-space-${process.pid}-${Date.now()}`
    )
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'space name.md'), '')
    const outside = join(tmpdir(), `omp-outside-${process.pid}-${Date.now()}`)
    await writeFile(outside, '')

    await expect(
      resolveLocalPathValue('space%20name.md', root)
    ).resolves.toMatchObject({ path: join(root, 'space name.md') })
    await expect(resolveLocalPathValue('~/', root)).resolves.toMatchObject({
      path: homedir(),
      directory: true
    })
    await expect(resolveLocalPathValue(outside, root)).resolves.toMatchObject({
      path: outside,
      directory: false
    })
  })

  it('不展开环境变量、Shell 语法或非法 URL 编码', async () => {
    await expect(
      resolveLocalPathValue('$HOME/file', tmpdir())
    ).resolves.toBeNull()
    await expect(
      resolveLocalPathValue('`touch bad`', tmpdir())
    ).resolves.toBeNull()
    await expect(
      resolveLocalPathValue('%E0%A4%A', tmpdir())
    ).resolves.toBeNull()
  })

  it('把 Shell 字符当作普通文件名，不执行或展开', async () => {
    const root = join(
      tmpdir(),
      `omp-local-literal-${process.pid}-${Date.now()}`
    )
    await mkdir(root, { recursive: true })
    await writeFile(join(root, '$HOME.md'), '')
    await writeFile(join(root, '`literal`.md'), '')

    await expect(
      resolveLocalPathValue('$HOME.md', root)
    ).resolves.toMatchObject({ path: join(root, '$HOME.md') })
    await expect(
      resolveLocalPathValue('`literal`.md', root)
    ).resolves.toMatchObject({ path: join(root, '`literal`.md') })
  })
})
