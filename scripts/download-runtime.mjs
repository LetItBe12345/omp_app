import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(root, 'runtime/manifest.json')
const runtimePath = resolve(root, 'runtime/omp')
const checkOnly = process.argv.includes('--check')

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function sha256(path) {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function verify(manifest) {
  const info = await stat(runtimePath).catch(() => null)
  if (!info?.isFile()) return false
  const digest = await sha256(runtimePath)
  if (digest !== manifest.sha256) {
    fail(`runtime/omp SHA-256 不匹配：期望 ${manifest.sha256}，实际 ${digest}`)
  }
  if ((info.mode & 0o111) === 0) fail('runtime/omp 没有执行权限')
  const header = await readFile(runtimePath).then((data) =>
    data.subarray(0, 20)
  )
  if (header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
    fail('runtime/omp 不是 ELF 文件')
  }
  if (header[4] !== 2 || header.readUInt16LE(18) !== 0x3e) {
    fail('runtime/omp 不是 Linux x86-64 ELF')
  }
  console.log(
    `runtime/omp 已验证：OMP ${manifest.version}, linux-x64, ${digest}`
  )
  return true
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.platform !== 'linux' || manifest.arch !== 'x64') {
  fail('runtime/manifest.json 只能声明 linux-x64 Runtime')
}
if (await verify(manifest)) process.exit(0)
if (checkOnly) fail('runtime/omp 不存在，请先运行 pnpm runtime:download')
if (platform() !== 'linux' || arch() !== 'x64') {
  fail('OMP Desktop MVP 只能在 Linux x64 下载和打包 Runtime')
}

await mkdir(dirname(runtimePath), { recursive: true })
const temporaryPath = `${runtimePath}.download`
const response = await fetch(manifest.url, { redirect: 'follow' })
if (!response.ok) fail(`下载 OMP 失败：HTTP ${response.status}`)
await writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()), {
  mode: 0o755
})
await chmod(temporaryPath, 0o755)
const digest = await sha256(temporaryPath)
if (digest !== manifest.sha256) {
  await unlink(temporaryPath).catch(() => {})
  fail(`下载文件 SHA-256 不匹配：期望 ${manifest.sha256}，实际 ${digest}`)
}
await rename(temporaryPath, runtimePath)
await verify(manifest)
