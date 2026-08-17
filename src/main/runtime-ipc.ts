import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ApprovalMode,
  DesktopResult,
  ExtensionUiResponse,
  ModelSelection,
  OmpEvent,
  PromptInput,
  RuntimeEvent,
  RuntimeError,
  RuntimeSnapshot,
  RuntimeNetworkConfig,
  SessionRuntimeState,
  ProviderLoginState,
  WorkspaceActivation,
  WorkspaceSummary
} from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { isApprovalMode } from '../shared/approval-mode'
import type { DesktopStateStore } from './desktop-state'
import { validateExternalUrl } from './external-url'
import { redactRuntimeLog } from './runtime-diagnostics'
import { RuntimeFailure } from './runtime-supervisor'
import type { RuntimeController } from './runtime-pool'
import {
  checkLocalProxyPort,
  RuntimeEnvironmentResolver
} from './runtime-environment'
import { log } from './logger'
import {
  findContextCandidates,
  getSessionDirectory,
  listWorkspaceSessions,
  sessionUriPage,
  validateWorkspaceReference
} from './session-catalog'
import {
  approvalTimeoutMs,
  isToolApprovalRequest,
  publicToolApproval
} from './tool-approval'

type WindowGetter = () => BrowserWindow | null

function success<T>(data: T): DesktopResult<T> {
  return { ok: true, data }
}

