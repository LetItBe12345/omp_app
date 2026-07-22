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
let currentModel = { provider: 'test', id: 'fake-model' }
let currentThinkingLevel = 'medium'
let pendingLogin = null

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (process.env.FAKE_NO_MODELS === '1') {
  process.stderr.write('No models available.\n')
  process.exit(1)
} else {
  send({ type: 'ready' })
  send({ type: 'notice', message: 'fake runtime ready' })
}

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
        model: currentModel,
        thinkingLevel: currentThinkingLevel,
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
    case 'emit_agent_end':
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
    case 'get_login_providers':
      response({
        providers: [
          { id: 'test', name: 'Test Provider', available: true },
          { id: 'browser', name: 'Browser Login', available: true },
          { id: 'terminal-only', name: 'Terminal Only', available: true },
          { id: 'disabled', name: 'Disabled Provider', available: false }
        ]
      })
      break
    case 'get_available_models':
      response({
        models: [
          {
            provider: 'test',
            id: 'fake-model',
            name: 'Fake Model',
            reasoning: true,
            thinking: {
              efforts: ['medium', 'high'],
              defaultLevel: 'medium'
            },
            secretField: 'must-not-cross-the-preload-boundary'
          },
          {
            provider: 'test',
            id: 'fast-model',
            name: 'Fast Model',
            reasoning: false
          }
        ]
      })
      break
    case 'set_model':
      if (command.modelId === 'fail-model') {
        send({
          type: 'response',
          id: command.id,
          command: command.type,
          success: false,
          error: 'Model unavailable'
        })
        break
      }
      currentModel = { provider: command.provider, id: command.modelId }
      response()
      break
    case 'set_thinking_level':
      if (command.level === 'fail') {
        send({
          type: 'response',
          id: command.id,
          command: command.type,
          success: false,
          error: 'Thinking level unavailable'
        })
        break
      }
      currentThinkingLevel = command.level
      response()
      break
    case 'login':
      if (command.providerId === 'login-failure') {
        send({
          type: 'response',
          id: command.id,
          command: command.type,
          success: false,
          error:
            'API_KEY=private-login-secret https://example.com/callback?code=secret'
        })
        break
      }
      if (command.providerId === 'terminal-only') {
        send({
          type: 'response',
          id: command.id,
          command: command.type,
          success: false,
          error: 'Provider requires interactive prompts in terminal UI'
        })
        break
      }
      pendingLogin = command
      send({
        type: 'extension_ui_request',
        id: `open-${command.id}`,
        method: 'open_url',
        url: 'https://example.com/oauth?token=fake-secret',
        instructions: '请在浏览器中完成授权'
      })
      send({
        type: 'extension_ui_request',
        id: `input-${command.id}`,
        method: 'input',
        message: '输入授权码',
        placeholder: 'authorization code',
        timeout: 30_000
      })
      break
    case 'extension_ui_response':
      if (!pendingLogin || command.id !== `input-${pendingLogin.id}`) break
      if (command.cancelled) {
        send({
          type: 'response',
          id: pendingLogin.id,
          command: pendingLogin.type,
          success: false,
          error: 'Login cancelled'
        })
      } else {
        send({
          type: 'extension_ui_request',
          id: `notify-${pendingLogin.id}`,
          method: 'notify',
          message: '授权成功'
        })
        send({
          type: 'response',
          id: pendingLogin.id,
          command: pendingLogin.type,
          success: true
        })
      }
      pendingLogin = null
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
