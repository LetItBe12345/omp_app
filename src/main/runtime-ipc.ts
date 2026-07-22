import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  DesktopResult,
  ExtensionUiResponse,
  OmpEvent,
  PromptInput,
  RuntimeEvent,
  RuntimeSnapshot
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { validateExternalUrl } from './external-url'
import { RuntimeFailure } from './runtime-supervisor'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { log } from './logger'

type WindowGetter = () => BrowserWindow | null

function success<T>(data: T): DesktopResult<T> {
  return { ok: true, data }
}

function failure<T>(error: unknown): DesktopResult<T> {
  const runtimeError =
    error instanceof RuntimeFailure
      ? error.toJSON()
      : {
          code: 'CRASHED' as const,
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        }
  return { ok: false, error: runtimeError }
}

function isTrustedSender(
  event: IpcMainInvokeEvent,
  getWindow: WindowGetter,
  developmentUrl?: string
): boolean {
  const window = getWindow()
  if (!window || window.isDestroyed()) return false
  if (event.sender !== window.webContents) return false
  if (event.senderFrame !== window.webContents.mainFrame) return false

  const frameUrl = event.senderFrame.url
  if (developmentUrl) {
    try {
      return new URL(frameUrl).origin === new URL(developmentUrl).origin
    } catch {
      return false
    }
  }
  return frameUrl.startsWith('file://')
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  getWindow: WindowGetter,
  developmentUrl?: string
): void {
  if (!isTrustedSender(event, getWindow, developmentUrl)) {
    throw new RuntimeFailure('UNSUPPORTED', 'IPC 调用来源不受信任', false)
  }
}

function validatePromptInput(value: unknown): PromptInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 参数无效', false)
  }
  const record = value as Record<string, unknown>
  if (typeof record['message'] !== 'string') {
    throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 文本无效', false)
  }
  if (Buffer.byteLength(record['message'], 'utf8') > 1024 * 1024) {
    throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 文本过大', false)
  }
  if (record['images'] !== undefined && !Array.isArray(record['images'])) {
    throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 图片无效', false)
  }
  if (Array.isArray(record['images'])) {
    let totalBytes = 0
    for (const image of record['images']) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) {
        throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 图片无效', false)
      }
      const candidate = image as Record<string, unknown>
      if (
        candidate['type'] !== 'image' ||
        typeof candidate['data'] !== 'string' ||
        typeof candidate['mimeType'] !== 'string'
      ) {
        throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 图片无效', false)
      }
      totalBytes += Buffer.byteLength(candidate['data'], 'utf8')
    }
    if (totalBytes > 12 * 1024 * 1024) {
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        'Prompt 图片总大小过大',
        false
      )
    }
  }
  return value as PromptInput
}

function isExtensionUiResponse(value: unknown): value is ExtensionUiResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return (
    typeof response['value'] === 'string' ||
    typeof response['confirmed'] === 'boolean' ||
    response['cancelled'] === true
  )
}

