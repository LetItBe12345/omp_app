import {
  CircleStop,
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Settings2
} from 'lucide-react'
import { ComposerPrimitive } from '@assistant-ui/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { uiFixture } from '../../tests/fixtures/ui-fixture'
import type {
  AvailableModel,
  ContextReference,
  LoginProvider,
  ProviderLoginState,
  PromptInput,
  RuntimeSnapshot,
  SessionSummary,
  WorkspaceOverview
} from '../shared/desktop-api'
import { ContextReferences } from './context-references'
import { ModelControls } from './model-controls'
import { ConversationRuntime, ThreadMessages } from './conversation-thread'
import {
  appendUserTurn,
  createConversationProjection,
  projectHistory,
  reduceOmpEvent,
  type ConversationProjection
} from './omp-event-reducer'
import { strings } from './strings'
import {
  cleanExpiredDrafts,
  clearDraft,
  loadDraft,
  saveDraft
} from './draft-store'
import { WorkspaceSidebar } from './workspace-sidebar'

const fixture = __OMP_UI_FIXTURE__ ? uiFixture : null
const runtimeSessionKey = (
  snapshot: Pick<RuntimeSnapshot, 'workspacePath' | 'sessionId'>
): string | undefined =>
  snapshot.workspacePath && snapshot.sessionId
    ? `${snapshot.workspacePath}:${snapshot.sessionId}`
    : undefined
const knownOmpEventTypes = new Set([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'prompt_result',
  'extension_ui_request',
  'extension_ui_resolved',
  'available_commands_update',
  'auto_compaction_start',
  'auto_compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'notice',
  'RPC_PROTOCOL_ERROR'
])

function IconButton({
  label,
  icon,
  disabled = true,
  onClick
}: {
  label: string
  icon: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="inline-grid size-8 place-items-center rounded-lg text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
      onClick={onClick}
      title={disabled ? strings.unavailable : label}
      type="button"
      disabled={disabled}
    >
      {icon}
    </button>
  )
}

