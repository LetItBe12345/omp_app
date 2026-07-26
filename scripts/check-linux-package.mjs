import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve('dist')
const entries = await readdir(dist)
const artifacts = entries.filter(
  (name) => name.endsWith('.AppImage') || name.endsWith('.deb')
)
const appImages = artifacts.filter((name) => name.endsWith('.AppImage'))
const debs = artifacts.filter((name) => name.endsWith('.deb'))
if (appImages.length !== 1 || debs.length !== 1) {
  throw new Error(
    `应有一个 AppImage 和一个 deb，实际为：${artifacts.join(', ')}`
  )
}
const metrics = {
  generatedAt: new Date().toISOString(),
  artifacts: {},
  rendererChunks: {}
}
for (const name of artifacts) {
  if (!name.includes('-linux-x64.'))
    throw new Error(`产物文件名没有限定 x64：${name}`)
  const path = resolve(dist, name)
  if (name.endsWith('.AppImage')) await chmod(path, 0o755)
  const data = await readFile(path)
  const digest = createHash('sha256').update(data).digest('hex')
  await writeFile(`${path}.sha256`, `${digest}  ${name}\n`)
  const size = (await stat(path)).size
  metrics.artifacts[name] = { bytes: size, sha256: digest }
  console.log(`${name}: ${size} bytes, sha256=${digest}`)
}

const rendererAssets = resolve('out/renderer/assets')
for (const name of (await readdir(rendererAssets)).filter((name) =>
  name.endsWith('.js')
)) {
  const data = await readFile(resolve(rendererAssets, name))
  metrics.rendererChunks[name] = {
    bytes: data.byteLength,
    gzipBytes: gzipSync(data).byteLength
  }
}
for (const relative of ['resources/app.asar', 'resources/runtime/omp']) {
  const path = resolve('dist/linux-unpacked', relative)
  metrics[relative] = { bytes: (await stat(path)).size }
}
await writeFile(
  resolve(dist, 'build-metrics.json'),
  JSON.stringify(metrics, null, 2) + '\n'
)
console.log(JSON.stringify(metrics, null, 2))
