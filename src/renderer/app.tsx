import {
  CircleStop,
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Plus,
  Search,
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
  LoginProvider,
  ProviderLoginState,
  RuntimeSnapshot
} from '../shared/desktop-api'
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

const fixture = __OMP_UI_FIXTURE__ ? uiFixture : null
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

function ConversationSidebar({
  runtime,
  onOpenWorkspace
}: {
  runtime: RuntimeSnapshot
  onOpenWorkspace: () => void
}): React.JSX.Element {
  return (
    <aside
      className="panel-surface flex h-full min-w-0 flex-col"
      data-slot="conversation-sidebar"
    >
      <div className="flex h-16 items-center justify-between px-5">
        <h1 className="text-[15px] font-semibold">{strings.conversations}</h1>
        <IconButton label={strings.newConversation} icon={<Plus size={17} />} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {strings.workspaces}
          </span>
          <IconButton
            label={strings.openWorkspace}
            icon={<Plus size={15} />}
            disabled={runtime.status === 'starting'}
            onClick={onOpenWorkspace}
          />
        </div>

        {fixture || runtime.workspacePath ? (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm shadow-xs">
              <Folder size={16} />
              <span className="truncate font-medium">
                {fixture?.workspace ?? runtime.workspacePath?.split('/').at(-1)}
              </span>
            </div>
            <p className="mt-7 mb-2 px-2 text-[11px] font-medium text-[var(--text-muted)]">
              最近
            </p>
            <ul className="space-y-1">
              {(fixture?.conversations ?? []).map((conversation, index) => (
                <li key={conversation}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${index === 0 ? 'bg-[var(--surface-selected)]' : ''}`}
                    type="button"
                  >
                    <MessageSquare
                      className="shrink-0 text-[var(--text-muted)]"
                      size={15}
                    />
                    <span className="truncate">{conversation}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-card mt-2" data-slot="workspace-empty-state">
            <Folder size={20} strokeWidth={1.6} />
            <p className="mt-3 text-sm font-medium">{strings.noWorkspace}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              {strings.noWorkspaceHint}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <button
          className="disabled-control w-full justify-start"
          type="button"
          disabled
        >
          <Search size={15} />
          <span>{strings.search}</span>
          <kbd className="ml-auto text-[10px] text-[var(--text-muted)]">
            Ctrl K
          </kbd>
        </button>
      </div>
    </aside>
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
  onRefreshProviders
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
    if (!ready || !message || stopping || sending) return
    if (busy && message.startsWith('/')) {
      setError('任务结束后可执行 Slash Command')
      return
    }
    setError(null)
    setSending(true)
    const result = busy
      ? await window.desktop.followUp({ message })
      : await window.desktop.prompt({ message })
    if (result.ok) {
      setProjection((current) => appendUserTurn(current, message))
      onInput('')
    } else setError(result.error.message)
    setSending(false)
  }

  const restart = async (): Promise<void> => {
    setError(null)
    const result = await window.desktop.restartRuntime()
    if (result.ok) onSnapshot(result.data)
    else setError(result.error.message)
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
        <div className="mx-auto max-w-4xl rounded-2xl border border-[var(--border)] bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
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
                  (!ready || (!busy && input.trim().length === 0)))
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
  const [models, setModels] = useState<AvailableModel[]>([])
  const [providers, setProviders] = useState<LoginProvider[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loginState, setLoginState] = useState<ProviderLoginState>({
    status: 'idle'
  })
  const [projection, setProjection] = useState(createConversationProjection)
  const draftKey = useRef<string | null>(null)
  const projectionSessionId = useRef<string | undefined>(undefined)

  const updateComposer = useCallback((value: string): void => {
    setComposerInput(value)
    if (!draftKey.current) return
    if (value) localStorage.setItem(draftKey.current, value)
    else localStorage.removeItem(draftKey.current)
  }, [])

  const applySnapshot = useCallback((snapshot: RuntimeSnapshot): void => {
    if (snapshot.sessionId !== projectionSessionId.current) {
      projectionSessionId.current = snapshot.sessionId
      setProjection(createConversationProjection())
    }
    const nextDraftKey =
      snapshot.workspacePath && snapshot.sessionId
        ? `omp-draft:${snapshot.workspacePath}:${snapshot.sessionId}`
        : null
    if (nextDraftKey !== draftKey.current) {
      draftKey.current = nextDraftKey
      setComposerInput(
        nextDraftKey ? (localStorage.getItem(nextDraftKey) ?? '') : ''
      )
    }
    setRuntime(snapshot)
  }, [])

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
    return window.desktop.onRuntimeEvent((event) => {
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
  }, [applySnapshot, refreshModels, refreshProviders, updateComposer])

  useEffect(() => {
    if (runtime.status !== 'ready' || !runtime.sessionId) return
    let cancelled = false
    void window.desktop.getMessages().then((result) => {
      if (!cancelled && result.ok) setProjection(projectHistory(result.data))
    })
    return () => {
      cancelled = true
    }
  }, [runtime.sessionId, runtime.status])

  const openWorkspace = async (): Promise<void> => {
    const result = await window.desktop.chooseWorkspace()
    if (result.ok && result.data) applySnapshot(result.data)
  }

  return (
    <div
      className="h-screen min-h-[700px] min-w-[1024px] bg-[var(--surface-app)] text-[var(--text-primary)]"
      data-slot="app-shell"
    >
      <Group className="h-full" id="desktop-layout" orientation="horizontal">
        <Panel defaultSize="18%" id="conversations" minSize={220}>
          <ConversationSidebar
            runtime={runtime}
            onOpenWorkspace={() => void openWorkspace()}
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
          />
        </Panel>
      </Group>
    </div>
  )
}
