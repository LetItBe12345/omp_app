import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

if (process.env.FAKE_GRANDCHILD_PID_FILE) {
  const grandchild = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore' }
  )
  writeFileSync(process.env.FAKE_GRANDCHILD_PID_FILE, String(grandchild.pid))
}

let isStreaming = false
let queuedMessageCount = 0

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

send({ type: 'ready' })
send({ type: 'notice', message: 'fake runtime ready' })

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const command = JSON.parse(line)
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
        model: { provider: 'test', id: 'fake-model' },
        thinkingLevel: 'medium',
        isStreaming,
        queuedMessageCount,
        sessionId: 'fake-session',
        sessionFile: '/tmp/fake-session.jsonl'
      })
      break
    case 'prompt':
      response()
      isStreaming = true
      send({ type: 'agent_start' })
      break
    case 'follow_up':
      queuedMessageCount += 1
      response()
      break
    case 'abort':
      if (process.env.FAKE_ABORT_HANG === '1') break
      isStreaming = false
      response()
      send({ type: 'agent_end' })
      break
    case 'switch_session':
      queuedMessageCount = 0
      response({ cancelled: false })
      break
    case 'get_messages':
      response({ messages: [] })
      break
    case 'new_session':
      isStreaming = false
      queuedMessageCount = 0
      response({ cancelled: false })
      break
    case 'never':
      break
    case 'crash':
      process.exit(17)
      break
    case 'malformed_once':
      process.stdout.write('not-json\n')
      response()
      break
    case 'malformed_three':
      process.stdout.write('bad-1\nbad-2\nbad-3\n')
      break
    case 'get_test_env':
      response({ value: process.env.OMP_TEST_ENV })
      break
    case 'delayed':
      setTimeout(() => response({ value: command.value }), command.delay)
      break
    default:
      response()
  }
})

lines.on('close', () => process.exit(0))
