#!/usr/bin/env node
// 只替代模型/RPC 子进程；Electron、IPC、Session 目录和 Renderer 均使用应用实现。
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join, relative } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version')) {
  console.log('17.0.6')
  process.exit(0)
}
const cwd = process.argv[process.argv.indexOf('--cwd') + 1]
const directory = join(
  homedir(),
  '.omp/agent/sessions',
  `-tmp-${relative(tmpdir(), cwd).replace(/[/\\:]/gu, '-')}`
)
const mode = process.argv[process.argv.indexOf('--approval-mode') + 1]
let sessionId
let sessionFile
let sessionName
let messages
let isStreaming = false
let completion
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (value) =>
  appendFileSync(process.env.OMP_E2E_RPC_LOG, `${JSON.stringify(value)}\n`)

function newSession() {
  sessionId = randomUUID()
  sessionFile = join(directory, `${sessionId}.jsonl`)
  sessionName = undefined
  messages = []
}
function persist() {
  mkdirSync(directory, { recursive: true })
  const entries = [
    {
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd,
      title: sessionName
    },
    ...messages.map((message, index) => ({
      type: 'message',
      id: `m${index}`,
      message
    }))
  ]
  writeFileSync(
    sessionFile,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  )
}
function finish(stopReason = 'stop') {
  clearTimeout(completion)
  const message = {
    id: randomUUID(),
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: stopReason === 'aborted' ? 'E2E 任务已中止' : 'E2E 命令执行完成'
      }
    ],
    stopReason,
    timestamp: Date.now()
  }
  messages.push(message)
  persist()
  send({ type: 'message_end', message })
  isStreaming = false
  send({ type: 'agent_end', messages })
}
newSession()
log({ type: 'startup', mode })
send({ type: 'ready' })
createInterface({ input: process.stdin })
  .on('line', (line) => {
    const command = JSON.parse(line)
    log(command)
    const response = (data) =>
      send({
        type: 'response',
        id: command.id,
        command: command.type,
        success: true,
        ...(data === undefined ? {} : { data })
      })
    switch (command.type) {
      case 'get_state':
        response({
          sessionId,
          sessionFile,
          sessionName,
          model: { provider: 'test', id: 'e2e-model' },
          thinkingLevel: 'medium',
          isStreaming,
          queuedMessageCount: 0
        })
        break
      case 'new_session':
        newSession()
        response({ cancelled: false })
        break
      case 'set_session_name':
        sessionName = command.name
        if (existsSync(sessionFile)) persist()
        response()
        break
      case 'switch_session': {
        sessionFile = command.sessionPath
        const [header, ...entries] = readFileSync(sessionFile, 'utf8')
          .trim()
          .split('\n')
          .map((entry) => JSON.parse(entry))
        sessionId = header.id
        sessionName = header.title
        messages = entries
          .filter((entry) => entry.type === 'message')
          .map((entry) => entry.message)
        response({ cancelled: false })
        break
      }
      case 'get_messages':
        response({ messages })
        break
      case 'get_available_commands':
        response({
          commands: [
            { name: 'e2e', description: 'E2E 测试命令', source: 'custom' }
          ]
        })
        break
      case 'get_available_models':
        response({
          models: [
            {
              provider: 'test',
              id: 'e2e-model',
              name: 'E2E Model',
              reasoning: false
            }
          ]
        })
        break
      case 'get_login_providers':
        response({ providers: [] })
        break
      case 'prompt': {
        const message = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: command.message }],
          timestamp: Date.now()
        }
        messages.push(message)
        persist()
        isStreaming = true
        response()
        send({ type: 'message_end', message })
        send({ type: 'agent_start' })
        // 长任务仅由 abort 结束，取消测试不依赖点击速度。
        if (!command.message.includes('long-running'))
          completion = setTimeout(() => finish(), 100)
        break
      }
      case 'abort':
        if (isStreaming) finish('aborted')
        response()
        break
      default:
        response()
    }
  })
  .on('close', () => process.exit(0))
