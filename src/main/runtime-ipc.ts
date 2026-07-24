import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import type {
  DesktopResult,
  ExtensionUiResponse,
  ModelSelection,
  OmpEvent,
  PromptInput,
  RuntimeEvent,
  RuntimeError,
  RuntimeSnapshot,
  ProviderLoginState,
  WorkspaceActivation,
  WorkspaceSummary
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { DesktopStateStore } from './desktop-state'
import { validateExternalUrl } from './external-url'
import { redactRuntimeLog } from './runtime-diagnostics'
import { RuntimeFailure } from './runtime-supervisor'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { log } from './logger'
import {
  findContextCandidates,
  getSessionDirectory,
  listWorkspaceSessions,
  sessionUriPage,
  validateWorkspaceReference
} from './session-catalog'

type WindowGetter = () => BrowserWindow | null

function success<T>(data: T): DesktopResult<T> {
  return { ok: true, data }
}

function runtimeError(error: unknown): RuntimeError {
  return error instanceof RuntimeFailure
    ? error.toJSON()
    : {
        code: 'CRASHED' as const,
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      }
}

function failure<T>(error: unknown): DesktopResult<T> {
  return { ok: false, error: runtimeError(error) }
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
  if (
    record['references'] !== undefined &&
    !Array.isArray(record['references'])
  ) {
    throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 引用无效', false)
  }
  if (Array.isArray(record['references'])) {
    for (const reference of record['references']) {
      if (
        !reference ||
        typeof reference !== 'object' ||
        Array.isArray(reference)
      )
        throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 引用无效', false)
      const candidate = reference as Record<string, unknown>
      if (
        typeof candidate['id'] !== 'string' ||
        typeof candidate['name'] !== 'string' ||
        (candidate['kind'] !== 'file' &&
          candidate['kind'] !== 'folder' &&
          candidate['kind'] !== 'session')
      )
        throw new RuntimeFailure('INVALID_ARGUMENT', 'Prompt 引用无效', false)
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeLoginText(
  value: unknown,
  maxLength = 600
): string | undefined {
  if (typeof value !== 'string') return undefined
  const withoutUrls = value.replace(/https?:\/\/\S+/giu, '[链接已隐藏]')
  return redactRuntimeLog(withoutUrls, maxLength).trim() || undefined
}

function loginFailure(error: unknown): RuntimeFailure {
  const raw = error instanceof Error ? error.message : String(error)
  if (/requires interactive prompts|terminal ui/iu.test(raw)) {
    return new RuntimeFailure(
      'UNSUPPORTED',
      '该 Provider 需要在 OMP Terminal 登录',
      false
    )
  }
  if (/timed?\s*out|timeout/iu.test(raw)) {
    return new RuntimeFailure('RPC_TIMEOUT', '登录输入超时', true)
  }
  if (/cancel/iu.test(raw)) {
    return new RuntimeFailure('INVALID_ARGUMENT', '登录已取消', true)
  }
  const detail = sanitizeLoginText(raw, 240)
  return new RuntimeFailure(
    'INVALID_ARGUMENT',
    detail ? `授权失败：${detail}` : '授权失败',
    true
  )
}

function validateModelSelection(value: unknown): ModelSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeFailure('INVALID_ARGUMENT', '模型参数无效', false)
  }
  const record = value as Record<string, unknown>
  if (
    typeof record['provider'] !== 'string' ||
    typeof record['modelId'] !== 'string' ||
    (record['thinkingLevel'] !== undefined &&
      typeof record['thinkingLevel'] !== 'string')
  ) {
    throw new RuntimeFailure('INVALID_ARGUMENT', '模型参数无效', false)
  }
  return {
    provider: record['provider'],
    modelId: record['modelId'],
    ...(typeof record['thinkingLevel'] === 'string'
      ? { thinkingLevel: record['thinkingLevel'] }
      : {})
  }
}

export function registerRuntimeIpc(
  supervisor: RuntimeSupervisor,
  stateStore: DesktopStateStore,
  getWindow: WindowGetter,
  developmentUrl?: string
): () => void {
  const pendingExtensionUi = new Map<
    string,
    { event: OmpEvent; timer?: NodeJS.Timeout }
  >()
  let eventBatch: OmpEvent[] = []
  let eventBatchBytes = 0
  let eventBatchTimer: NodeJS.Timeout | null = null
  const pendingToolProgress = new Map<
    string,
    { event: OmpEvent; timer: NodeJS.Timeout }
  >()
  const lastToolProgressAt = new Map<string, number>()
  let providerLoginState: ProviderLoginState = { status: 'idle' }
  let activeLoginTask: Promise<void> | null = null
  let activeLoginProviderId: string | null = null
  let loginCancellationRequested = false
  let loginInputTimedOut = false
  let providerLoginUrl: URL | null = null
  let hostUriRegistered = false
  let hostUriRegistration: Promise<void> | null = null
  let contextSearch: AbortController | null = null
  let activatingWorkspacePath: string | null = null
  const channels = [
    IPC_CHANNELS.chooseWorkspace,
    IPC_CHANNELS.getWorkspaces,
    IPC_CHANNELS.activateWorkspace,
    IPC_CHANNELS.setWorkspacePinned,
    IPC_CHANNELS.removeWorkspace,
    IPC_CHANNELS.listSessions,
    IPC_CHANNELS.setSessionPinned,
    IPC_CHANNELS.setSessionArchived,
    IPC_CHANNELS.renameSession,
    IPC_CHANNELS.deleteSession,
    IPC_CHANNELS.getContextCandidates,
    IPC_CHANNELS.cancelPendingModelSelection,
    IPC_CHANNELS.cancelProviderLogin,
    IPC_CHANNELS.getAvailableModels,
    IPC_CHANNELS.getLoginProviders,
    IPC_CHANNELS.getProviderLoginState,
    IPC_CHANNELS.getMessages,
    IPC_CHANNELS.getRuntimeState,
    IPC_CHANNELS.restartRuntime,
    IPC_CHANNELS.prompt,
    IPC_CHANNELS.followUp,
    IPC_CHANNELS.stopCurrentRun,
    IPC_CHANNELS.newSession,
    IPC_CHANNELS.createSession,
    IPC_CHANNELS.openRuntimeLog,
    IPC_CHANNELS.switchSession,
    IPC_CHANNELS.loginProvider,
    IPC_CHANNELS.reopenProviderLoginUrl,
    IPC_CHANNELS.selectModel,
    IPC_CHANNELS.setThinkingLevel,
    IPC_CHANNELS.respondExtensionUi,
    IPC_CHANNELS.revealPath
  ]

  const send = (event: RuntimeEvent): void => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.event, event)
  }

  const setProviderLoginState = (state: ProviderLoginState): void => {
    providerLoginState = state
    send({ type: 'provider-login', state })
  }

  const onSnapshot = (snapshot: RuntimeSnapshot): void => {
    if (
      activatingWorkspacePath &&
      snapshot.workspacePath !== activatingWorkspacePath
    )
      return
    if (snapshot.status === 'failed' || snapshot.status === 'stopped') {
      clearPendingExtensionUi()
      hostUriRegistered = false
    }
    if (snapshot.status === 'ready' && !hostUriRegistered)
      void ensureHostUriRegistered()
    send({ type: 'snapshot', snapshot })
  }

  const ensureHostUriRegistered = async (): Promise<void> => {
    if (hostUriRegistered) return
    if (hostUriRegistration) return hostUriRegistration
    hostUriRegistration = supervisor
      .setHostUriSchemes()
      .then(() => {
        hostUriRegistered = true
      })
      .catch((error: unknown) => {
        log.warn('注册 omp-session Host URI 失败', error)
      })
      .finally(() => {
        hostUriRegistration = null
      })
    return hostUriRegistration
  }

  const assertSwitchAllowed = (): void => {
    if (activatingWorkspacePath) {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Workspace 正在启动，请稍候',
        true
      )
    }
    if (
      supervisor.snapshot.isStreaming ||
      supervisor.snapshot.queuedMessageCount > 0 ||
      pendingExtensionUi.size > 0
    ) {
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '任务、Follow-up 或交互仍在进行，请先 Stop',
        true
      )
    }
  }

  const activeWorkspace = () => {
    const id = stateStore.state.activeWorkspaceId
    if (!id)
      throw new RuntimeFailure('INVALID_ARGUMENT', '尚未选择 Workspace', false)
    try {
      return stateStore.requireWorkspace(id)
    } catch {
      throw new RuntimeFailure(
        'WORKSPACE_UNAVAILABLE',
        'Workspace 不存在',
        false
      )
    }
  }

  const requireWorkspace = (id: unknown) => {
    if (typeof id !== 'string')
      throw new RuntimeFailure('INVALID_ARGUMENT', 'Workspace ID 无效', false)
    try {
      return stateStore.requireWorkspace(id)
    } catch {
      throw new RuntimeFailure(
        'WORKSPACE_UNAVAILABLE',
        'Workspace 不存在',
        false
      )
    }
  }

  const sessionsForWorkspace = async (workspaceId: string) => {
    const workspace = requireWorkspace(workspaceId)
    return listWorkspaceSessions(workspace.id, workspace.path)
  }

  const materializePrompt = async (
    input: PromptInput
  ): Promise<PromptInput> => {
    const references = input.references ?? []
    if (references.length === 0)
      return {
        message: input.message,
        ...(input.images ? { images: input.images } : {})
      }
    const workspace = activeWorkspace()
    const additions: string[] = []
    const seen = new Set<string>()
    for (const reference of references) {
      if (seen.has(reference.id)) continue
      seen.add(reference.id)
      try {
        if (reference.kind === 'session') {
          if (!reference.sessionId) continue
          const { session } = await requireSession(
            workspace.id,
            reference.sessionId
          )
          additions.push(
            `[Session: ${reference.name}](omp-session://${workspace.id}/${session.id})`
          )
          continue
        }
        if (!reference.relativePath) continue
        await validateWorkspaceReference(workspace.path, reference.relativePath)
        const path = /\s/u.test(reference.relativePath)
          ? JSON.stringify(reference.relativePath)
          : reference.relativePath
        additions.push(`@${path}`)
      } catch {
        // 选择后失效的引用只跳过，不阻塞仍有效的文字和引用。
      }
    }
    const message = [input.message.trim(), ...additions]
      .filter(Boolean)
      .join('\n\n')
    if (!message && !input.images?.length)
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        '引用已失效，没有可发送的内容',
        false
      )
    return { message, ...(input.images ? { images: input.images } : {}) }
  }

  const requireSession = async (workspaceId: string, sessionId: string) => {
    const workspace = requireWorkspace(workspaceId)
    const sessions = await listWorkspaceSessions(workspace.id, workspace.path)
    const session = sessions.find((item) => item.id === sessionId)
    if (!session)
      throw new RuntimeFailure('SESSION_NOT_FOUND', 'Session 不存在', false)
    if (
      session.compatibility === 'corrupt' ||
      session.compatibility === 'future' ||
      !session.header
    )
      throw new RuntimeFailure(
        'SESSION_INCOMPATIBLE',
        'Session 已损坏或版本不兼容',
        false
      )
    const [workspacePath, sessionCwd] = await Promise.all([
      import('node:fs/promises').then(({ realpath }) =>
        realpath(workspace.path)
      ),
      import('node:fs/promises').then(({ realpath }) =>
        realpath(session.header!.cwd)
      )
    ])
    if (workspacePath !== sessionCwd)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 不属于当前 Workspace',
        false
      )
    return { workspace, session }
  }

  const workspaceSummary = (
    workspaceId: string,
    available = true
  ): WorkspaceSummary => {
    const overview = stateStore.overview(new Map([[workspaceId, available]]), 0)
    const workspace = overview.workspaces.find(
      (item) => item.id === workspaceId
    )
    if (!workspace)
      throw new RuntimeFailure(
        'WORKSPACE_UNAVAILABLE',
        'Workspace 不存在',
        false
      )
    return workspace
  }

  const activateWorkspaceRuntime = (
    workspace: ReturnType<typeof requireWorkspace>,
    startedAt = performance.now()
  ): RuntimeSnapshot => {
    const startingSnapshot: RuntimeSnapshot = {
      status: 'starting',
      workspacePath: workspace.path,
      isStreaming: false,
      isAuthenticating: false,
      queuedMessageCount: 0
    }
    activatingWorkspacePath = workspace.path
    send({ type: 'snapshot', snapshot: startingSnapshot })

    void (async () => {
      try {
        try {
          if (
            supervisor.snapshot.status === 'ready' &&
            supervisor.snapshot.workspacePath === workspace.path
          )
            await supervisor.getState()
          else await supervisor.start(workspace.path)
          log.info('performance', {
            event: 'workspace_activation_to_runtime_ready',
            elapsedMs: Math.round(performance.now() - startedAt)
          })
        } catch (error) {
          log.warn('Workspace Runtime 启动失败', error)
          if (
            supervisor.snapshot.workspacePath !== workspace.path ||
            supervisor.snapshot.status !== 'failed'
          ) {
            send({
              type: 'snapshot',
              snapshot: {
                ...startingSnapshot,
                status: 'failed',
                error: runtimeError(error)
              }
            })
          }
          return
        }

        if (workspace.activeSessionId) {
          try {
            const { session } = await requireSession(
              workspace.id,
              workspace.activeSessionId
            )
            supervisor.trustSession(session.id, session.path)
            await supervisor.switchSession(session.id)
          } catch (error) {
            log.warn('恢复 Workspace 的活动 Session 失败', error)
            send({
              type: 'workspace-activation-failed',
              error: runtimeError(error)
            })
          }
        }
      } finally {
        if (activatingWorkspacePath === workspace.path)
          activatingWorkspacePath = null
      }
    })()

    return startingSnapshot
  }

  const respondHostUri = async (event: OmpEvent): Promise<void> => {
    const id = event['id']
    try {
      if (
        typeof id !== 'string' ||
        event['operation'] !== 'read' ||
        typeof event['url'] !== 'string'
      )
        throw new Error('Host URI 请求无效')
      const url = new URL(event['url'])
      if (url.protocol !== 'omp-session:')
        throw new Error('Host URI scheme 不支持')
      const workspace = activeWorkspace()
      if (url.hostname !== workspace.id)
        throw new Error('只能读取当前 Workspace 的 Session')
      const sessionId = decodeURIComponent(url.pathname.replace(/^\/+/u, ''))
      const { session } = await requireSession(workspace.id, sessionId)
      const cursorText = url.searchParams.get('cursor')
      const cursor = cursorText ? Number(cursorText) : undefined
      if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1))
        throw new Error('Session 分页游标无效')
      const page = sessionUriPage(session, cursor)
      const notes = page.previousCursor
        ? [
            `更早内容：omp-session://${workspace.id}/${session.id}?cursor=${page.previousCursor}`
          ]
        : undefined
      supervisor.sendFrame({
        type: 'host_uri_result',
        id,
        content: page.content,
        contentType: 'text/markdown',
        immutable: false,
        ...(notes ? { notes } : {})
      })
    } catch (error) {
      if (typeof id !== 'string') return
      supervisor.sendFrame({
        type: 'host_uri_result',
        id,
        isError: true,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const flushEventBatch = (): void => {
    if (eventBatchTimer) clearTimeout(eventBatchTimer)
    eventBatchTimer = null
    if (eventBatch.length === 0) return
    const events = eventBatch
    eventBatch = []
    eventBatchBytes = 0
    send({ type: 'omp-event-batch', events })
  }

  const queueBatchEvent = (event: OmpEvent): void => {
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (bytes > 256 * 1024) {
      flushEventBatch()
      send({ type: 'omp-event-batch', events: [event] })
      return
    }
    if (eventBatch.length >= 100 || eventBatchBytes + bytes > 256 * 1024) {
      flushEventBatch()
    }
    eventBatch.push(event)
    eventBatchBytes += bytes
    if (eventBatch.length >= 100 || eventBatchBytes >= 256 * 1024) {
      flushEventBatch()
      return
    }
    eventBatchTimer ??= setTimeout(flushEventBatch, 24)
  }

  const clearToolProgress = (toolCallId: string): void => {
    const pending = pendingToolProgress.get(toolCallId)
    if (pending) clearTimeout(pending.timer)
    pendingToolProgress.delete(toolCallId)
    lastToolProgressAt.delete(toolCallId)
  }

  const queueToolProgress = (event: OmpEvent): void => {
    const toolCallId = event['toolCallId']
    if (typeof toolCallId !== 'string') {
      queueBatchEvent(event)
      return
    }
    const existing = pendingToolProgress.get(toolCallId)
    if (existing) {
      existing.event = event
      return
    }
    const elapsed = Date.now() - (lastToolProgressAt.get(toolCallId) ?? 0)
    if (elapsed >= 100) {
      lastToolProgressAt.set(toolCallId, Date.now())
      queueBatchEvent(event)
      return
    }
    const timer = setTimeout(() => {
      const pending = pendingToolProgress.get(toolCallId)
      if (!pending) return
      pendingToolProgress.delete(toolCallId)
      lastToolProgressAt.set(toolCallId, Date.now())
      queueBatchEvent(pending.event)
    }, 100 - elapsed)
    pendingToolProgress.set(toolCallId, { event, timer })
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
      void respondHostUri(event)
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
        if (!url) return
        if (activeLoginTask) {
          providerLoginUrl = url
          setProviderLoginState({
            status: 'opening-browser',
            providerId: activeLoginProviderId ?? undefined,
            message: '已打开系统浏览器',
            instructions: sanitizeLoginText(event['instructions']),
            canReopenBrowser: true
          })
        }
        void shell.openExternal(url.toString()).catch((error: unknown) => {
          log.error('打开 Extension URL 失败', error)
          if (activeLoginTask) {
            setProviderLoginState({
              status: 'opening-browser',
              providerId: activeLoginProviderId ?? undefined,
              message: '无法打开系统浏览器',
              instructions: sanitizeLoginText(event['instructions']),
              canReopenBrowser: true
            })
          }
        })
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
                send({
                  type: 'omp-event',
                  event: {
                    type: 'extension_ui_resolved',
                    id: requestId,
                    timedOut: true
                  }
                })
                if (activeLoginTask) {
                  loginInputTimedOut = true
                  setProviderLoginState({
                    status: 'failed',
                    providerId: activeLoginProviderId ?? undefined,
                    message: '登录输入超时',
                    canReopenBrowser: providerLoginUrl !== null
                  })
                }
              }, event['timeout'])
            : undefined
        pendingExtensionUi.set(requestId, { event, timer: timeout })
        if (method === 'input' && activeLoginTask) {
          setProviderLoginState({
            status: 'waiting-input',
            providerId: activeLoginProviderId ?? undefined,
            input: {
              id: requestId,
              message:
                sanitizeLoginText(event['message'], 240) ?? '请输入授权信息',
              placeholder: sanitizeLoginText(event['placeholder'], 120)
            },
            canReopenBrowser: providerLoginUrl !== null
          })
          return
        }
      } else if (method === 'notify' && activeLoginTask) {
        setProviderLoginState({
          status: 'progress',
          providerId: activeLoginProviderId ?? undefined,
          message: sanitizeLoginText(event['message'], 240) ?? '正在处理授权',
          canReopenBrowser: providerLoginUrl !== null
        })
        return
      } else {
        return
      }
    }

    if (event.type === 'tool_execution_update') {
      queueToolProgress(event)
      return
    }
    if (event.type === 'tool_execution_end') {
      const toolCallId = event['toolCallId']
      if (typeof toolCallId === 'string') clearToolProgress(toolCallId)
    }
    if (event.type === 'message_update' || event.type === 'thinking_delta') {
      queueBatchEvent(event)
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
      const currentWorkspacePath = supervisor.snapshot.workspacePath
      const result = await dialog.showOpenDialog(window, {
        ...(currentWorkspacePath
          ? { defaultPath: dirname(currentWorkspacePath) }
          : {}),
        properties: ['openDirectory', 'createDirectory']
      })
      const workspacePath = result.filePaths[0]
      if (result.canceled || !workspacePath) return success(null)
      const selectedAt = performance.now()
      if (workspacePath !== supervisor.snapshot.workspacePath)
        assertSwitchAllowed()
      const workspace = await stateStore.addWorkspace(workspacePath)
      const snapshot: RuntimeSnapshot =
        supervisor.snapshot.status === 'ready' &&
        supervisor.snapshot.workspacePath === workspace.path
          ? supervisor.snapshot
          : activateWorkspaceRuntime(workspace, selectedAt)
      const activation: WorkspaceActivation = {
        workspace: workspaceSummary(workspace.id),
        snapshot
      }
      log.info('performance', {
        event: 'workspace_selected_to_ipc_response',
        elapsedMs: Math.round(performance.now() - selectedAt)
      })
      return success(activation)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.getWorkspaces,
    async (event, offsetValue: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const offset =
          typeof offsetValue === 'number' &&
          Number.isInteger(offsetValue) &&
          offsetValue >= 0
            ? offsetValue
            : 0
        const availability = new Map<string, boolean>()
        await Promise.all(
          stateStore.state.workspaces.map(async (workspace) => {
            const info = await stat(workspace.path).catch(() => null)
            availability.set(workspace.id, info?.isDirectory() === true)
          })
        )
        return success(stateStore.overview(availability, offset))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.activateWorkspace,
    async (event, workspaceId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(workspaceId)
        if (workspace.path !== supervisor.snapshot.workspacePath)
          assertSwitchAllowed()
        await stateStore.activateWorkspace(workspace.id)
        const snapshot =
          supervisor.snapshot.status === 'ready' &&
          supervisor.snapshot.workspacePath === workspace.path
            ? supervisor.snapshot
            : activateWorkspaceRuntime(workspace)
        return success(snapshot)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setWorkspacePinned,
    async (event, workspaceId: unknown, pinned: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(workspaceId)
        if (typeof pinned !== 'boolean')
          throw new RuntimeFailure('INVALID_ARGUMENT', '置顶状态无效', false)
        await stateStore.setWorkspacePinned(workspace.id, pinned)
        const availability = new Map(
          stateStore.state.workspaces.map((item) => [item.id, true])
        )
        return success(stateStore.overview(availability))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.removeWorkspace,
    async (event, workspaceId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(workspaceId)
        if (workspace.id === stateStore.state.activeWorkspaceId) {
          assertSwitchAllowed()
          await supervisor.stop()
        }
        await stateStore.removeWorkspace(workspace.id)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.listSessions,
    async (
      event,
      workspaceId: unknown,
      offsetValue: unknown,
      queryValue: unknown
    ) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(workspaceId)
        const offset =
          typeof offsetValue === 'number' &&
          Number.isInteger(offsetValue) &&
          offsetValue >= 0
            ? offsetValue
            : 0
        const query =
          typeof queryValue === 'string'
            ? queryValue.trim().toLocaleLowerCase()
            : ''
        const all = (await sessionsForWorkspace(workspace.id))
          .filter(
            (session) =>
              !query ||
              session.searchableText.toLocaleLowerCase().includes(query)
          )
          .map((session) => stateStore.applyPreferences(workspace.id, session))
        const page = all.slice(offset, offset + 50)
        return success({
          sessions: page,
          hasMore: offset + page.length < all.length,
          nextOffset: offset + page.length
        })
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setSessionPinned,
    async (
      event,
      workspaceId: unknown,
      sessionId: unknown,
      pinned: unknown
    ) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string' || typeof pinned !== 'boolean')
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Session 置顶参数无效',
            false
          )
        requireWorkspace(workspaceId)
        await stateStore.updateSessionPreference(
          workspaceId as string,
          sessionId,
          {
            pinned,
            ...(pinned ? { archived: false } : {})
          }
        )
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setSessionArchived,
    async (
      event,
      workspaceId: unknown,
      sessionId: unknown,
      archived: unknown
    ) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string' || typeof archived !== 'boolean')
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Session 归档参数无效',
            false
          )
        const workspace = requireWorkspace(workspaceId)
        if (
          archived &&
          workspace.activeSessionId === sessionId &&
          supervisor.snapshot.sessionId === sessionId
        )
          throw new RuntimeFailure(
            'RUNTIME_NOT_READY',
            '请先切换到其他会话再归档当前会话',
            true
          )
        await stateStore.updateSessionPreference(workspace.id, sessionId, {
          archived,
          ...(archived ? { pinned: false } : {})
        })
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.renameSession,
    async (event, workspaceId: unknown, sessionId: unknown, title: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string' || typeof title !== 'string')
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Session 重命名参数无效',
            false
          )
        assertSwitchAllowed()
        const { workspace, session } = await requireSession(
          String(workspaceId),
          sessionId
        )
        if (stateStore.state.activeWorkspaceId !== workspace.id)
          throw new RuntimeFailure(
            'WORKSPACE_UNAVAILABLE',
            '只能重命名当前 Workspace 的 Session',
            false
          )
        if (supervisor.snapshot.sessionId !== sessionId) {
          supervisor.trustSession(session.id, session.path)
          await supervisor.switchSession(session.id)
          await stateStore.setActiveSession(workspace.id, session.id)
        }
        await supervisor.setSessionName(title)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.deleteSession,
    async (event, workspaceId: unknown, sessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string')
          throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
        assertSwitchAllowed()
        const workspace = requireWorkspace(workspaceId)
        const session = (await sessionsForWorkspace(workspace.id)).find(
          (item) => item.id === sessionId
        )
        if (!session)
          throw new RuntimeFailure('SESSION_NOT_FOUND', 'Session 不存在', false)
        if (supervisor.snapshot.sessionId === sessionId)
          throw new RuntimeFailure(
            'RUNTIME_NOT_READY',
            '请先切换到其他会话再删除当前会话',
            true
          )
        const child = relative(
          getSessionDirectory(workspace.path),
          session.path
        )
        if (child.startsWith(`..${sep}`) || child === '..')
          throw new RuntimeFailure(
            'SESSION_NOT_FOUND',
            'Session 文件路径不受信任',
            false
          )
        await shell.trashItem(session.path)
        await stateStore.removeSessionPreference(workspace.id, session.id)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.getContextCandidates,
    async (event, workspaceId: unknown, queryValue: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = requireWorkspace(workspaceId)
        const query = typeof queryValue === 'string' ? queryValue : ''
        contextSearch?.abort()
        contextSearch = new AbortController()
        const sessions = (await sessionsForWorkspace(workspace.id)).filter(
          (session) =>
            session.id !== supervisor.snapshot.sessionId &&
            !stateStore.sessionPreference(workspace.id, session.id).archived
        )
        return success(
          await findContextCandidates(
            workspace.path,
            query,
            sessions,
            contextSearch.signal
          )
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return success([])
        return failure(error)
      }
    }
  )

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

  ipcMain.handle(IPC_CHANNELS.getLoginProviders, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.getLoginProviders())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getAvailableModels, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.getAvailableModels())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getProviderLoginState, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(providerLoginState)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.loginProvider,
    async (event, providerId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof providerId !== 'string' || !providerId.trim()) {
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Provider ID 无效',
            false
          )
        }
        if (activeLoginTask) {
          throw new RuntimeFailure(
            'RUNTIME_NOT_READY',
            '已有 Provider 正在登录',
            true
          )
        }
        activeLoginProviderId = providerId
        loginCancellationRequested = false
        loginInputTimedOut = false
        providerLoginUrl = null
        setProviderLoginState({
          status: 'starting',
          providerId,
          message: '正在启动登录'
        })
        activeLoginTask = supervisor.loginProvider(providerId)
        try {
          await activeLoginTask
          setProviderLoginState({ status: 'idle' })
          return success(undefined)
        } catch (error) {
          if (loginInputTimedOut) {
            const timedOut = new RuntimeFailure(
              'RPC_TIMEOUT',
              '登录输入超时',
              true
            )
            setProviderLoginState({
              status: 'failed',
              providerId,
              message: timedOut.message,
              canReopenBrowser: providerLoginUrl !== null
            })
            return failure(timedOut)
          }
          if (loginCancellationRequested) {
            setProviderLoginState({ status: 'idle' })
            return failure(
              new RuntimeFailure('INVALID_ARGUMENT', '登录已取消', true)
            )
          }
          const diagnostic = sanitizeLoginText(
            error instanceof Error ? error.message : String(error),
            2_048
          )
          if (diagnostic) {
            supervisor.recordDiagnostic(
              `Provider 登录失败 (${providerId}): ${diagnostic}`
            )
          }
          const mapped = loginFailure(error)
          log.warn('登录 Provider 失败', {
            providerId,
            message: mapped.message
          })
          setProviderLoginState({
            status: 'failed',
            providerId,
            message: mapped.message,
            canReopenBrowser: providerLoginUrl !== null
          })
          return failure(mapped)
        } finally {
          activeLoginTask = null
          activeLoginProviderId = null
          loginCancellationRequested = false
          loginInputTimedOut = false
          if (providerLoginState.status === 'idle') providerLoginUrl = null
        }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.cancelProviderLogin, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const task = activeLoginTask
      if (!task) {
        setProviderLoginState({ status: 'idle' })
        return success(undefined)
      }
      loginCancellationRequested = true
      setProviderLoginState({
        status: 'cancelling',
        providerId: activeLoginProviderId ?? undefined,
        message: '正在取消登录'
      })
      cancelPendingExtensionUi()
      const settled = await Promise.race([
        task.then(
          () => true,
          () => true
        ),
        delay(5_000).then(() => false)
      ])
      if (!settled) await supervisor.restart()
      setProviderLoginState({ status: 'idle' })
      providerLoginUrl = null
      return success(undefined)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.reopenProviderLoginUrl, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      if (!providerLoginUrl) {
        throw new RuntimeFailure(
          'INVALID_ARGUMENT',
          '当前没有可重新打开的授权页面',
          false
        )
      }
      await shell.openExternal(providerLoginUrl.toString())
      return success(true)
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
      await supervisor.prompt(
        await materializePrompt(validatePromptInput(value))
      )
      return success(undefined)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.followUp, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      await supervisor.followUp(
        await materializePrompt(validatePromptInput(value))
      )
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
      assertSwitchAllowed()
      return success(await supervisor.newSession())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.createSession,
    async (event, value: unknown, titleValue: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        assertSwitchAllowed()
        const rawInput = validatePromptInput(value)
        const input = await materializePrompt(rawInput)
        const title =
          typeof titleValue === 'string' ? titleValue.trim() : rawInput.message
        const workspace = activeWorkspace()
        await supervisor.newSession()
        await supervisor.prompt(input)
        const snapshot = await supervisor.getState()
        if (!snapshot.sessionId)
          throw new RuntimeFailure(
            'PROTOCOL_ERROR',
            'OMP 未返回新 Session ID',
            true
          )
        await stateStore
          .setActiveSession(workspace.id, snapshot.sessionId)
          .catch((error: unknown) =>
            log.warn('保存新 Session 管理状态失败', error)
          )
        await supervisor
          .setSessionName(title || '图片会话')
          .catch((error: unknown) =>
            log.warn('自动设置 Session 标题失败', error)
          )
        const { session } = await requireSession(
          workspace.id,
          snapshot.sessionId
        )
        return success({
          snapshot,
          session: stateStore.applyPreferences(workspace.id, session)
        })
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.switchSession,
    async (event, sessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string') {
          throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
        }
        assertSwitchAllowed()
        const workspace = activeWorkspace()
        const { session } = await requireSession(workspace.id, sessionId)
        supervisor.trustSession(session.id, session.path)
        const snapshot = await supervisor.switchSession(sessionId)
        await stateStore.setActiveSession(workspace.id, sessionId)
        return success(snapshot)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.selectModel, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(
        await supervisor.selectModel(validateModelSelection(value))
      )
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.cancelPendingModelSelection, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(supervisor.cancelPendingModelSelection())
    } catch (error) {
      return failure(error)
    }
  })

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
        send({
          type: 'omp-event',
          event: { type: 'extension_ui_resolved', id }
        })
        if (activeLoginTask) {
          setProviderLoginState({
            status: 'progress',
            providerId: activeLoginProviderId ?? undefined,
            message: '正在验证授权信息',
            canReopenBrowser: providerLoginUrl !== null
          })
        }
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
    if (providerLoginState.status !== 'idle') {
      send({ type: 'provider-login', state: providerLoginState })
    }
    for (const pending of pendingExtensionUi.values()) {
      if (
        activeLoginTask &&
        pending.event.type === 'extension_ui_request' &&
        pending.event['method'] === 'input'
      ) {
        continue
      }
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
    for (const toolCallId of pendingToolProgress.keys()) {
      clearToolProgress(toolCallId)
    }
    ipcMain.off(IPC_CHANNELS.rendererReady, replayPending)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
