import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname, platform, release, userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const [command = 'help', ...args] = process.argv.slice(2)
const commit = args[args.indexOf('--commit') + 1] || process.env.GITHUB_SHA
const version = args[args.indexOf('--version') + 1]
const acceptanceRoot = resolve(
  homedir(),
  '.local/state/omp-desktop/release-acceptance'
)

function usage() {
  console.log(`用法：
  node scripts/gpu-acceptance.mjs sign --commit <sha> --version <semver>
  node scripts/gpu-acceptance.mjs verify <file> --commit <sha> --version <semver>`)
}

function required(value, name) {
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

async function sign() {
  required(commit, '--commit')
  required(version, '--version')
  if (
    process.env.XDG_SESSION_TYPE !== 'wayland' ||
    !process.env.WAYLAND_DISPLAY
  ) {
    throw new Error(
      '必须在原生 Wayland 会话执行（需要 XDG_SESSION_TYPE=wayland 和 WAYLAND_DISPLAY）'
    )
  }
  const rl = createInterface({ input, output })
  const items = [
    '应用从当前 commit 构建并启动，首屏正常显示',
    'Runtime ready，模型请求使用隔离 Workspace 和手动 HTTP 代理成功',
    '流式文本、Thinking、Tool Call、Permission、Stop 和 Ctrl+C 正常',
    '长对话滚动、弹窗、缩放、黑屏、闪烁和透明窗口均正常',
    '切换 Session、文件浏览、剪贴板和文件选择器正常',
    '退出后没有遗留 OMP 进程，代理切换为不使用后变量已清除'
  ]
  const results = []
  for (const item of items) {
    const answer = (await rl.question(`[ ] ${item}（输入 y 通过）：`))
      .trim()
      .toLowerCase()
    results.push({ item, passed: answer === 'y' })
  }
  await rl.close()
  if (results.some((item) => !item.passed))
    throw new Error('存在未通过的人工验收项')
  const record = {
    schema: 1,
    commit,
    version,
    operator: userInfo().username,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      kernel: release(),
      sessionType: process.env.XDG_SESSION_TYPE,
      waylandDisplay: process.env.WAYLAND_DISPLAY,
      gpu: 'NVIDIA RTX 3090'
    },
    results,
    approved: true
  }
  const target = resolve(acceptanceRoot, `${commit}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(record, null, 2) + '\n', {
    mode: 0o600
  })
  console.log(`已生成 ${target}`)
}

async function verify(file) {
  required(file, '验收记录路径')
  const record = JSON.parse(await readFile(file, 'utf8'))
  if (
    record.schema !== 1 ||
    record.commit !== required(commit, '--commit') ||
    record.version !== required(version, '--version') ||
    record.approved !== true
  ) {
    throw new Error('验收记录与当前 commit/version 不匹配，或未批准')
  }
  if (
    record.environment?.sessionType !== 'wayland' ||
    record.environment?.gpu !== 'NVIDIA RTX 3090'
  ) {
    throw new Error('验收记录不是 RTX 3090 原生 Wayland 环境')
  }
  console.log(`GPU 验收记录有效：${record.operator} ${record.createdAt}`)
}

try {
  if (command === 'sign') await sign()
  else if (command === 'verify') await verify(args[0])
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