export async function resolveLocalPathValue(
  value: unknown,
  workspacePath: string
): Promise<{ path: string; directory: boolean } | null> {
  if (typeof value !== 'string' || value.includes('\0')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(value.trim())
  } catch {
    return null
  }
  if (!decoded) return null
  const candidates = [
    decoded,
    decoded.replace(/#L\d+(?:C\d+)?$/u, ''),
    decoded.replace(/:\d+(?::\d+)?$/u, '')
  ]
  for (const candidate of [...new Set(candidates)]) {
    const path = candidate.startsWith('~/')
      ? resolve(homedir(), candidate.slice(2))
      : isAbsolute(candidate)
        ? candidate
        : resolve(workspacePath, candidate)
    const entry = await stat(path).catch(() => null)
    if (!entry || (!entry.isFile() && !entry.isDirectory())) continue
    return { path, directory: entry.isDirectory() }
  }
  return null
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

function validateApprovalMode(value: unknown): ApprovalMode {
  if (!isApprovalMode(value)) {
    throw new RuntimeFailure('INVALID_ARGUMENT', '权限模式无效', false)
  }
  return value
}

export function registerRuntimeIpc(
  supervisor: RuntimeController,
  stateStore: DesktopStateStore,
  getWindow: WindowGetter,
  developmentUrl?: string,
  environmentResolver = new RuntimeEnvironmentResolver(process.execPath)
): () => void {
  const pendingExtensionUi = new Map<
    string,
    { event: OmpEvent; timer?: NodeJS.Timeout }
  >()
  const toolApprovals = new Map<
    string,
    {
      event: OmpEvent
      request: NonNullable<RuntimeSnapshot['toolApprovals']>[number]
    }
  >()
  const seenToolApprovalIds = new Set<string>()
  let toolApprovalDeadlineTimer: NodeJS.Timeout | null = null
  let toolApprovalPublishTimer: NodeJS.Timeout | null = null
  let compatibilityNoticeShown = false
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
  const queuedSessionPreferences = new Map<
    string,
    {
      workspaceId: string
      approvalMode: ApprovalMode
      network: RuntimeNetworkConfig
      input: PromptInput
    }
  >()
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
    IPC_CHANNELS.getAvailableCommands,
    IPC_CHANNELS.getAvailableModels,
    IPC_CHANNELS.getLoginProviders,
    IPC_CHANNELS.getProviderLoginState,
    IPC_CHANNELS.getMessages,
    IPC_CHANNELS.getSessionMessages,
    IPC_CHANNELS.getRuntimeState,
    IPC_CHANNELS.restartRuntime,
    IPC_CHANNELS.getRuntimeNetwork,
    IPC_CHANNELS.applyRuntimeNetwork,
    IPC_CHANNELS.getRuntimeSettings,
    IPC_CHANNELS.applyRuntimeSettings,
    IPC_CHANNELS.detectRuntimeProxy,
    IPC_CHANNELS.checkRuntimeProxyPort,
    IPC_CHANNELS.getRuntimeEnvironmentDiagnostic,
    IPC_CHANNELS.prompt,
    IPC_CHANNELS.followUp,
    IPC_CHANNELS.stopCurrentRun,
    IPC_CHANNELS.stopSession,
    IPC_CHANNELS.newSession,
    IPC_CHANNELS.createSession,
    IPC_CHANNELS.cancelQueuedSession,
    IPC_CHANNELS.selectTemporarySession,
    IPC_CHANNELS.openRuntimeLog,
    IPC_CHANNELS.switchSession,
    IPC_CHANNELS.loginProvider,
    IPC_CHANNELS.reopenProviderLoginUrl,
    IPC_CHANNELS.selectModel,
    IPC_CHANNELS.setThinkingLevel,
    IPC_CHANNELS.setApprovalMode,
    IPC_CHANNELS.respondExtensionUi,
    IPC_CHANNELS.revealPath,
    IPC_CHANNELS.validateLocalPath
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

  const publishToolApprovals = (): void => {
    supervisor.setToolApprovals(
      [...toolApprovals.values()].map((item) => ({ ...item.request }))
    )
  }

  const clearToolApprovalTimers = (): void => {
    if (toolApprovalDeadlineTimer) clearTimeout(toolApprovalDeadlineTimer)
    if (toolApprovalPublishTimer) clearTimeout(toolApprovalPublishTimer)
    toolApprovalDeadlineTimer = null
    toolApprovalPublishTimer = null
  }

  const clearToolApprovals = (publish = true): void => {
    clearToolApprovalTimers()
    toolApprovals.clear()
    if (publish) publishToolApprovals()
  }

  const finishToolApproval = (
    id: string,
    value: 'Approve' | 'Deny',
    status: 'approved' | 'auto-approved' | 'denied'
  ): boolean => {
    const pending = toolApprovals.get(id)
    if (!pending || pending.request.status !== 'pending') return false
    try {
      supervisor.sendFrame({
        type: 'extension_ui_response',
        id,
        value
      })
    } catch {
      pending.request.status = 'invalid'
      publishToolApprovals()
      if (
        [...toolApprovals.values()].every(
          (item) => item.request.status !== 'pending'
        )
      )
        setTimeout(() => clearToolApprovals(), 0)
      return true
    }
    pending.request.status = status
    supervisor.recordDiagnostic(
      `工具审批: session=${supervisor.snapshot.sessionId ?? 'unknown'} request=${id} result=${status} elapsedMs=${Math.max(
        0,
        Date.now() -
          (pending.request.deadline - approvalTimeoutMs(pending.event))
      )}`
    )
    publishToolApprovals()
    if (
      [...toolApprovals.values()].every(
        (item) => item.request.status !== 'pending'
      )
    ) {
      setTimeout(() => clearToolApprovals(), 0)
    }
    return true
  }

  const scheduleToolApprovalDeadline = (): void => {
    if (toolApprovalDeadlineTimer) clearTimeout(toolApprovalDeadlineTimer)
    const pending = [...toolApprovals.values()].filter(
      (item) => item.request.status === 'pending'
    )
    const deadline = Math.min(...pending.map((item) => item.request.deadline))
    if (!Number.isFinite(deadline)) {
      toolApprovalDeadlineTimer = null
      return
    }
    toolApprovalDeadlineTimer = setTimeout(
      () => {
        toolApprovalDeadlineTimer = null
        for (const item of [...toolApprovals.values()]) {
          if (
            item.request.status === 'pending' &&
            item.request.deadline <= Date.now()
          ) {
            finishToolApproval(item.request.id, 'Approve', 'auto-approved')
          }
        }
        scheduleToolApprovalDeadline()
      },
      Math.max(0, deadline - Date.now())
    )
  }

  const registerToolApproval = (event: OmpEvent): void => {
    const id = String(event['id'])
    if (seenToolApprovalIds.has(id)) {
      supervisor.recordDiagnostic(
        `重复工具审批请求: session=${supervisor.snapshot.sessionId ?? 'unknown'} request=${id}`
      )
      return
    }
    seenToolApprovalIds.add(id)
    const workspacePath = supervisor.snapshot.workspacePath
    if (!workspacePath) return
    const requestedDeadline = Date.now() + approvalTimeoutMs(event)
    const activeDeadline = Math.min(
      requestedDeadline,
      ...[...toolApprovals.values()]
        .filter((item) => item.request.status === 'pending')
        .map((item) => item.request.deadline)
    )
    for (const item of toolApprovals.values()) {
      if (
        item.request.status === 'pending' &&
        item.request.deadline > activeDeadline
      )
        item.request.deadline = activeDeadline
    }
    toolApprovals.set(id, {
      event,
      request: publicToolApproval(event, workspacePath, activeDeadline)
    })
    scheduleToolApprovalDeadline()
    if (toolApprovals.size === 1) {
      toolApprovalPublishTimer = setTimeout(
        () => {
          toolApprovalPublishTimer = null
          publishToolApprovals()
        },
        Math.min(100, Math.max(0, activeDeadline - Date.now()))
      )
    } else {
      if (toolApprovalPublishTimer) {
        clearTimeout(toolApprovalPublishTimer)
        toolApprovalPublishTimer = null
      }
      publishToolApprovals()
    }
  }

  const publishSnapshot = (snapshot: RuntimeSnapshot): void => {
    if (snapshot.status === 'failed' || snapshot.status === 'stopped') {
      clearPendingExtensionUi()
      clearToolApprovalTimers()
      toolApprovals.clear()
      hostUriRegistered = false
    }
    if (snapshot.status === 'starting') {
      seenToolApprovalIds.clear()
      compatibilityNoticeShown = false
    }
    if (snapshot.status === 'ready' && !hostUriRegistered)
      void ensureHostUriRegistered()
    send({ type: 'snapshot', snapshot })
  }

  const onSnapshot = (snapshot: RuntimeSnapshot): void => {
    if (activatingWorkspacePath) return
    publishSnapshot(snapshot)
  }

  const onSessionSnapshot = (state: SessionRuntimeState): void => {
    send({ type: 'session-runtime', state })
  }

  const onPoolSnapshot = (states: SessionRuntimeState[]): void => {
    send({ type: 'pool-snapshot', states })
  }

  const onTemporarySessionBound = (payload: Record<string, unknown>): void => {
    const temporarySessionId = payload['temporarySessionId']
    const snapshot = payload['snapshot']
    if (
      typeof temporarySessionId !== 'string' ||
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      return
    const runtimeSnapshot = snapshot as RuntimeSnapshot
    const sessionId = runtimeSnapshot.sessionId
    const preference = queuedSessionPreferences.get(temporarySessionId)
    if (!sessionId || !preference) return
    queuedSessionPreferences.delete(temporarySessionId)
    void (async () => {
      await stateStore.updateSessionPreference(
        preference.workspaceId,
        sessionId,
        {
          approvalMode: preference.approvalMode,
          network: preference.network
        }
      )
      const active = payload['active'] === true
      if (active)
        await stateStore.setActiveSession(preference.workspaceId, sessionId)
      const session = await requireSession(preference.workspaceId, sessionId)
        .then((result) =>
          stateStore.applyPreferences(preference.workspaceId, result.session)
        )
        .catch(() => undefined)
      send({
        type: 'temporary-session-bound',
        temporarySessionId,
        snapshot: runtimeSnapshot,
        ...(session ? { session } : {}),
        active
      })
    })().catch((error: unknown) => {
      log.warn('保存新 Session 配置失败', error)
      send({
        type: 'temporary-session-bound',
        temporarySessionId,
        snapshot: runtimeSnapshot,
        active: payload['active'] === true
      })
    })
  }

  const onTemporarySessionFailed = (payload: Record<string, unknown>): void => {
    const temporarySessionId = payload['temporarySessionId']
    const input = payload['input']
    if (
      typeof temporarySessionId !== 'string' ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      return
    const preference = queuedSessionPreferences.get(temporarySessionId)
    queuedSessionPreferences.delete(temporarySessionId)
    send({
      type: 'temporary-session-failed',
      temporarySessionId,
      input: preference?.input ?? (input as PromptInput),
      error: runtimeError(payload['error']),
      reason: 'start-failed'
    })
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
      pendingExtensionUi.size > 0 ||
      [...toolApprovals.values()].some(
        (item) => item.request.status === 'pending'
      )
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

  const resolveRuntimeEnvironment = async (
    config = stateStore.runtimeNetworkConfig()
  ) => {
    const resolved = await environmentResolver.resolve(config)
    supervisor.recordDiagnostic(
      resolved.sourceError
        ? 'Login Shell 环境探测失败，已使用 Electron 启动环境'
        : 'Login Shell 环境探测成功'
    )
    return resolved
  }

  const validateNetworkConfig = (value: unknown): RuntimeNetworkConfig => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new RuntimeFailure('INVALID_ARGUMENT', '代理配置无效', false)
    const record = value as Record<string, unknown>
    if (
      record['mode'] !== 'off' &&
      record['mode'] !== 'auto' &&
      record['mode'] !== 'manual'
    )
      throw new RuntimeFailure('INVALID_ARGUMENT', '代理模式无效', false)
    const currentPort = stateStore.runtimeNetworkConfig().manualPort
    const candidate = record['manualPort'] ?? currentPort
    const manualPort =
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= 1 &&
      candidate <= 65_535
        ? candidate
        : undefined
    if (record['mode'] === 'manual' && !manualPort)
      throw new RuntimeFailure(
        'INVALID_ARGUMENT',
        '请输入 1–65535 的本地代理端口',
        false
      )
    return {
      mode: record['mode'],
      ...(manualPort ? { manualPort } : {})
    }
  }

  const assertNetworkChangeAllowed = (): void => {
    if (
      supervisor.snapshot.isStreaming ||
      supervisor.snapshot.queuedMessageCount > 0 ||
      supervisor.snapshot.isAuthenticating ||
      activeLoginTask
    )
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '任务、Follow-up 或 Provider 登录仍在进行',
        true
      )
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

  const requireTargetSessionId = async (value: unknown): Promise<string> => {
    if (typeof value !== 'string' || value.length === 0)
      throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
    await requireSession(activeWorkspace().id, value)
    return value
  }

  const assertTargetSwitchAllowed = (sessionId: string): void => {
    if (activatingWorkspacePath)
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        'Workspace 正在启动，请稍候',
        true
      )
    const snapshot = supervisor.supportsParallelSessions
      ? supervisor.states?.find((state) => state.sessionId === sessionId)
          ?.snapshot
      : supervisor.snapshot.sessionId === sessionId
        ? supervisor.snapshot
        : undefined
    if (!snapshot)
      throw new RuntimeFailure(
        'SESSION_NOT_FOUND',
        'Session 没有活动 Runtime',
        false
      )
    if (
      snapshot.status === 'starting' ||
      snapshot.status === 'stopping' ||
      snapshot.isStreaming ||
      snapshot.queuedMessageCount > 0 ||
      snapshot.toolApprovals?.some((item) => item.status === 'pending')
    )
      throw new RuntimeFailure(
        'RUNTIME_NOT_READY',
        '目标 Session 的任务、Follow-up 或交互仍在进行，请先 Stop',
        true
      )
  }

  const sessionApprovalMode = async (
    workspaceId: string,
    sessionId: string
  ): Promise<ApprovalMode> => {
    const stored = stateStore.sessionPreference(
      workspaceId,
      sessionId
    ).approvalMode
    if (stored) return stored
    supervisor.recordDiagnostic(
      `Session 权限缺失或无效，按 yolo 补存: session=${sessionId}`
    )
    await stateStore
      .updateSessionPreference(workspaceId, sessionId, {
        approvalMode: 'yolo'
      })
      .catch((error: unknown) => {
        log.warn('补存 Session 默认权限失败', error)
      })
    return 'yolo'
  }

  const sessionNetworkConfig = async (
    workspaceId: string,
    sessionId: string
  ): Promise<RuntimeNetworkConfig> => {
    const stored = stateStore.sessionPreference(workspaceId, sessionId).network
    if (stored) return stored
    const migrated = stateStore.sessionNetworkMigrationBaseline()
    await stateStore
      .updateSessionPreference(workspaceId, sessionId, { network: migrated })
      .catch((error: unknown) => log.warn('补存 Session 网络配置失败', error))
    return migrated
  }

  const switchRuntimeSession = async (
    workspaceId: string,
    session: Awaited<ReturnType<typeof requireSession>>['session'],
    approvalMode: ApprovalMode
  ): Promise<RuntimeSnapshot> => {
    supervisor.trustSession(session.id, session.path)
    await stateStore.updateSessionPreference(workspaceId, session.id, {
      unreadCompletion: false
    })
    if (supervisor.selectSession) {
      const workspace = requireWorkspace(workspaceId)
      const network = await sessionNetworkConfig(workspaceId, session.id)
      const resolved = await resolveRuntimeEnvironment(network)
      const snapshot = await supervisor.selectSession(
        workspace.path,
        resolved.env,
        approvalMode,
        session.id,
        session.path
      )
      await stateStore.setActiveSession(workspaceId, session.id)
      return supervisor.setApprovalState(
        approvalMode,
        false,
        snapshot.approvalModeSaved !== false
      )
    }
    if (
      supervisor.snapshot.status !== 'ready' ||
      supervisor.snapshot.approvalMode !== approvalMode
    ) {
      supervisor.setApprovalState(approvalMode, true)
      await supervisor.restart(approvalMode)
    }
    const snapshot =
      supervisor.snapshot.sessionId === session.id
        ? supervisor.snapshot
        : await supervisor.switchSession(session.id)
    await stateStore.setActiveSession(workspaceId, session.id)
    return supervisor.setApprovalState(
      approvalMode,
      false,
      snapshot.approvalModeSaved !== false
    )
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
      queuedMessageCount: 0,
      approvalMode: workspace.activeSessionId
        ? (stateStore.sessionPreference(workspace.id, workspace.activeSessionId)
            .approvalMode ?? 'yolo')
        : 'yolo',
      approvalModeChanging: true
    }
    activatingWorkspacePath = workspace.path
    hostUriRegistered = false
    send({ type: 'snapshot', snapshot: startingSnapshot })

    void (async () => {
      let activationFailureSnapshot: RuntimeSnapshot | undefined
      try {
        let activeSession:
          Awaited<ReturnType<typeof requireSession>>['session'] | undefined
        let approvalMode: ApprovalMode = 'yolo'
        if (workspace.activeSessionId) {
          const storedSessionId = workspace.activeSessionId
          try {
            activeSession = (
              await requireSession(workspace.id, storedSessionId)
            ).session
            approvalMode = await sessionApprovalMode(
              workspace.id,
              activeSession.id
            )
          } catch (error) {
            log.warn('读取 Workspace 活动 Session 失败', error)
            await stateStore
              .clearActiveSessionIfMatches(workspace.id, storedSessionId)
              .catch((persistError: unknown) =>
                log.warn('清理失效的活动 Session 失败', persistError)
              )
          }
        }
        try {
          if (activeSession && supervisor.supportsParallelSessions) {
            await switchRuntimeSession(
              workspace.id,
              activeSession,
              approvalMode
            )
          } else if (
            supervisor.snapshot.status === 'ready' &&
            supervisor.snapshot.workspacePath === workspace.path &&
            supervisor.snapshot.approvalMode === approvalMode
          )
            await supervisor.getState()
          else {
            const resolved = await resolveRuntimeEnvironment()
            await supervisor.start(workspace.path, resolved.env, approvalMode)
          }
          log.info('performance', {
            event: 'workspace_activation_to_runtime_ready',
            elapsedMs: Math.round(performance.now() - startedAt)
          })
        } catch (error) {
          log.warn('Workspace Runtime 启动失败', error)
          activationFailureSnapshot =
            supervisor.snapshot.workspacePath !== workspace.path ||
            supervisor.snapshot.status !== 'failed'
              ? {
                  ...startingSnapshot,
                  status: 'failed',
                  error: runtimeError(error)
                }
              : supervisor.snapshot
          return
        }

        if (activeSession && !supervisor.supportsParallelSessions) {
          try {
            supervisor.trustSession(activeSession.id, activeSession.path)
            await supervisor.switchSession(activeSession.id)
          } catch (error) {
            log.warn('恢复 Workspace 的活动 Session 失败', error)
            if (
              error instanceof RuntimeFailure &&
              error.code === 'SESSION_NOT_FOUND'
            ) {
              await stateStore
                .clearActiveSessionIfMatches(workspace.id, activeSession.id)
                .catch((persistError: unknown) =>
                  log.warn('清理失效的活动 Session 失败', persistError)
                )
            }
            send({
              type: 'workspace-activation-failed',
              error: runtimeError(error)
            })
          }
        }
      } finally {
        if (activatingWorkspacePath === workspace.path) {
          activatingWorkspacePath = null
          publishSnapshot(activationFailureSnapshot ?? supervisor.snapshot)
        }
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
      const workspace = requireWorkspace(url.hostname)
      const routing = event['__desktop']
      const eventWorkspacePath =
        routing && typeof routing === 'object' && !Array.isArray(routing)
          ? (routing as { workspacePath?: unknown }).workspacePath
          : undefined
      if (
        typeof eventWorkspacePath === 'string' &&
        eventWorkspacePath !== workspace.path
      )
        throw new Error('只能读取所属 Workspace 的 Session')
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

  const cancelPendingExtensionUi = (scope?: {
    runtimeInstanceId: string
    generation: number
  }): void => {
    const prefix = scope
      ? `${scope.runtimeInstanceId}:${scope.generation}:`
      : undefined
    for (const id of pendingExtensionUi.keys()) {
      if (prefix && !id.startsWith(prefix)) continue
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
    if (toolApprovals.size > 0) {
      for (const [id, item] of toolApprovals) {
        if (prefix && !id.startsWith(prefix)) continue
        if (item.request.status !== 'pending') continue
        try {
          supervisor.sendFrame({
            type: 'extension_ui_response',
            id: item.request.id,
            cancelled: true
          })
        } catch {
          // Runtime 已退出时只需清理宿主侧等待项。
        }
        item.request.status = 'cancelled'
        toolApprovals.delete(id)
      }
      if (prefix) publishToolApprovals()
      else clearToolApprovals()
    }
  }

  const onOmpEvent = (event: OmpEvent): void => {
    const routing = event['__desktop']
    const eventRuntimeVersion =
      routing && typeof routing === 'object' && !Array.isArray(routing)
        ? (routing as { runtimeVersion?: unknown }).runtimeVersion
        : undefined
    const runtimeVersion =
      typeof eventRuntimeVersion === 'string'
        ? eventRuntimeVersion
        : supervisor.snapshot.runtimeVersion
    if (event.type === 'agent_end') {
      const eventSessionId =
        routing && typeof routing === 'object' && !Array.isArray(routing)
          ? (routing as { sessionId?: unknown }).sessionId
          : undefined
      const eventWorkspacePath =
        routing && typeof routing === 'object' && !Array.isArray(routing)
          ? (routing as { workspacePath?: unknown }).workspacePath
          : undefined
      if (
        typeof eventSessionId === 'string' &&
        typeof eventWorkspacePath === 'string' &&
        eventSessionId !== supervisor.snapshot.sessionId
      ) {
        const workspace = stateStore.state.workspaces.find(
          (item) => item.path === eventWorkspacePath
        )
        if (workspace)
          void stateStore
            .updateSessionPreference(workspace.id, eventSessionId, {
              unreadCompletion: true
            })
            .catch((error: unknown) => log.warn('保存后台完成状态失败', error))
      }
    }
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
      if (isToolApprovalRequest(event, runtimeVersion)) {
        registerToolApproval(event)
        return
      }
      if (
        isToolApprovalRequest(event, '17.0.6') &&
        runtimeVersion !== '17.0.6' &&
        !compatibilityNoticeShown
      ) {
        compatibilityNoticeShown = true
        supervisor.setCompatibilityNotice(
          '当前 OMP 版本未验证，权限确认使用兼容模式'
        )
        supervisor.recordDiagnostic(
          `工具审批使用兼容模式: version=${runtimeVersion ?? 'unknown'}`
        )
      }
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
        const pending = toolApprovals.get(event['targetId'])
        if (pending) {
          if (pending.request.status === 'pending')
            pending.request.status = 'cancelled'
          publishToolApprovals()
          scheduleToolApprovalDeadline()
          if (
            [...toolApprovals.values()].every(
              (item) => item.request.status !== 'pending'
            )
          )
            setTimeout(() => clearToolApprovals(), 0)
          return
        }
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
              ...(routing &&
              typeof routing === 'object' &&
              !Array.isArray(routing) &&
              typeof (routing as { sessionId?: unknown }).sessionId === 'string'
                ? {
                    sessionId: (routing as { sessionId: string }).sessionId
                  }
                : {}),
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
  supervisor.on('session-snapshot', onSessionSnapshot)
  supervisor.on('pool-snapshot', onPoolSnapshot)
  supervisor.on('temporary-session-bound', onTemporarySessionBound)
  supervisor.on('temporary-session-failed', onTemporarySessionFailed)
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
      if (
        workspacePath !== supervisor.snapshot.workspacePath &&
        !supervisor.supportsParallelSessions
      )
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
        if (
          workspace.path !== supervisor.snapshot.workspacePath &&
          !supervisor.supportsParallelSessions
        )
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
          await switchRuntimeSession(
            workspace.id,
            session,
            await sessionApprovalMode(workspace.id, session.id)
          )
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

  ipcMain.handle(
    IPC_CHANNELS.getSessionMessages,
    async (event, sessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string')
          throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
        if (!supervisor.getSessionMessages)
          throw new RuntimeFailure(
            'UNSUPPORTED',
            '当前不支持后台历史恢复',
            false
          )
        return success(await supervisor.getSessionMessages(sessionId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.getAvailableCommands, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      return success(await supervisor.getAvailableCommands())
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
        if (
          supervisor.snapshot.isStreaming ||
          supervisor.snapshot.queuedMessageCount > 0 ||
          supervisor.snapshot.isAuthenticating
        )
          throw new RuntimeFailure(
            'RUNTIME_NOT_READY',
            'Provider 登录只能在当前 Session 空闲时开始',
            true
          )
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
      if (!settled) {
        if (supervisor.restartLoginRuntime)
          await supervisor.restartLoginRuntime()
        else await supervisor.restart()
      }
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
      const resolved = await resolveRuntimeEnvironment()
      return success(await supervisor.restart(undefined, resolved.env))
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getRuntimeNetwork, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const workspace = activeWorkspace()
      const sessionId = supervisor.snapshot.sessionId
      const config = sessionId
        ? await sessionNetworkConfig(workspace.id, sessionId)
        : stateStore.runtimeNetworkConfig()
      const resolved = await environmentResolver.resolve(config)
      return success(resolved.network)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.applyRuntimeNetwork,
    async (event, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        assertNetworkChangeAllowed()
        const config = validateNetworkConfig(value)
        const workspace = activeWorkspace()
        const sessionId = supervisor.snapshot.sessionId
        if (sessionId)
          await stateStore.updateSessionPreference(workspace.id, sessionId, {
            network: config
          })
        const resolved = await resolveRuntimeEnvironment(config)
        if (supervisor.snapshot.workspacePath) {
          await supervisor.restart(undefined, resolved.env)
        }
        return success(resolved.network)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.detectRuntimeProxy, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      assertNetworkChangeAllowed()
      const workspace = activeWorkspace()
      const sessionId = supervisor.snapshot.sessionId
      const config = sessionId
        ? await sessionNetworkConfig(workspace.id, sessionId)
        : stateStore.runtimeNetworkConfig()
      const resolved = await resolveRuntimeEnvironment(config)
      if (config.mode === 'auto' && supervisor.snapshot.workspacePath)
        await supervisor.restart(undefined, resolved.env)
      return success(resolved.network)
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.checkRuntimeProxyPort,
    async (event, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > 65_535
        )
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            '端口必须是 1–65535 的整数',
            false
          )
        return success(await checkLocalProxyPort(value))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.getRuntimeSettings, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const states = supervisor.states ?? []
      return success({
        defaultNetwork: stateStore.runtimeNetworkConfig(),
        maxParallelSessions: stateStore.maxParallelSessions(),
        runningSessions: states.filter((state) => state.phase !== 'idle')
          .length,
        waitingSessions: supervisor.waitingCount ?? 0
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.applyRuntimeSettings,
    async (event, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Runtime 设置无效',
            false
          )
        const record = value as Record<string, unknown>
        const maxParallelSessions = record['maxParallelSessions']
        if (
          typeof maxParallelSessions !== 'number' ||
          !Number.isInteger(maxParallelSessions) ||
          maxParallelSessions < 1 ||
          maxParallelSessions > 10
        )
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            '最大并行数量必须是 1–10 的整数',
            false
          )
        const defaultNetwork = validateNetworkConfig(record['defaultNetwork'])
        await stateStore.setRuntimeNetworkConfig(defaultNetwork)
        await stateStore.setMaxParallelSessions(maxParallelSessions)
        supervisor.setMaxParallel?.(maxParallelSessions)
        const states = supervisor.states ?? []
        return success({
          defaultNetwork,
          maxParallelSessions,
          runningSessions: states.filter((state) => state.phase !== 'idle')
            .length,
          waitingSessions: supervisor.waitingCount ?? 0
        })
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.getRuntimeEnvironmentDiagnostic,
    async (event) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const workspace = activeWorkspace()
        const sessionId = supervisor.snapshot.sessionId
        const config = sessionId
          ? await sessionNetworkConfig(workspace.id, sessionId)
          : stateStore.runtimeNetworkConfig()
        return success(
          await environmentResolver.diagnostic(
            config,
            supervisor.snapshot.workspacePath
          )
        )
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prompt,
    async (event, target: unknown, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        await supervisor.prompt(
          await materializePrompt(validatePromptInput(value)),
          sessionId
        )
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.followUp,
    async (event, target: unknown, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        await supervisor.followUp(
          await materializePrompt(validatePromptInput(value)),
          sessionId
        )
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.stopCurrentRun,
    async (event, target: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        return success(await supervisor.stopCurrentRun(sessionId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.stopSession,
    async (event, sessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof sessionId !== 'string')
          throw new RuntimeFailure('INVALID_ARGUMENT', 'Session ID 无效', false)
        const workspace = activeWorkspace()
        await requireSession(workspace.id, sessionId)
        if (!supervisor.stopSession)
          throw new RuntimeFailure('UNSUPPORTED', '当前不支持后台停止', false)
        return success(await supervisor.stopSession(sessionId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.newSession, async (event) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      if (!supervisor.supportsParallelSessions) assertSwitchAllowed()
      return success(await supervisor.newSession())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.createSession,
    async (
      event,
      value: unknown,
      titleValue: unknown,
      approvalModeValue: unknown
    ) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (!supervisor.supportsParallelSessions) assertSwitchAllowed()
        const rawInput = validatePromptInput(value)
        const input = await materializePrompt(rawInput)
        const title =
          typeof titleValue === 'string' ? titleValue.trim() : rawInput.message
        const workspace = activeWorkspace()
        const approvalMode = validateApprovalMode(approvalModeValue)
        const network = stateStore.runtimeNetworkConfig()
        if (supervisor.enqueueNewSession) {
          const resolved = await resolveRuntimeEnvironment(network)
          const queued = supervisor.enqueueNewSession({
            workspacePath: workspace.path,
            env: resolved.env,
            approvalMode,
            input,
            title: title || '图片会话'
          })
          queuedSessionPreferences.set(queued.temporarySessionId, {
            workspaceId: workspace.id,
            approvalMode,
            network,
            input: rawInput
          })
          return success(queued)
        }
        if (supervisor.prepareNewSession) {
          const resolved = await resolveRuntimeEnvironment(network)
          await supervisor.prepareNewSession(
            workspace.path,
            resolved.env,
            approvalMode,
            Buffer.byteLength(JSON.stringify(input), 'utf8')
          )
        } else if (
          supervisor.snapshot.status !== 'ready' ||
          supervisor.snapshot.approvalMode !== approvalMode
        ) {
          supervisor.setApprovalState(approvalMode, true)
          await supervisor.restart(approvalMode)
          supervisor.setApprovalState(approvalMode, false)
        }
        const snapshot = await supervisor.newSession()
        if (!snapshot.sessionId)
          throw new RuntimeFailure(
            'PROTOCOL_ERROR',
            'OMP 未返回新 Session ID',
            true
          )
        await supervisor
          .setSessionName(title || '图片会话')
          .catch((error: unknown) =>
            log.warn('自动设置 Session 标题失败', error)
          )
        await supervisor.prompt(input)
        let approvalModeSaved = true
        try {
          await stateStore.updateSessionPreference(
            workspace.id,
            snapshot.sessionId,
            { approvalMode, network }
          )
          await stateStore.setActiveSession(workspace.id, snapshot.sessionId)
        } catch {
          approvalModeSaved = false
          supervisor.setApprovalState(approvalMode, false, false)
        }
        const session = await requireSession(workspace.id, snapshot.sessionId)
          .then((result) => result.session)
          .catch((error: unknown) => {
            log.info('Session 文件尚未可读，等待列表异步刷新', {
              sessionId: snapshot.sessionId,
              error: runtimeError(error)
            })
            return undefined
          })
        return success({
          snapshot: approvalModeSaved
            ? supervisor.snapshot
            : supervisor.setApprovalState(approvalMode, false, false),
          ...(session
            ? { session: stateStore.applyPreferences(workspace.id, session) }
            : {})
        })
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.cancelQueuedSession,
    async (event, temporarySessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof temporarySessionId !== 'string')
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Temporary Session ID 无效',
            false
          )
        if (!supervisor.cancelQueuedSession)
          throw new RuntimeFailure('UNSUPPORTED', '当前没有等待队列', false)
        const input = await supervisor.cancelQueuedSession(temporarySessionId)
        const preference = queuedSessionPreferences.get(temporarySessionId)
        queuedSessionPreferences.delete(temporarySessionId)
        const restoredInput = preference?.input ?? input
        send({
          type: 'temporary-session-failed',
          temporarySessionId,
          input: restoredInput,
          error: {
            code: 'RUNTIME_NOT_READY',
            message: '已取消等待',
            retryable: false
          },
          reason: 'cancelled'
        })
        return success(restoredInput)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.selectTemporarySession,
    async (event, temporarySessionId: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        if (typeof temporarySessionId !== 'string')
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Temporary Session ID 无效',
            false
          )
        if (!supervisor.selectTemporarySession)
          throw new RuntimeFailure('UNSUPPORTED', '当前没有临时 Session', false)
        return success(supervisor.selectTemporarySession(temporarySessionId))
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
        if (!supervisor.supportsParallelSessions) assertSwitchAllowed()
        const workspace = activeWorkspace()
        const { session } = await requireSession(workspace.id, sessionId)
        const approvalMode = await sessionApprovalMode(workspace.id, session.id)
        const snapshot = await switchRuntimeSession(
          workspace.id,
          session,
          approvalMode
        )
        return success(snapshot)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setApprovalMode,
    async (event, target: unknown, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        assertTargetSwitchAllowed(sessionId)
        const approvalMode = validateApprovalMode(value)
        const workspace = activeWorkspace()
        const { session } = await requireSession(workspace.id, sessionId)
        const previousMode = await sessionApprovalMode(workspace.id, session.id)
        if (approvalMode === previousMode) return success(supervisor.snapshot)

        supervisor.setApprovalState(approvalMode, true, true, sessionId)
        try {
          await supervisor.restart(approvalMode, undefined, sessionId)
        } catch (error) {
          try {
            supervisor.setApprovalState(previousMode, true, true, sessionId)
            await supervisor.restart(previousMode, undefined, sessionId)
          } catch {
            throw error
          }
          throw new RuntimeFailure(
            'START_FAILED',
            `权限切换失败，已恢复为「${
              previousMode === 'always-ask'
                ? '严格'
                : previousMode === 'write'
                  ? '标准'
                  : '全部允许'
            }」`,
            true
          )
        }
        try {
          await stateStore.updateSessionPreference(workspace.id, session.id, {
            approvalMode
          })
        } catch {
          supervisor.setApprovalState(approvalMode, false, false, sessionId)
          throw new RuntimeFailure('STATE_WRITE_FAILED', '权限保存失败', true)
        }
        return success(
          supervisor.setApprovalState(approvalMode, false, true, sessionId)
        )
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.selectModel,
    async (event, target: unknown, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        return success(
          await supervisor.selectModel(validateModelSelection(value), sessionId)
        )
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.cancelPendingModelSelection,
    async (event, target: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        return success(supervisor.cancelPendingModelSelection(sessionId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.setThinkingLevel,
    async (event, target: unknown, level: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId = await requireTargetSessionId(target)
        if (typeof level !== 'string') {
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Thinking 等级无效',
            false
          )
        }
        await supervisor.setThinkingLevel(level, sessionId)
        return success(undefined)
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.respondExtensionUi,
    async (event, target: unknown, id: unknown, response: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        const sessionId =
          target === null && activeLoginTask
            ? undefined
            : await requireTargetSessionId(target)
        const pendingEvent =
          typeof id === 'string'
            ? (toolApprovals.get(id)?.event ??
              pendingExtensionUi.get(id)?.event)
            : undefined
        const routing = pendingEvent?.['__desktop']
        const ownerSessionId =
          routing && typeof routing === 'object' && !Array.isArray(routing)
            ? (routing as { sessionId?: unknown }).sessionId
            : undefined
        if (typeof ownerSessionId === 'string' && ownerSessionId !== sessionId)
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            '交互请求不属于目标 Session',
            false
          )
        if (
          typeof id === 'string' &&
          toolApprovals.has(id) &&
          isExtensionUiResponse(response) &&
          'value' in response &&
          (response.value === 'Approve' || response.value === 'Deny')
        ) {
          const handled = finishToolApproval(
            id,
            response.value,
            response.value === 'Approve' ? 'approved' : 'denied'
          )
          if (!handled) {
            throw new RuntimeFailure(
              'INVALID_ARGUMENT',
              '工具审批请求已失效',
              false
            )
          }
          scheduleToolApprovalDeadline()
          return success(undefined)
        }
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
        if (!sessionId && !activeLoginTask)
          throw new RuntimeFailure(
            'INVALID_ARGUMENT',
            'Extension UI 缺少目标 Session',
            false
          )
        supervisor.sendFrame(
          { type: 'extension_ui_response', id, ...response },
          sessionId
        )
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

  const resolveLocalPath = async (
    value: unknown
  ): Promise<{ path: string; directory: boolean } | null> =>
    resolveLocalPathValue(value, activeWorkspace().path)

  ipcMain.handle(
    IPC_CHANNELS.validateLocalPath,
    async (event, value: unknown) => {
      try {
        assertTrustedSender(event, getWindow, developmentUrl)
        return (await resolveLocalPath(value)) !== null
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.revealPath, async (event, value: unknown) => {
    try {
      assertTrustedSender(event, getWindow, developmentUrl)
      const target = await resolveLocalPath(value)
      if (!target) {
        throw new RuntimeFailure('INVALID_ARGUMENT', '本地路径无效', false)
      }
      if (target.directory) {
        const error = await shell.openPath(target.path)
        if (error) throw new Error(error)
      } else {
        shell.showItemInFolder(target.path)
      }
      return success(true)
    } catch (error) {
      return failure(error)
    }
  })

  const replayPending = (): void => {
    if (supervisor.states)
      send({ type: 'pool-snapshot', states: supervisor.states })
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
    supervisor.off('session-snapshot', onSessionSnapshot)
    supervisor.off('pool-snapshot', onPoolSnapshot)
    supervisor.off('temporary-session-bound', onTemporarySessionBound)
    supervisor.off('temporary-session-failed', onTemporarySessionFailed)
    supervisor.off('event', onOmpEvent)
    supervisor.off('before-stop', cancelPendingExtensionUi)
    clearPendingExtensionUi()
    clearToolApprovalTimers()
    toolApprovals.clear()
    for (const toolCallId of pendingToolProgress.keys()) {
      clearToolProgress(toolCallId)
    }
    ipcMain.off(IPC_CHANNELS.rendererReady, replayPending)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