export function registerRuntimeIpc(
  supervisor: RuntimeSupervisor,
  getWindow: WindowGetter,
  developmentUrl?: string
): () => void {
  const pendingExtensionUi = new Map<
    string,
    { event: OmpEvent; timer?: NodeJS.Timeout }
  >()
  let eventBatch: OmpEvent[] = []
  let eventBatchTimer: NodeJS.Timeout | null = null
  const channels = [
    IPC_CHANNELS.chooseWorkspace,
    IPC_CHANNELS.getMessages,
    IPC_CHANNELS.getRuntimeState,
    IPC_CHANNELS.restartRuntime,
    IPC_CHANNELS.prompt,
    IPC_CHANNELS.followUp,
    IPC_CHANNELS.stopCurrentRun,
    IPC_CHANNELS.newSession,
    IPC_CHANNELS.openRuntimeLog,
    IPC_CHANNELS.switchSession,
    IPC_CHANNELS.setModel,
    IPC_CHANNELS.setThinkingLevel,
    IPC_CHANNELS.respondExtensionUi,
    IPC_CHANNELS.revealPath
  ]

  const send = (event: RuntimeEvent): void => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.event, event)
  }

  const onSnapshot = (snapshot: RuntimeSnapshot): void => {
    if (snapshot.status === 'failed' || snapshot.status === 'stopped') {
      clearPendingExtensionUi()
    }
    send({ type: 'snapshot', snapshot })
  }

  const flushEventBatch = (): void => {
    if (eventBatchTimer) clearTimeout(eventBatchTimer)
    eventBatchTimer = null
    if (eventBatch.length === 0) return
    const events = eventBatch
    eventBatch = []
    send({ type: 'omp-event-batch', events })
  }

  const deletePendingExtensionUi = (id: string): void => {
    const pending = pendingExtensionUi.get(id)
    if (pending?.timer) clearTimeout(pending.timer)
    pendingExtensionUi.delete(id)
  }

  const clearPendingExtensionUi = (): void => {
    for (const id of pendingExtensionUi.keys()) deletePendingExtensionUi(id)
  }

  const cancelPendingExtensionUi = (): void => {
    for (const id of pendingExtensionUi.keys()) {
      try {
        supervisor.sendFrame({
          type: 'extension_ui_response',
          id,
          cancelled: true
        })
      } catch {
        // Runtime 已退出时只需清理宿主侧等待项。
      }
      deletePendingExtensionUi(id)
    }
  }

  const onOmpEvent = (event: OmpEvent): void => {
    if (event.type === 'host_tool_call' && typeof event['id'] === 'string') {
      supervisor.sendFrame({
        type: 'host_tool_result',
        id: event['id'],
        isError: true,
        result: {
          content: [{ type: 'text', text: 'Host Tools are unsupported' }]
        }
      })
      return
    }
    if (event.type === 'host_uri_request' && typeof event['id'] === 'string') {
      supervisor.sendFrame({
        type: 'host_uri_result',
        id: event['id'],
        isError: true,
        error: 'Host URI is unsupported'
      })
      return
    }

    if (
      event.type === 'extension_ui_request' &&
      typeof event['id'] === 'string'
    ) {
      const method = event['method']
      if (method === 'open_url') {
        const rawUrl =
          typeof event['launchUrl'] === 'string'
            ? event['launchUrl']
            : event['url']
        const url =
          typeof rawUrl === 'string' ? validateExternalUrl(rawUrl) : null
        if (url) {
          void shell.openExternal(url.toString()).catch((error: unknown) => {
            log.error('打开 Extension URL 失败', error)
          })
        }
        return
      }
      if (method === 'cancel' && typeof event['targetId'] === 'string') {
        deletePendingExtensionUi(event['targetId'])
      } else if (
        method === 'select' ||
        method === 'confirm' ||
        method === 'input' ||
        method === 'editor'
      ) {
        const requestId = event['id']
        const timeout =
          typeof event['timeout'] === 'number' && event['timeout'] > 0
            ? setTimeout(() => {
                try {
                  supervisor.sendFrame({
                    type: 'extension_ui_response',
                    id: requestId,
                    cancelled: true,
                    timedOut: true
                  })
                } catch {
                  // Runtime 已退出时只清理本地状态。
                }
                deletePendingExtensionUi(requestId)
              }, event['timeout'])
            : undefined
        pendingExtensionUi.set(requestId, { event, timer: timeout })
      } else {
        return
      }
    }

    if (
      event.type === 'message_update' ||
      event.type === 'thinking_delta' ||
      event.type === 'tool_execution_update'
    ) {
      eventBatch.push(event)
      eventBatchTimer ??= setTimeout(flushEventBatch, 24)
      return
    }
    flushEventBatch()
    send({ type: 'omp-event', event })
  }

  supervisor.on('snapshot', onSnapshot)
  supervisor.on('event', onOmpEvent)
  supervisor.on('before-stop', cancelPendingExtensionUi)

  ipcMain.handle(IPC_CHANNELS.chooseWorkspace, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const window = getWindow()
      if (!window) return success(null)
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory']
      })
      const workspacePath = result.filePaths[0]
      if (result.canceled || !workspacePath) return success(null)
      if (
        (supervisor.snapshot.isStreaming ||
          supervisor.snapshot.queuedMessageCount > 0) &&
        workspacePath !== supervisor.snapshot.workspacePath
      ) {
        const confirmation = await dialog.showMessageBox(window, {
          type: 'warning',
          title: '切换 Workspace',
          message: '任务正在运行，仍要切换吗？',
          detail: '切换后任务将停止。',
          buttons: ['继续运行', '切换'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        if (confirmation.response !== 1) return success(null)
        const interrupted = await supervisor.stopCurrentRun()
        if (interrupted) {
          send({
            type: 'omp-event',
            event: { type: 'runtime_interrupted', input: interrupted }
          })
        }
      }
      const snapshot = await supervisor.start(workspacePath)
      return success(snapshot)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getRuntimeState, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(
        supervisor.snapshot.status === 'ready'
          ? await supervisor.getState()
          : supervisor.snapshot
      )
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getMessages, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.getMessages())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.openRuntimeLog, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      shell.showItemInFolder(supervisor.diagnosticsPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC_CHANNELS.restartRuntime, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.restart())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.prompt, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      await supervisor.prompt(validatePromptInput(value))
      return success(undefined)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.followUp, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      await supervisor.followUp(validatePromptInput(value))
      return success(undefined)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.stopCurrentRun, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.stopCurrentRun())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.newSession, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const window = getWindow()
      if (
        window &&
        (supervisor.snapshot.isStreaming ||
          supervisor.snapshot.queuedMessageCount > 0)
      ) {
        const confirmation = await dialog.showMessageBox(window, {
          type: 'warning',
          title: '新建 Session',
          message: '任务正在运行，仍要新建吗？',
          detail: '当前任务将停止。',
          buttons: ['继续运行', '新建'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        if (confirmation.response !== 1) return success(supervisor.snapshot)
        const interrupted = await supervisor.stopCurrentRun()
        if (interrupted) {
          send({
            type: 'omp-event',
            event: { type: 'runtime_interrupted', input: interrupted }
          })
        }
      }
      return success(await supervisor.newSession())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.switchSession,
    async (event, sessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string') {
          throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
        }
        const window = getWindow()
        if (
          window &&
          (supervisor.snapshot.isStreaming ||
            supervisor.snapshot.queuedMessageCount > 0)
        ) {
          const confirmation = await dialog.showMessageBox(window, {
            type: 'warning',
            title: '切换 Session',
            message: '任务正在运行，仍要切换吗？',
            detail: '当前任务将停止。',
            buttons: ['继续运行', '切换'],
            defaultId: 0,
            cancelId: 0,
            noLink: true
          })
          if (confirmation.response !== 1) return success(supervisor.snapshot)
          const interrupted = await supervisor.stopCurrentRun()
          if (interrupted) {
            send({
              type: 'omp-event',
              event: { type: 'runtime_interrupted', input: interrupted }
            })
          }
        }
        return success(await supervisor.switchSession(sessionId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setModel,
    async (event, provider: unknown, modelId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof provider !== 'string' || typeof modelId !== 'string') {
          throw new RuntimeFailure('INVALID_ARGUMENT', '模型参数无效', false)
        }
        await supervisor.setModel(provider, modelId)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setThinkingLevel,
    async (event, level: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof level !== 'string') {
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Thinking 等级无效',
            false
          )
        }
        await supervisor.setThinkingLevel(level)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.respondExtensionUi,
    async (event, id: unknown, response: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (
          typeof id !== 'string' ||
          !pendingExtensionUi.has(id) ||
          !isExtensionUiResponse(response)
        ) {
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Extension UI 响应无效',
            false
          )
        }
        supervisor.sendFrame({ type: 'extension_ui_response', id, ...response })
        deletePendingExtensionUi(id)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.revealPath, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      if (typeof value !== 'string' || !isAbsolute(value)) {
        throw new RuntimeFailure('INVALID_ARGUMENT', '本地路径无效', false)
      }
      const entry = await stat(value).catch(() => null)
      if (!entry) {
        throw new RuntimeFailure('INVALID_ARGUMENT', '本地路径不存在', false)
      }
      if (entry.isDirectory()) {
        const error = await shell.openPath(value)
        if (error) throw new Error(error)
      } else {
        shell.showItemInFolder(value)
      }
      return success(true)
    } catch (error) {
      return failure(error)
    }
  })

  const replayPending = (): void => {
    for (const pending of pendingExtensionUi.values()) {
      send({ type: 'omp-event', event: pending.event })
    }
  }
  ipcMain.on(IPC_CHANNELS.rendererReady, replayPending)

  return () => {
    flushEventBatch()
    supervisor.off('snapshot', onSnapshot)
    supervisor.off('event', onOmpEvent)
    supervisor.off('before-stop', cancelPendingExtensionUi)
    clearPendingExtensionUi()
    ipcMain.off(IPC_CHANNELS.rendererReady, replayPending)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