function FileTree({
  runtime
}: {
  runtime: RuntimeSnapshot
}): React.JSX.Element {
  return (
    <aside className="panel-surface h-full min-w-0" data-slot="file-tree">
      <div className="flex h-16 items-center justify-between px-5">
        <h2 className="text-[15px] font-semibold">{strings.files}</h2>
        <IconButton label={strings.settings} icon={<Settings2 size={16} />} />
      </div>
      <div className="px-3">
        {fixture ? (
          <ul className="space-y-1">
            {fixture.files.map((file, index) => (
              <li
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm"
                key={file}
              >
                {index < 3 ? <Folder size={16} /> : <FileText size={16} />}
                <span>{file}</span>
                {index < 3 && <ChevronRight className="ml-auto" size={14} />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-card mt-2" data-slot="files-empty-state">
            <FileText size={20} strokeWidth={1.6} />
            <p className="mt-3 text-sm font-medium">暂无文件</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              {runtime.workspacePath
                ? '文件树将在 MVP-07 中提供。'
                : '打开 Workspace 后显示文件树。'}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

function hasTextSelection(): boolean {
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLInputElement
  ) {
    return activeElement.selectionStart !== activeElement.selectionEnd
  }
  return !window.getSelection()?.isCollapsed
}

function Conversation({
  runtime,
  onSnapshot,
  projection,
  setProjection,
  input,
  onInput,
  models,
  providers,
  loginState,
  catalogError,
  modelsLoaded,
  onRefreshModels,
  onRefreshProviders,
  workspaceId,
  references,
  onReferences,
  temporarySession,
  onSessionCreated,
  openingSession,
  recentReferences,
  onSentReferences,
  attachments,
  onAttachments
}: {
  runtime: RuntimeSnapshot
  onSnapshot: (snapshot: RuntimeSnapshot) => void
  projection: ConversationProjection
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
  input: string
  onInput: (value: string) => void
  models: AvailableModel[]
  providers: LoginProvider[]
  loginState: ProviderLoginState
  catalogError: string | null
  modelsLoaded: boolean
  onRefreshModels: () => Promise<boolean>
  onRefreshProviders: () => Promise<boolean>
  workspaceId?: string
  references: ContextReference[]
  onReferences: (references: ContextReference[]) => void
  temporarySession: boolean
  onSessionCreated: (snapshot: RuntimeSnapshot) => void
  openingSession: boolean
  recentReferences: ContextReference[]
  onSentReferences: (references: ContextReference[]) => void
  attachments: NonNullable<PromptInput['images']>
  onAttachments: (attachments: NonNullable<PromptInput['images']>) => void
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = runtime.isStreaming || runtime.queuedMessageCount > 0
  const currentModelAvailable =
    !modelsLoaded ||
    !runtime.model ||
    models.some((model) => `${model.provider}/${model.id}` === runtime.model)
  const ready =
    runtime.status === 'ready' &&
    !runtime.isAuthenticating &&
    currentModelAvailable
  const busyRef = useRef(busy)
  const stoppingRef = useRef(stopping)
  const stopRef = useRef<() => Promise<void>>(async () => undefined)

  const stop = async (): Promise<void> => {
    if (!busy || stopping) return
    setStopping(true)
    setError(null)
    const result = await window.desktop.stopCurrentRun()
    if (result.ok) {
      onInput(result.data?.message ?? '')
      const state = await window.desktop.getRuntimeState()
      if (state.ok) onSnapshot(state.data)
    } else {
      setError(result.error.message)
    }
    setStopping(false)
  }

  useLayoutEffect(() => {
    busyRef.current = busy
    stoppingRef.current = stopping
    stopRef.current = stop
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !busyRef.current ||
        stoppingRef.current ||
        event.key.toLowerCase() !== 'c' ||
        !event.ctrlKey
      )
        return
      if (hasTextSelection()) return
      event.preventDefault()
      void stopRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const send = async (value = input): Promise<void> => {
    const message = value.trim()
    if (
      !ready ||
      (!message && references.length === 0 && attachments.length === 0) ||
      stopping ||
      sending
    )
      return
    if (busy && message.startsWith('/')) {
      setError('任务结束后可执行 Slash Command')
      return
    }
    setError(null)
    setSending(true)
    const promptInput = {
      message,
      references,
      ...(attachments.length ? { images: attachments } : {})
    }
    const result =
      temporarySession && !busy
        ? await window.desktop.createSession(
            promptInput,
            message.split(/\r?\n/u)[0]?.trim() || '图片会话'
          )
        : busy
          ? await window.desktop.followUp(promptInput)
          : await window.desktop.prompt(promptInput)
    if (result.ok) {
      setProjection((current) => appendUserTurn(current, message))
      onInput('')
      onSentReferences(references)
      onReferences([])
      onAttachments([])
      if (temporarySession && result.data)
        onSessionCreated(result.data as RuntimeSnapshot)
    } else setError(result.error.message)
    setSending(false)
  }

  const restart = async (): Promise<void> => {
    setError(null)
    const result = await window.desktop.restartRuntime()
    if (result.ok) onSnapshot(result.data)
    else setError(result.error.message)
  }

  const pasteImages = (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ): void => {
    const images = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith('image/')
    )
    if (images.length === 0) return
    event.preventDefault()
    void Promise.all(
      images.map(
        (file) =>
          new Promise<NonNullable<PromptInput['images']>[number]>(
            (resolve, reject) => {
              const reader = new FileReader()
              reader.onerror = () => reject(reader.error)
              reader.onload = () => {
                const value =
                  typeof reader.result === 'string' ? reader.result : ''
                resolve({
                  type: 'image',
                  data: value.replace(/^data:[^,]*,/u, ''),
                  mimeType: file.type
                })
              }
              reader.readAsDataURL(file)
            }
          )
      )
    ).then((loaded) => onAttachments([...attachments, ...loaded]))
  }

  const conversation = (
    <main
      className="flex h-full min-w-0 flex-col bg-[var(--surface-main)]"
      data-slot="conversation-main"
    >
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--border-subtle)] px-7">
        <div>
          <h2 className="text-[15px] font-semibold">
            {fixture ? fixture.activeConversation : strings.appName}
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {fixture
              ? fixture.workspace
              : (runtime.workspacePath ?? '未连接 Workspace')}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {fixture ? (
          <div
            className="mx-auto flex h-full max-w-4xl flex-col gap-7 overflow-y-auto p-8 pt-16"
            data-slot="fixture-messages"
          >
            <div className="ml-auto max-w-[72%] rounded-2xl bg-[var(--surface-selected)] px-4 py-3 text-sm leading-6">
              {fixture.userMessage}
            </div>
            <div className="max-w-[82%] text-sm leading-7">
              {fixture.assistantMessage}
            </div>
          </div>
        ) : openingSession ? (
          <section className="grid h-full place-items-center p-8 text-sm text-[var(--text-muted)]">
            正在打开会话…
          </section>
        ) : projection.turns.length > 0 ? (
          <ThreadMessages />
        ) : (
          <section
            className="grid h-full place-items-center p-8 text-center"
            data-slot="conversation-empty-state"
          >
            <div className="max-w-md">
              <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-[var(--border)] bg-white shadow-xs">
                <MessageSquare size={20} strokeWidth={1.6} />
              </div>
              <h3 className="mt-4 text-base font-semibold">
                {strings.noConversation}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {strings.noConversationHint}
              </p>
            </div>
          </section>
        )}
      </div>

      <div className="shrink-0 p-5 pt-0">
        <div className="relative mx-auto max-w-4xl rounded-2xl border border-[var(--border)] bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <ModelControls
            catalogError={catalogError}
            loginState={loginState}
            models={models}
            modelsLoaded={modelsLoaded}
            onRefreshModels={onRefreshModels}
            onRefreshProviders={onRefreshProviders}
            onSnapshot={onSnapshot}
            providers={providers}
            runtime={runtime}
          />
          {!fixture && (
            <ContextReferences
              input={input}
              onInput={onInput}
              onReferences={onReferences}
              references={references}
              recentReferences={recentReferences}
              workspaceId={workspaceId}
            />
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {attachments.map((attachment, index) => (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-app)] px-1.5 py-1 text-[11px]"
                  key={`${attachment.mimeType}:${index}`}
                >
                  图片 {index + 1}
                  <button
                    aria-label={`移除图片 ${index + 1}`}
                    className="ml-0.5 text-[10px]"
                    onClick={() =>
                      onAttachments(
                        attachments.filter(
                          (_attachment, itemIndex) => itemIndex !== index
                        )
                      )
                    }
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {fixture ? (
            <textarea
              aria-label="任务输入"
              className="h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
              disabled={!ready || stopping || sending}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void send()
                }
              }}
              onPaste={pasteImages}
              placeholder={strings.composerPlaceholder}
              value={input}
            />
          ) : (
            <ComposerPrimitive.Input
              aria-label="任务输入"
              className="h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
              disabled={!ready || stopping || sending}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void send()
                }
              }}
              onPaste={pasteImages}
              placeholder={strings.composerPlaceholder}
              submitMode="none"
              value={input}
            />
          )}
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-[var(--text-muted)]">
              {error ??
                (runtime.isAuthenticating
                  ? '正在授权 Provider'
                  : !currentModelAvailable
                    ? '当前模型不可用，请重新选择模型'
                    : runtime.status === 'starting'
                      ? 'Runtime 启动中'
                      : runtime.status === 'failed'
                        ? [
                            runtime.error?.message,
                            runtime.diagnosticSummary?.at(-1)
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : ready
                          ? busy
                            ? `${runtime.queuedMessageCount} 条待处理消息`
                            : 'Runtime 已就绪'
                          : strings.runtimeUnavailable)}
            </span>
            {runtime.status === 'failed' && (
              <button
                className="mr-2 ml-auto text-[11px] text-[var(--text-secondary)] underline underline-offset-2"
                onClick={() => void window.desktop.openRuntimeLog()}
                type="button"
              >
                查看日志
              </button>
            )}
            <button
              aria-label={
                runtime.status === 'failed'
                  ? '重启 Runtime'
                  : busy
                    ? '停止'
                    : '发送'
              }
              className="grid min-h-8 min-w-12 place-items-center rounded-xl bg-[var(--text-primary)] px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() =>
                runtime.status === 'failed'
                  ? void restart()
                  : busy
                    ? void stop()
                    : void send()
              }
              type="button"
              disabled={
                stopping ||
                sending ||
                (runtime.status !== 'failed' &&
                  (!ready ||
                    (!busy &&
                      input.trim().length === 0 &&
                      references.length === 0 &&
                      attachments.length === 0)))
              }
            >
              {runtime.status === 'failed' ? (
                '重启 Runtime'
              ) : busy ? (
                <CircleStop size={17} />
              ) : (
                '发送'
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
  if (fixture) return conversation
  return (
    <ConversationRuntime
      isRunning={busy}
      onCancel={stop}
      onSend={async (message) => {
        if (message.trim()) await send(message)
      }}
      projection={projection}
      setProjection={setProjection}
    >
      {conversation}
    </ConversationRuntime>
  )
}

export function App(): React.JSX.Element {
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({
    status: 'stopped',
    isStreaming: false,
    queuedMessageCount: 0
  })
  const [composerInput, setComposerInput] = useState('')
  const [references, setReferences] = useState<ContextReference[]>([])
  const [attachments, setAttachments] = useState<
    NonNullable<PromptInput['images']>
  >([])
  const [recentReferences, setRecentReferences] = useState<ContextReference[]>(
    []
  )
  const [models, setModels] = useState<AvailableModel[]>([])
  const [providers, setProviders] = useState<LoginProvider[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loginState, setLoginState] = useState<ProviderLoginState>({
    status: 'idle'
  })
  const [projection, setProjection] = useState(createConversationProjection)
  const [overview, setOverview] = useState<WorkspaceOverview>(
    fixture
      ? {
          activeWorkspaceId: 'fixture-workspace',
          workspaces: [
            {
              id: 'fixture-workspace',
              path: '/fixture/omp-desktop',
              name: fixture.workspace,
              available: true,
              pinned: false,
              addedAt: new Date(0).toISOString(),
              lastUsedAt: new Date(0).toISOString()
            }
          ],
          hasMore: false
        }
      : { workspaces: [], hasMore: false }
  )
  const [sessions, setSessions] = useState<SessionSummary[]>(
    fixture
      ? fixture.conversations.map((title, index) => ({
          id: `fixture-${index}`,
          workspaceId: 'fixture-workspace',
          path: `/fixture/${index}.jsonl`,
          title,
          createdAt: new Date(0).toISOString(),
          modifiedAt: new Date(0).toISOString(),
          messageCount: 1,
          size: 1,
          pinned: false,
          archived: false,
          compatibility: 'v3',
          status: 'complete'
        }))
      : []
  )
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionNextOffset, setSessionNextOffset] = useState(0)
  const [hasMoreSessions, setHasMoreSessions] = useState(false)
  const [workspaceOffset, setWorkspaceOffset] = useState(0)
  const [temporarySession, setTemporarySession] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [draftStatus, setDraftStatus] = useState<string | null>(null)
  const [openingSession, setOpeningSession] = useState(false)
  const projectionSessionId = useRef<string | undefined>(undefined)
  const projectionRef = useRef(projection)
  const projectionCache = useRef(new Map<string, ConversationProjection>())
  const attachmentCache = useRef(
    new Map<string, NonNullable<PromptInput['images']>>()
  )
  const sessionRequestId = useRef(0)
  const activeWorkspaceId = overview.activeWorkspaceId
  const currentProjectionKey = runtimeSessionKey(runtime)

  useLayoutEffect(() => {
    projectionRef.current = projection
  }, [projection])

  const updateComposer = useCallback((value: string): void => {
    setComposerInput(value)
  }, [])

  const applySnapshot = useCallback((snapshot: RuntimeSnapshot): void => {
    const nextProjectionId = runtimeSessionKey(snapshot)
    if (nextProjectionId !== projectionSessionId.current) {
      projectionSessionId.current = nextProjectionId
      setProjection(createConversationProjection())
    }
    setRuntime(snapshot)
  }, [])

  const refreshWorkspaces = useCallback(async (offset = 0): Promise<void> => {
    if (fixture) return
    const result = await window.desktop.getWorkspaces(offset)
    if (result.ok) {
      setOverview(result.data)
      setSessionError(null)
    } else setSessionError(result.error.message)
  }, [])

  const refreshSessions = useCallback(
    async (
      workspaceId: string,
      offset = 0,
      query = '',
      append = false
    ): Promise<void> => {
      if (fixture) return
      const requestId = ++sessionRequestId.current
      const result = await window.desktop.listSessions(
        workspaceId,
        offset,
        query
      )
      if (requestId !== sessionRequestId.current) return
      if (!result.ok) {
        setSessionError(result.error.message)
        return
      }
      setSessions((current) =>
        append ? [...current, ...result.data.sessions] : result.data.sessions
      )
      setSessionNextOffset(result.data.nextOffset)
      setHasMoreSessions(result.data.hasMore)
      setSessionError(null)
    },
    []
  )

  const refreshModels = useCallback(async (): Promise<boolean> => {
    const result = await window.desktop.getAvailableModels()
    if (!result.ok) {
      setCatalogError(`刷新失败：${result.error.message}`)
      return false
    }
    setModels(result.data)
    setModelsLoaded(true)
    setCatalogError(null)
    return true
  }, [])

  const refreshProviders = useCallback(async (): Promise<boolean> => {
    const result = await window.desktop.getLoginProviders()
    if (!result.ok) {
      setCatalogError(`刷新失败：${result.error.message}`)
      return false
    }
    setProviders(result.data)
    setCatalogError(null)
    return true
  }, [])

  useEffect(() => {
    cleanExpiredDrafts(localStorage)
    const workspaceTimer = window.setTimeout(() => void refreshWorkspaces(), 0)
    void window.desktop.getRuntimeState().then((result) => {
      if (result.ok) {
        applySnapshot(result.data)
        if (result.data.status === 'ready') {
          void refreshModels()
          void refreshProviders()
          void window.desktop.getProviderLoginState().then((loginResult) => {
            if (loginResult.ok) setLoginState(loginResult.data)
          })
        }
      }
    })
    const unsubscribe = window.desktop.onRuntimeEvent((event) => {
      if (event.type === 'snapshot') applySnapshot(event.snapshot)
      if (event.type === 'provider-login') setLoginState(event.state)
      const handleOmpEvent = (ompEvent: {
        type: string
        [key: string]: unknown
      }): void => {
        if (ompEvent.type === 'runtime_interrupted') {
          const input = ompEvent['input']
          if (
            input &&
            typeof input === 'object' &&
            !Array.isArray(input) &&
            typeof (input as { message?: unknown }).message === 'string'
          ) {
            updateComposer((input as { message: string }).message)
          }
          return
        }
        if (ompEvent.type === 'model_selection_failed') {
          const message = ompEvent['message']
          setCatalogError(
            typeof message === 'string'
              ? `模型配置应用失败：${message}`
              : '模型配置应用失败'
          )
          return
        }
        if (!knownOmpEventTypes.has(ompEvent.type)) {
          window.desktop.log({
            level: 'debug',
            message: `忽略未知 OMP 事件：${ompEvent.type}`
          })
          return
        }
        setProjection((current) => reduceOmpEvent(current, ompEvent))
      }
      if (event.type === 'omp-event') handleOmpEvent(event.event)
      if (event.type === 'omp-event-batch') {
        for (const ompEvent of event.events) handleOmpEvent(ompEvent)
      }
    })
    return () => {
      window.clearTimeout(workspaceTimer)
      unsubscribe()
    }
  }, [
    applySnapshot,
    refreshModels,
    refreshProviders,
    refreshWorkspaces,
    updateComposer
  ])

  useEffect(() => {
    if (!activeWorkspaceId || fixture) return
    const timer = window.setTimeout(
      () => {
        void refreshSessions(activeWorkspaceId, 0, sessionSearch)
      },
      sessionSearch ? 180 : 0
    )
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, refreshSessions, sessionSearch])

  useEffect(() => {
    if (temporarySession || !activeWorkspaceId || !runtime.sessionId) return
    const timer = window.setTimeout(() => {
      const draft = loadDraft(
        localStorage,
        activeWorkspaceId,
        runtime.sessionId!
      )
      setComposerInput(draft?.text ?? '')
      setReferences(draft?.references ?? [])
      setDraftStatus(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, runtime.sessionId, temporarySession])

  useEffect(() => {
    if (temporarySession || !activeWorkspaceId || !runtime.sessionId) return
    const timer = window.setTimeout(() => {
      const result = saveDraft(
        localStorage,
        activeWorkspaceId,
        runtime.sessionId!,
        composerInput,
        references
      )
      setDraftStatus(
        result.saved
          ? null
          : result.reason === 'item-too-large'
            ? '草稿超过 256 KiB，当前输入尚未保存'
            : '草稿保存失败，当前输入仍保留'
      )
    }, 120)
    return () => window.clearTimeout(timer)
  }, [
    activeWorkspaceId,
    composerInput,
    references,
    runtime.sessionId,
    temporarySession
  ])

  useEffect(() => {
    if (
      runtime.status !== 'ready' ||
      !runtime.sessionId ||
      !currentProjectionKey
    )
      return
    let cancelled = false
    const loadingTimer = window.setTimeout(() => {
      if (!projectionCache.current.has(currentProjectionKey))
        setOpeningSession(true)
    }, 150)
    void window.desktop.getMessages().then((result) => {
      if (!cancelled && result.ok) {
        const restored = projectHistory(result.data)
        setProjection(restored)
        projectionCache.current.set(currentProjectionKey, restored)
        while (projectionCache.current.size > 2) {
          const oldest = projectionCache.current.keys().next().value as
            string | undefined
          if (oldest) projectionCache.current.delete(oldest)
          else break
        }
        setOpeningSession(false)
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(loadingTimer)
    }
  }, [currentProjectionKey, runtime.sessionId, runtime.status])

  const openWorkspace = async (): Promise<void> => {
    const result = await window.desktop.chooseWorkspace()
    if (result.ok && result.data) {
      setTemporarySession(false)
      applySnapshot(result.data)
      await refreshWorkspaces()
    } else if (!result.ok) setSessionError(result.error.message)
  }

  const activateWorkspace = async (workspaceId: string): Promise<void> => {
    if (workspaceId === activeWorkspaceId) return
    const result = await window.desktop.activateWorkspace(workspaceId)
    if (!result.ok) {
      setSessionError(result.error.message)
      return
    }
    setTemporarySession(false)
    setReferences([])
    setRecentReferences([])
    setAttachments([])
    applySnapshot(result.data)
    await refreshWorkspaces()
  }

  const switchSession = async (sessionId: string): Promise<void> => {
    if (!temporarySession && runtime.sessionId === sessionId) return
    const currentCacheKey = runtimeSessionKey(runtime)
    if (currentCacheKey)
      projectionCache.current.set(currentCacheKey, projectionRef.current)
    if (currentCacheKey)
      attachmentCache.current.set(currentCacheKey, attachments)
    const targetCacheKey = runtime.workspacePath
      ? `${runtime.workspacePath}:${sessionId}`
      : sessionId
    const cached = projectionCache.current.get(targetCacheKey)
    setProjection(cached ?? createConversationProjection())
    setOpeningSession(false)
    const loadingTimer = cached
      ? undefined
      : window.setTimeout(() => setOpeningSession(true), 150)
    const result = await window.desktop.switchSession(sessionId)
    if (loadingTimer) window.clearTimeout(loadingTimer)
    if (!result.ok) {
      setOpeningSession(false)
      setSessionError(result.error.message)
      return
    }
    setTemporarySession(false)
    setRecentReferences([])
    setAttachments(attachmentCache.current.get(targetCacheKey) ?? [])
    applySnapshot(result.data)
    if (cached) setProjection(cached)
  }

  const updateSession = async (
    action: Promise<{ ok: boolean; error?: { message: string } }>
  ): Promise<void> => {
    const result = await action
    if (!result.ok) {
      setSessionError(result.error?.message ?? '操作失败')
      return
    }
    if (activeWorkspaceId)
      await refreshSessions(activeWorkspaceId, 0, sessionSearch)
  }

  return (
    <div
      className="h-screen min-h-[700px] min-w-[1024px] bg-[var(--surface-app)] text-[var(--text-primary)]"
      data-slot="app-shell"
    >
      <Group className="h-full" id="desktop-layout" orientation="horizontal">
        <Panel defaultSize="18%" id="conversations" minSize={220}>
          <WorkspaceSidebar
            archivedExpanded={archivedExpanded}
            error={sessionError ?? draftStatus}
            hasMoreSessions={hasMoreSessions}
            onActivateWorkspace={(id) => void activateWorkspace(id)}
            onArchiveSession={(id, archived) => {
              if (!activeWorkspaceId) return
              void (async () => {
                if (archived && runtime.sessionId === id) {
                  const alternative = sessions.find(
                    (session) =>
                      session.id !== id &&
                      !session.archived &&
                      session.compatibility !== 'corrupt' &&
                      session.compatibility !== 'future'
                  )
                  if (alternative) {
                    const switched = await window.desktop.switchSession(
                      alternative.id
                    )
                    if (!switched.ok) {
                      setSessionError(switched.error.message)
                      return
                    }
                    applySnapshot(switched.data)
                  } else {
                    const detached = await window.desktop.newSession()
                    if (!detached.ok) {
                      setSessionError(detached.error.message)
                      return
                    }
                    applySnapshot(detached.data)
                    setTemporarySession(true)
                    setComposerInput('')
                    setReferences([])
                    setAttachments([])
                  }
                }
                const key = runtime.workspacePath
                  ? `${runtime.workspacePath}:${id}`
                  : id
                if (archived) projectionCache.current.delete(key)
                if (archived) attachmentCache.current.delete(key)
                await updateSession(
                  window.desktop.setSessionArchived(
                    activeWorkspaceId,
                    id,
                    archived
                  )
                )
              })()
            }}
            onArchivedExpanded={setArchivedExpanded}
            onDeleteSession={(id) => {
              if (!activeWorkspaceId) return
              void (async () => {
                if (runtime.sessionId === id) {
                  const alternative = sessions.find(
                    (session) =>
                      session.id !== id &&
                      !session.archived &&
                      session.compatibility !== 'corrupt' &&
                      session.compatibility !== 'future'
                  )
                  const left = alternative
                    ? await window.desktop.switchSession(alternative.id)
                    : await window.desktop.newSession()
                  if (!left.ok) {
                    setSessionError(left.error.message)
                    return
                  }
                  applySnapshot(left.data)
                  if (!alternative) {
                    setTemporarySession(true)
                    setComposerInput('')
                    setReferences([])
                  }
                }
                const result = await window.desktop.deleteSession(
                  activeWorkspaceId,
                  id
                )
                if (!result.ok) {
                  setSessionError(result.error.message)
                  return
                }
                const key = runtime.workspacePath
                  ? `${runtime.workspacePath}:${id}`
                  : id
                projectionCache.current.delete(key)
                attachmentCache.current.delete(key)
                clearDraft(localStorage, activeWorkspaceId, id)
                await refreshSessions(activeWorkspaceId, 0, sessionSearch)
              })()
            }}
            onLoadMoreSessions={() => {
              if (activeWorkspaceId)
                void refreshSessions(
                  activeWorkspaceId,
                  sessionNextOffset,
                  sessionSearch,
                  true
                )
            }}
            onLoadMoreWorkspaces={() => {
              const next = workspaceOffset + 50
              setWorkspaceOffset(next)
              void refreshWorkspaces(next)
            }}
            onNewSession={() => {
              if (runtime.isStreaming || runtime.queuedMessageCount > 0) {
                setSessionError('请先 Stop 当前任务')
                return
              }
              setTemporarySession(true)
              setComposerInput('')
              setReferences([])
              setRecentReferences([])
              setAttachments([])
              setProjection(createConversationProjection())
              setSessionError(null)
            }}
            runtime={runtime}
            overview={overview}
            onOpenWorkspace={() => void openWorkspace()}
            onPinSession={(id, pinned) => {
              if (!activeWorkspaceId) return
              void updateSession(
                window.desktop.setSessionPinned(activeWorkspaceId, id, pinned)
              )
            }}
            onPinWorkspace={(id, pinned) => {
              void window.desktop
                .setWorkspacePinned(id, pinned)
                .then((result) => {
                  if (result.ok) setOverview(result.data)
                  else setSessionError(result.error.message)
                })
            }}
            onRenameSession={(id, title) => {
              if (!activeWorkspaceId) return
              void updateSession(
                window.desktop.renameSession(activeWorkspaceId, id, title)
              )
            }}
            onSearch={setSessionSearch}
            onSwitchSession={(id) => void switchSession(id)}
            search={sessionSearch}
            sessions={sessions}
          />
        </Panel>
        <Separator className="resize-handle" id="conversations-files" />
        <Panel defaultSize="17%" id="files" minSize={220}>
          <FileTree runtime={runtime} />
        </Panel>
        <Separator className="resize-handle" id="files-conversation" />
        <Panel defaultSize="65%" id="conversation" minSize={480}>
          <Conversation
            runtime={runtime}
            onSnapshot={applySnapshot}
            projection={projection}
            setProjection={setProjection}
            input={composerInput}
            onInput={updateComposer}
            models={models}
            providers={providers}
            loginState={loginState}
            catalogError={catalogError}
            modelsLoaded={modelsLoaded}
            onRefreshModels={refreshModels}
            onRefreshProviders={refreshProviders}
            workspaceId={activeWorkspaceId}
            references={references}
            onReferences={setReferences}
            temporarySession={temporarySession}
            onSessionCreated={(snapshot) => {
              setTemporarySession(false)
              applySnapshot(snapshot)
              if (activeWorkspaceId)
                void refreshSessions(activeWorkspaceId, 0, sessionSearch)
            }}
            openingSession={openingSession}
            recentReferences={recentReferences}
            onSentReferences={(sent) => {
              setRecentReferences((current) => {
                const merged = [...current, ...sent]
                return merged
                  .filter(
                    (reference, index) =>
                      merged.findLastIndex(
                        (item) => item.id === reference.id
                      ) === index
                  )
                  .slice(-5)
              })
            }}
            attachments={attachments}
            onAttachments={setAttachments}
          />
        </Panel>
      </Group>
    </div>
  )
}
