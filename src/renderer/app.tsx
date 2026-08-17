import {
  CircleStop,
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Settings2
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { uiFixture } from '../../tests/fixtures/ui-fixture'
import type {
  ApprovalMode,
  AvailableSlashCommand,
  AvailableModel,
  ContextReference,
  LoginProvider,
  ProviderLoginState,
  PromptInput,
  QueuedSessionSubmission,
  RuntimeSnapshot,
  SessionRuntimeState,
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
  removeConversationTurn,
  type ConversationProjection
} from './omp-event-reducer'
import { strings } from './strings'
import {
  cleanExpiredDrafts,
  clearDraft,
  loadDraft,
  saveDraft
} from './draft-store'
import {
  fillSlashCommand,
  fillSlashSubcommand,
  getSlashMenuModel,
  preparePromptSubmission,
  submitSlashCommand,
  submitSlashSubcommand,
  validateAvailableCommands
} from './slash-commands'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceFileTree } from './workspace-file-tree'

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
  'command_output',
  'prompt_result',
  'config_update',
  'session_info_update',
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
  runtime,
  workspaceId,
  onAddReference
}: {
  runtime: RuntimeSnapshot
  workspaceId?: string
  onAddReference: (reference: ContextReference) => Promise<string | undefined>
}): React.JSX.Element {
  if (workspaceId && runtime.workspacePath && !fixture) {
    const workspaceName =
      runtime.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ??
      runtime.workspacePath
    return (
      <WorkspaceFileTree
        onAddReference={onAddReference}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        workspacePath={runtime.workspacePath}
      />
    )
  }
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

type SlashCatalogState = {
  sessionKey?: string
  commands: AvailableSlashCommand[]
  loading: boolean
  error: string | null
  stale: boolean
  hasFreshSnapshot: boolean
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
  temporarySessionId,
  temporaryRuntimeState,
  recovery,
  temporaryApprovalMode,
  onTemporaryApprovalMode,
  onSessionQueued,
  onPromptAccepted,
  onRecoveryConsumed,
  openingSession,
  recentReferences,
  onSentReferences,
  attachments,
  onAttachments,
  slashCatalog,
  onRefreshSlashCommands
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
  temporarySessionId?: string
  temporaryRuntimeState?: SessionRuntimeState
  recovery?: {
    input: PromptInput
    reason: 'cancelled' | 'start-failed' | 'runtime-crashed'
  }
  temporaryApprovalMode: ApprovalMode
  onTemporaryApprovalMode: (mode: ApprovalMode) => void
  onSessionQueued: (submission: QueuedSessionSubmission, title: string) => void
  onPromptAccepted: () => void
  onRecoveryConsumed: (replacement?: PromptInput) => void
  openingSession: boolean
  recentReferences: ContextReference[]
  onSentReferences: (references: ContextReference[]) => void
  attachments: NonNullable<PromptInput['images']>
  onAttachments: (attachments: NonNullable<PromptInput['images']>) => void
  slashCatalog: SlashCatalogState
  onRefreshSlashCommands: () => Promise<void>
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = runtime.isStreaming || runtime.queuedMessageCount > 0
  const currentModelAvailable =
    !modelsLoaded ||
    !runtime.model ||
    models.some((model) => `${model.provider}/${model.id}` === runtime.model)
  const runtimeCanAcceptPrompt =
    runtime.status === 'ready' ||
    ((runtime.status === 'stopped' || runtime.status === 'failed') &&
      Boolean(runtime.workspacePath))
  const ready =
    runtimeCanAcceptPrompt &&
    !runtime.isAuthenticating &&
    currentModelAvailable &&
    temporaryRuntimeState?.phase !== 'queued' &&
    temporaryRuntimeState?.phase !== 'starting'
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const optimisticUserSequence = useRef(0)
  const composerComposingRef = useRef(false)
  const suppressComposerSelectionSyncRef = useRef(false)
  const [composerSelection, setComposerSelection] = useState<number | null>(
    null
  )
  const busyRef = useRef(busy)
  const stoppingRef = useRef(stopping)
  const stopRef = useRef<() => Promise<void>>(async () => undefined)
  const [slashMenuDismissedFor, setSlashMenuDismissedFor] = useState<
    string | null
  >(null)
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const slashMenuSignature = `${slashCatalog.sessionKey ?? ''}\n${input}`
  const slashMenu = useMemo(
    () => getSlashMenuModel(input, composerSelection, slashCatalog.commands),
    [composerSelection, input, slashCatalog.commands]
  )
  const slashCandidates = slashMenu?.candidates ?? []
  const slashMenuOpen =
    !busy &&
    slashMenuDismissedFor !== slashMenuSignature &&
    slashMenu !== null &&
    (slashCandidates.length > 0 || slashCatalog.loading || slashCatalog.error)
  const effectiveSlashSelectionIndex =
    slashCandidates.length > 0
      ? Math.min(slashSelectionIndex, slashCandidates.length - 1)
      : -1
  const selectedCommand =
    slashMenu?.level === 'command'
      ? slashMenu.candidates[Math.max(0, effectiveSlashSelectionIndex)]
      : undefined
  const selectedSubcommand =
    slashMenu?.level === 'subcommand'
      ? slashMenu.candidates[Math.max(0, effectiveSlashSelectionIndex)]
      : undefined

  const stop = async (): Promise<void> => {
    if (!busy || stopping) return
    if (!runtime.sessionId) {
      setError('Session ID 不可用')
      return
    }
    setStopping(true)
    setError(null)
    const result = await window.desktop.stopCurrentRun(runtime.sessionId)
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

  useEffect(() => {
    if (slashMenuOpen) void onRefreshSlashCommands()
  }, [onRefreshSlashCommands, slashMenuOpen])

  useEffect(() => {
    slashItemRefs.current = slashItemRefs.current.slice(
      0,
      slashCandidates.length
    )
    if (!slashMenuOpen || effectiveSlashSelectionIndex < 0) return
    slashItemRefs.current[effectiveSlashSelectionIndex]?.scrollIntoView({
      block: 'nearest'
    })
  }, [effectiveSlashSelectionIndex, slashCandidates.length, slashMenuOpen])

  const focusComposerEnd = (next: string): void => {
    onInput(next)
    setComposerSelection(next.length)
    window.requestAnimationFrame(() => {
      const element = composerRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.length, next.length)
    })
  }

  const send = async (value = input): Promise<void> => {
    const submission = preparePromptSubmission(value, slashCatalog.commands)
    const message = submission.message
    const visibleText = submission.displayText
    if (
      !ready ||
      (!message.trim() &&
        references.length === 0 &&
        attachments.length === 0) ||
      stopping ||
      sending
    )
      return
    if (busy && submission.isSlash) {
      setError(
        slashCatalog.hasFreshSnapshot
          ? '任务结束后可执行 Slash Command'
          : '命令列表不可用，任务结束后再发送'
      )
      return
    }
    setError(null)
    setSending(true)
    const visibleUserText =
      visibleText.trim() || (attachments.length ? '已发送图片' : message)
    const optimisticUserId = `optimistic-user-${++optimisticUserSequence.current}`
    const promptInput = {
      message,
      references,
      ...(attachments.length ? { images: attachments } : {})
    }
    setProjection((current) =>
      appendUserTurn(current, visibleUserText, Date.now(), optimisticUserId)
    )
    onInput('')
    onReferences([])
    onAttachments([])
    const title = visibleText.split(/\r?\n/u)[0]?.trim() || '图片会话'
    const targetSessionId = runtime.sessionId
    if (!temporarySession && !targetSessionId) {
      setProjection((current) =>
        removeConversationTurn(current, optimisticUserId)
      )
      onInput(value)
      onReferences(references)
      onAttachments(attachments)
      setError('Session ID 不可用')
      setSending(false)
      return
    }
    const result =
      temporarySession && !busy
        ? await window.desktop.createSession(
            promptInput,
            title,
            temporaryApprovalMode
          )
        : busy
          ? await window.desktop.followUp(targetSessionId!, promptInput)
          : await window.desktop.prompt(targetSessionId!, promptInput)
    if (result.ok) {
      onSentReferences(references)
      setSlashMenuDismissedFor(null)
      setSlashSelectionIndex(0)
      if (temporarySession && result.data)
        onSessionQueued(result.data as QueuedSessionSubmission, title)
      else onPromptAccepted()
    } else {
      setProjection((current) =>
        removeConversationTurn(current, optimisticUserId)
      )
      onInput(value)
      onReferences(references)
      onAttachments(attachments)
      setError(result.error.message)
    }
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

  const slashMenuPanel = slashMenuOpen ? (
    <div className="slash-menu-panel" data-slot="slash-command-menu">
      <div aria-label="Slash 命令" className="slash-menu-list" role="listbox">
        {slashCatalog.stale && (
          <div className="slash-menu-note">
            命令列表刷新失败，当前显示上次结果
          </div>
        )}
        {slashCatalog.loading && slashCandidates.length === 0 ? (
          <div className="slash-menu-empty">正在加载命令…</div>
        ) : slashCandidates.length > 0 ? (
          slashMenu?.level === 'command' ? (
            slashMenu.candidates.map((command, index) => (
              <button
                aria-selected={index === effectiveSlashSelectionIndex}
                className="slash-menu-item"
                data-selected={index === effectiveSlashSelectionIndex}
                key={command.name}
                onClick={() => focusComposerEnd(fillSlashCommand(command))}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSlashSelectionIndex(index)}
                ref={(element) => {
                  slashItemRefs.current[index] = element
                }}
                role="option"
                type="button"
              >
                <span className="slash-menu-primary">
                  <span className="truncate">/{command.name}</span>
                  {command.input?.hint && (
                    <span className="slash-menu-hint truncate">
                      {command.input.hint}
                    </span>
                  )}
                </span>
                <span className="slash-menu-description truncate">
                  {command.description ?? ''}
                </span>
                <span className="slash-menu-source">{command.source}</span>
              </button>
            ))
          ) : slashMenu ? (
            slashMenu.candidates.map((subcommand, index) => (
              <button
                aria-selected={index === effectiveSlashSelectionIndex}
                className="slash-menu-item"
                data-selected={index === effectiveSlashSelectionIndex}
                key={subcommand.name}
                onClick={() =>
                  focusComposerEnd(
                    fillSlashSubcommand(slashMenu.command, subcommand)
                  )
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSlashSelectionIndex(index)}
                ref={(element) => {
                  slashItemRefs.current[index] = element
                }}
                role="option"
                type="button"
              >
                <span className="slash-menu-primary">
                  <span className="truncate">{subcommand.name}</span>
                </span>
                <span className="slash-menu-description truncate">
                  {subcommand.usage ?? subcommand.description ?? ''}
                </span>
                <span className="slash-menu-source">
                  {slashMenu.command.source}
                </span>
              </button>
            ))
          ) : null
        ) : slashCatalog.error ? (
          <div className="slash-menu-empty">{slashCatalog.error}</div>
        ) : null}
      </div>
    </div>
  ) : null

  const conversation = (
    <main
      className="flex h-full min-w-0 flex-col bg-[var(--surface-main)]"
      data-slot="conversation-main"
      data-runtime-session-id={runtime.sessionId}
      data-temporary-session={temporarySession ? 'true' : 'false'}
      data-temporary-session-id={temporarySessionId}
    >
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--border-subtle)] px-7">
        <div>
          <h2 className="text-[15px] font-semibold">
            {fixture
              ? fixture.activeConversation
              : (runtime.sessionName ?? strings.appName)}
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
        ) : projection.turns.length > 0 ||
          (runtime.toolApprovals?.length ?? 0) > 0 ? (
          <ThreadMessages toolApprovals={runtime.toolApprovals} />
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
          {temporaryRuntimeState?.phase === 'queued' && temporarySessionId && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--surface-selected)] px-3 py-2 text-xs">
              <span>
                等待 Runtime
                {temporaryRuntimeState.queuePosition
                  ? ` · 队列位置 ${temporaryRuntimeState.queuePosition}`
                  : ''}
              </span>
              <button
                className="ml-auto underline underline-offset-2"
                onClick={() => {
                  void window.desktop
                    .cancelQueuedSession(temporarySessionId)
                    .then((result) => {
                      if (!result.ok) setError(result.error.message)
                    })
                }}
                type="button"
              >
                取消等待
              </button>
            </div>
          )}
          {recovery && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>
                {recovery.reason === 'cancelled'
                  ? '已取消的消息'
                  : recovery.reason === 'runtime-crashed'
                    ? 'Runtime 崩溃时的消息'
                    : '启动失败的消息'}
              </span>
              <button
                className="ml-auto underline underline-offset-2"
                onClick={() => {
                  const previous = {
                    message: input,
                    references,
                    ...(attachments.length ? { images: attachments } : {})
                  }
                  onInput(recovery.input.message)
                  onReferences(recovery.input.references ?? [])
                  onAttachments(recovery.input.images ?? [])
                  const hasPrevious =
                    previous.message ||
                    previous.references.length ||
                    previous.images?.length
                  onRecoveryConsumed(hasPrevious ? previous : undefined)
                }}
                type="button"
              >
                恢复到输入框
              </button>
            </div>
          )}
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
            temporaryApprovalMode={temporaryApprovalMode}
            temporarySession={temporarySession}
            onTemporaryApprovalMode={onTemporaryApprovalMode}
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
          {!fixture && slashMenuPanel}
          <textarea
            ref={composerRef}
            aria-label="任务输入"
            className="h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
            disabled={
              (!ready && !runtime.approvalModeChanging) || stopping || sending
            }
            onChange={(event) => {
              setComposerSelection(event.currentTarget.selectionStart)
              setSlashMenuDismissedFor(null)
              setSlashSelectionIndex(0)
              onInput(event.target.value)
            }}
            onCompositionEnd={() => {
              composerComposingRef.current = false
            }}
            onCompositionStart={() => {
              composerComposingRef.current = true
            }}
            onKeyDown={(event) => {
              if (slashMenuOpen && event.key === 'Escape') {
                event.preventDefault()
                setSlashMenuDismissedFor(slashMenuSignature)
                return
              }
              if (
                slashMenuOpen &&
                slashCandidates.length > 0 &&
                (event.key === 'ArrowDown' || event.key === 'ArrowUp')
              ) {
                event.preventDefault()
                suppressComposerSelectionSyncRef.current = true
                queueMicrotask(() => {
                  suppressComposerSelectionSyncRef.current = false
                })
                const delta = event.key === 'ArrowDown' ? 1 : -1
                setSlashSelectionIndex(
                  (current) =>
                    (current + delta + slashCandidates.length) %
                    slashCandidates.length
                )
                return
              }
              if (
                slashMenuOpen &&
                slashCandidates.length > 0 &&
                event.key === 'Tab'
              ) {
                event.preventDefault()
                if (slashMenu?.level === 'command' && selectedCommand) {
                  focusComposerEnd(fillSlashCommand(selectedCommand))
                } else if (
                  slashMenu?.level === 'subcommand' &&
                  selectedSubcommand
                ) {
                  focusComposerEnd(
                    fillSlashSubcommand(slashMenu.command, selectedSubcommand)
                  )
                }
                return
              }
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !composerComposingRef.current &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                if (
                  slashMenuOpen &&
                  slashCandidates.length > 0 &&
                  !slashCatalog.loading
                ) {
                  if (slashMenu?.level === 'command' && selectedCommand) {
                    void send(submitSlashCommand(selectedCommand))
                    return
                  }
                  if (slashMenu?.level === 'subcommand' && selectedSubcommand) {
                    void send(
                      submitSlashSubcommand(
                        slashMenu.command,
                        selectedSubcommand
                      )
                    )
                    return
                  }
                }
                void send()
              }
            }}
            onClick={(event) =>
              setComposerSelection(event.currentTarget.selectionStart)
            }
            onPaste={pasteImages}
            placeholder={strings.composerPlaceholder}
            onSelect={(event) => {
              if (suppressComposerSelectionSyncRef.current) return
              setComposerSelection(event.currentTarget.selectionStart)
            }}
            value={input}
          />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-[var(--text-muted)]">
              {error ??
                (runtime.approvalModeSaved === false
                  ? '权限保存失败'
                  : undefined) ??
                runtime.compatibilityNotice ??
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
      sessionId={runtime.sessionId}
      setProjection={setProjection}
      workspacePath={runtime.workspacePath}
    >
      {conversation}
    </ConversationRuntime>
  )
}

export function App(): React.JSX.Element {
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({
    status: 'stopped',
    isStreaming: false,
    queuedMessageCount: 0,
    approvalMode: 'yolo'
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
  const [sessionRuntimeStates, setSessionRuntimeStates] = useState<
    Record<string, SessionRuntimeState>
  >({})
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionNextOffset, setSessionNextOffset] = useState(0)
  const [hasMoreSessions, setHasMoreSessions] = useState(false)
  const [workspaceOffset, setWorkspaceOffset] = useState(0)
  const [temporarySession, setTemporarySession] = useState(false)
  const [temporarySessionId, setTemporarySessionId] = useState<
    string | undefined
  >()
  const [recoveries, setRecoveries] = useState<
    Record<
      string,
      {
        input: PromptInput
        reason: 'cancelled' | 'start-failed' | 'runtime-crashed'
      }
    >
  >({})
  const [temporaryApprovalMode, setTemporaryApprovalMode] =
    useState<ApprovalMode>('yolo')
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [draftStatus, setDraftStatus] = useState<string | null>(null)
  const [openingSession, setOpeningSession] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const [slashCatalog, setSlashCatalog] = useState<SlashCatalogState>({
    commands: [],
    loading: false,
    error: null,
    stale: false,
    hasFreshSnapshot: false
  })
  const projectionSessionId = useRef<string | undefined>(undefined)
  const skipHistoryRestoreKey = useRef<string | undefined>(undefined)
  const projectionRef = useRef(projection)
  const projectionCache = useRef(new Map<string, ConversationProjection>())
  const attachmentCache = useRef(
    new Map<string, NonNullable<PromptInput['images']>>()
  )
  const slashCatalogCache = useRef(new Map<string, AvailableSlashCommand[]>())
  const slashRequest = useRef<Promise<void> | null>(null)
  const slashRequestKey = useRef<string | undefined>(undefined)
  const sessionRequestId = useRef(0)
  const workspaceRequestPending = useRef(false)
  const runtimeReadyRef = useRef(false)
  const temporarySessionRef = useRef(temporarySession)
  const temporarySessionIdRef = useRef(temporarySessionId)
  const activeWorkspaceId = overview.activeWorkspaceId
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  const sessionSearchRef = useRef(sessionSearch)
  const runtimeRef = useRef(runtime)
  const overviewRef = useRef(overview)
  const composerInputRef = useRef(composerInput)
  const referencesRef = useRef(references)
  const attachmentsRef = useRef(attachments)
  const temporaryWorkspacePaths = useRef(new Map<string, string>())
  const temporaryBindings = useRef(new Map<string, string>())
  const restoredRuntimeGenerations = useRef(new Set<string>())
  const temporaryBaseSessionIdRef = useRef<string | undefined>(undefined)
  const currentProjectionKey = runtimeSessionKey(runtime)
  const visibleRuntime = useMemo(
    () =>
      temporarySession
        ? {
            ...runtime,
            sessionId: temporarySessionId,
            sessionName: undefined,
            isStreaming: false,
            queuedMessageCount: 0,
            toolApprovals: []
          }
        : runtime,
    [runtime, temporarySession, temporarySessionId]
  )

  useLayoutEffect(() => {
    projectionRef.current = projection
    runtimeRef.current = runtime
    overviewRef.current = overview
    composerInputRef.current = composerInput
    referencesRef.current = references
    attachmentsRef.current = attachments
    temporarySessionRef.current = temporarySession
    temporarySessionIdRef.current = temporarySessionId
  }, [
    attachments,
    composerInput,
    overview,
    projection,
    references,
    runtime,
    temporarySession,
    temporarySessionId
  ])

  useLayoutEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
    sessionSearchRef.current = sessionSearch
  }, [activeWorkspaceId, sessionSearch])

  const updateComposer = useCallback((value: string): void => {
    setComposerInput(value)
  }, [])

  const applySnapshot = useCallback(
    (snapshot: RuntimeSnapshot, preserveProjection = false): void => {
      const nextProjectionId = runtimeSessionKey(snapshot)
      if (nextProjectionId !== projectionSessionId.current) {
        projectionSessionId.current = nextProjectionId
        if (!preserveProjection && !temporarySessionRef.current)
          setProjection(createConversationProjection())
      }
      setSlashCatalog((current) => {
        if (current.sessionKey === nextProjectionId) return current
        const cached = nextProjectionId
          ? (slashCatalogCache.current.get(nextProjectionId) ?? [])
          : []
        return {
          sessionKey: nextProjectionId,
          commands: cached,
          loading: false,
          error: null,
          stale: false,
          hasFreshSnapshot: cached.length > 0
        }
      })
      runtimeRef.current = snapshot
      setRuntime(snapshot)
    },
    []
  )

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
      append = false,
      preserveOrder = false
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
      setSessions((current) => {
        if (append) return [...current, ...result.data.sessions]
        if (!preserveOrder) return result.data.sessions
        const fresh = new Map(
          result.data.sessions.map((session) => [session.id, session])
        )
        const ordered = current.flatMap((session) => {
          const replacement = fresh.get(session.id)
          if (!replacement)
            return session.id.startsWith('temporary-') ? [session] : []
          fresh.delete(session.id)
          return [
            session.unreadCompletion
              ? { ...replacement, unreadCompletion: true }
              : replacement
          ]
        })
        return [...ordered, ...fresh.values()]
      })
      setSessionNextOffset(result.data.nextOffset)
      setHasMoreSessions(result.data.hasMore)
      setSessionError(null)
    },
    []
  )

  const resetSessionsForWorkspaceChange = useCallback((): void => {
    sessionRequestId.current += 1
    temporaryBaseSessionIdRef.current = undefined
    setSessions([])
    setSessionNextOffset(0)
    setHasMoreSessions(false)
    setOpeningSession(false)
    setSessionError(null)
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

  const refreshSlashCommands = useCallback(async (): Promise<void> => {
    if (fixture) return
    const sessionKey = runtimeSessionKey(runtimeRef.current)
    if (runtimeRef.current.status !== 'ready' || !sessionKey) {
      setSlashCatalog((current) => ({
        ...current,
        sessionKey,
        loading: false
      }))
      return
    }
    if (slashRequest.current && slashRequestKey.current === sessionKey) {
      await slashRequest.current
      return
    }
    const cached = slashCatalogCache.current.get(sessionKey) ?? []
    setSlashCatalog({
      sessionKey,
      commands: cached,
      loading: true,
      error: null,
      stale: false,
      hasFreshSnapshot: cached.length > 0
    })
    const request = window.desktop
      .getAvailableCommands()
      .then((result) => {
        if (slashRequestKey.current !== sessionKey) return
        if (result.ok) {
          slashCatalogCache.current.set(sessionKey, result.data)
          setSlashCatalog({
            sessionKey,
            commands: result.data,
            loading: false,
            error: null,
            stale: false,
            hasFreshSnapshot: true
          })
          return
        }
        const previous = slashCatalogCache.current.get(sessionKey) ?? []
        setSlashCatalog({
          sessionKey,
          commands: previous,
          loading: false,
          error: result.error.message,
          stale: previous.length > 0,
          hasFreshSnapshot: previous.length > 0
        })
      })
      .finally(() => {
        if (slashRequestKey.current === sessionKey) {
          slashRequest.current = null
          slashRequestKey.current = undefined
        }
      })
    slashRequest.current = request
    slashRequestKey.current = sessionKey
    await request
  }, [])

  const refreshCatalogWhenReady = useCallback(
    (snapshot: RuntimeSnapshot): void => {
      if (snapshot.status !== 'ready') {
        runtimeReadyRef.current = false
        return
      }
      if (runtimeReadyRef.current) return
      runtimeReadyRef.current = true
      void refreshModels()
      void refreshProviders()
      void window.desktop.getProviderLoginState().then((result) => {
        if (result.ok) setLoginState(result.data)
      })
    },
    [refreshModels, refreshProviders]
  )

  useEffect(() => {
    cleanExpiredDrafts(localStorage)
    const workspaceTimer = window.setTimeout(() => void refreshWorkspaces(), 0)
    void window.desktop.getRuntimeState().then((result) => {
      if (result.ok) {
        applySnapshot(result.data)
        refreshCatalogWhenReady(result.data)
      }
    })
    const unsubscribe = window.desktop.onRuntimeEvent((event) => {
      if (event.type === 'snapshot') {
        applySnapshot(event.snapshot)
        refreshCatalogWhenReady(event.snapshot)
      }
      if (event.type === 'session-runtime' && event.state.sessionId) {
        setSessionRuntimeStates((current) => ({
          ...current,
          [event.state.sessionId!]: event.state
        }))
      }
      if (event.type === 'pool-snapshot') {
        setSessionRuntimeStates(
          Object.fromEntries(
            event.states.flatMap((state) =>
              state.sessionId ? [[state.sessionId, state]] : []
            )
          )
        )
        const activeWorkspace = overviewRef.current.workspaces.find(
          (workspace) => workspace.id === overviewRef.current.activeWorkspaceId
        )
        const temporaryStates = event.states.filter(
          (state) =>
            state.temporary &&
            state.sessionId &&
            state.workspacePath === activeWorkspace?.path
        )
        for (const state of temporaryStates) {
          if (state.sessionId && state.workspacePath) {
            temporaryWorkspacePaths.current.set(
              state.sessionId,
              state.workspacePath
            )
            const key = `${state.workspacePath}:${state.sessionId}`
            if (state.temporaryInput && !projectionCache.current.has(key))
              projectionCache.current.set(
                key,
                appendUserTurn(
                  createConversationProjection(),
                  state.temporaryInput.message,
                  Date.now(),
                  `temporary-user-${state.sessionId}`
                )
              )
            if (state.visible) {
              setTemporarySession(true)
              setTemporarySessionId(state.sessionId)
              const cached = projectionCache.current.get(key)
              if (cached) setProjection(cached)
            }
          }
        }
        if (activeWorkspace && temporaryStates.length > 0) {
          const now = new Date().toISOString()
          setSessions((current) => {
            const temporaryIds = new Set(
              temporaryStates.flatMap((state) =>
                state.sessionId ? [state.sessionId] : []
              )
            )
            const restored = temporaryStates.flatMap((state) =>
              state.sessionId
                ? [
                    {
                      id: state.sessionId,
                      workspaceId: activeWorkspace.id,
                      path: `temporary:${state.sessionId}`,
                      title: state.snapshot.sessionName ?? '新对话',
                      createdAt: now,
                      modifiedAt: now,
                      messageCount: 1,
                      size: 0,
                      pinned: false,
                      archived: false,
                      compatibility: 'v3' as const,
                      status: 'pending' as const
                    }
                  ]
                : []
            )
            return [
              ...restored,
              ...current.filter((session) => !temporaryIds.has(session.id))
            ]
          })
        }
        for (const state of event.states) {
          if (
            state.temporary ||
            !state.sessionId ||
            !state.workspacePath ||
            (state.phase !== 'running' &&
              state.phase !== 'waiting-interaction' &&
              state.phase !== 'stopping')
          )
            continue
          const generationKey = `${state.runtimeInstanceId}:${state.generation}`
          if (restoredRuntimeGenerations.current.has(generationKey)) continue
          restoredRuntimeGenerations.current.add(generationKey)
          const projectionKey = `${state.workspacePath}:${state.sessionId}`
          void window.desktop
            .getSessionMessages(state.sessionId)
            .then((result) => {
              if (!result.ok) {
                restoredRuntimeGenerations.current.delete(generationKey)
                return
              }
              const restored = (state.pendingExtensionUi ?? []).reduce(
                (current, pendingEvent) =>
                  reduceOmpEvent(current, pendingEvent),
                projectHistory(result.data)
              )
              projectionCache.current.set(projectionKey, restored)
              if (
                runtimeSessionKey(runtimeRef.current) === projectionKey &&
                temporarySessionIdRef.current === undefined
              )
                setProjection(restored)
            })
        }
      }
      if (event.type === 'temporary-session-bound') {
        if (event.snapshot.sessionId)
          temporaryBindings.current.set(
            event.temporarySessionId,
            event.snapshot.sessionId
          )
        const workspacePath = temporaryWorkspacePaths.current.get(
          event.temporarySessionId
        )
        const oldKey = workspacePath
          ? `${workspacePath}:${event.temporarySessionId}`
          : undefined
        const newKey = runtimeSessionKey(event.snapshot)
        const cached = oldKey ? projectionCache.current.get(oldKey) : undefined
        if (oldKey) projectionCache.current.delete(oldKey)
        if (newKey && cached) projectionCache.current.set(newKey, cached)
        temporaryWorkspacePaths.current.delete(event.temporarySessionId)
        setSessionRuntimeStates((current) => {
          const next = { ...current }
          delete next[event.temporarySessionId]
          if (event.snapshot.sessionId)
            next[event.snapshot.sessionId] = {
              runtimeInstanceId: 'bound',
              generation: 0,
              workspacePath: event.snapshot.workspacePath,
              sessionId: event.snapshot.sessionId,
              phase: event.snapshot.isStreaming ? 'running' : 'idle',
              snapshot: event.snapshot
            }
          return next
        })
        setSessions((current) => {
          const temporary = current.find(
            (session) => session.id === event.temporarySessionId
          )
          const replacement =
            event.session ??
            (event.snapshot.sessionId && temporary
              ? {
                  ...temporary,
                  id: event.snapshot.sessionId,
                  path: event.snapshot.sessionPath ?? temporary.path,
                  status: 'pending' as const
                }
              : event.snapshot.sessionId && event.snapshot.workspacePath
                ? {
                    id: event.snapshot.sessionId,
                    workspaceId:
                      overviewRef.current.workspaces.find(
                        (workspace) =>
                          workspace.path === event.snapshot.workspacePath
                      )?.id ?? '',
                    path:
                      event.snapshot.sessionPath ??
                      `session:${event.snapshot.sessionId}`,
                    title: event.snapshot.sessionName ?? '新对话',
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString(),
                    messageCount: 1,
                    size: 0,
                    pinned: false,
                    archived: false,
                    compatibility: 'v3' as const,
                    status: 'pending' as const
                  }
                : undefined)
          return replacement
            ? [
                replacement,
                ...current.filter(
                  (session) =>
                    session.id !== event.temporarySessionId &&
                    session.id !== replacement.id
                )
              ]
            : current.filter(
                (session) => session.id !== event.temporarySessionId
              )
        })
        if (!event.session && activeWorkspaceIdRef.current)
          void refreshSessions(
            activeWorkspaceIdRef.current,
            0,
            sessionSearchRef.current
          )
        if (
          temporarySessionIdRef.current === event.temporarySessionId &&
          event.active
        ) {
          setTemporarySession(false)
          setTemporarySessionId(undefined)
          skipHistoryRestoreKey.current = newKey
          applySnapshot(event.snapshot, true)
          if (cached) setProjection(cached)
        }
      }
      if (event.type === 'temporary-session-failed') {
        const workspacePath = temporaryWorkspacePaths.current.get(
          event.temporarySessionId
        )
        const key = workspacePath
          ? `${workspacePath}:${event.temporarySessionId}`
          : undefined
        const removeOptimistic = (
          current: ConversationProjection
        ): ConversationProjection => {
          const optimistic = [...current.turns]
            .reverse()
            .find(
              (turn) =>
                turn.role === 'user' && turn.id.startsWith('optimistic-user-')
            )
          return optimistic
            ? removeConversationTurn(current, optimistic.id)
            : current
        }
        if (key) {
          const cached = projectionCache.current.get(key)
          if (cached) projectionCache.current.set(key, removeOptimistic(cached))
        }
        const isActive =
          temporarySessionIdRef.current === event.temporarySessionId
        if (event.reason !== 'cancelled')
          setSessionRuntimeStates((current) => ({
            ...current,
            [event.temporarySessionId]: {
              runtimeInstanceId: `failed:${event.temporarySessionId}`,
              generation: 0,
              workspacePath,
              sessionId: event.temporarySessionId,
              phase: 'failed',
              temporary: true,
              snapshot: {
                status: 'failed',
                ...(workspacePath ? { workspacePath } : {}),
                sessionId: event.temporarySessionId,
                isStreaming: false,
                queuedMessageCount: 0,
                error: event.error
              }
            }
          }))
        if (isActive) setProjection((current) => removeOptimistic(current))
        const composerEmpty =
          !composerInputRef.current &&
          referencesRef.current.length === 0 &&
          attachmentsRef.current.length === 0
        if (isActive && composerEmpty) {
          updateComposer(event.input.message)
          setReferences(event.input.references ?? [])
          setAttachments(event.input.images ?? [])
        } else {
          setRecoveries((current) => ({
            ...current,
            [event.temporarySessionId]: {
              input: event.input,
              reason: event.reason
            }
          }))
        }
      }
      if (event.type === 'workspace-activation-failed')
        setSessionError(event.error.message)
      if (event.type === 'provider-login') setLoginState(event.state)
      const handleOmpEvent = (ompEvent: {
        type: string
        [key: string]: unknown
      }): void => {
        const routing = ompEvent['__desktop']
        const routedSessionId =
          routing && typeof routing === 'object' && !Array.isArray(routing)
            ? (routing as { sessionId?: unknown }).sessionId
            : undefined
        const routedWorkspacePath =
          routing && typeof routing === 'object' && !Array.isArray(routing)
            ? (routing as { workspacePath?: unknown }).workspacePath
            : undefined
        if (
          typeof routedSessionId === 'string' &&
          routedSessionId !== runtimeRef.current.sessionId
        ) {
          if (ompEvent.type === 'runtime_interrupted') {
            const input = ompEvent['input']
            if (input && typeof input === 'object' && !Array.isArray(input))
              setRecoveries((current) => ({
                ...current,
                [routedSessionId]: {
                  input: input as PromptInput,
                  reason: 'runtime-crashed'
                }
              }))
          }
          if (typeof routedWorkspacePath === 'string') {
            const key = `${routedWorkspacePath}:${routedSessionId}`
            const current =
              projectionCache.current.get(key) ?? createConversationProjection()
            projectionCache.current.set(key, reduceOmpEvent(current, ompEvent))
          }
          if (
            ompEvent.type === 'agent_end' ||
            ompEvent.type === 'session_info_update'
          ) {
            if (ompEvent.type === 'agent_end') {
              setSessions((current) =>
                current.map((session) =>
                  session.id === routedSessionId
                    ? { ...session, unreadCompletion: true }
                    : session
                )
              )
              setOverview((current) => ({
                ...current,
                workspaces: current.workspaces.map((workspace) =>
                  workspace.path === routedWorkspacePath
                    ? { ...workspace, unreadCompletion: true }
                    : workspace
                )
              }))
            }
            const workspaceId = activeWorkspaceIdRef.current
            if (workspaceId)
              void refreshSessions(
                workspaceId,
                0,
                sessionSearchRef.current,
                false,
                true
              )
          }
          return
        }
        const temporaryCreationRunning =
          temporarySessionRef.current &&
          runtimeRef.current.isStreaming &&
          Boolean(runtimeRef.current.sessionId) &&
          runtimeRef.current.sessionId !== temporaryBaseSessionIdRef.current
        if (ompEvent.type === 'runtime_interrupted') {
          if (temporarySessionRef.current && !temporaryCreationRunning) return
          const input = ompEvent['input']
          if (
            input &&
            typeof input === 'object' &&
            !Array.isArray(input) &&
            typeof (input as { message?: unknown }).message === 'string'
          ) {
            const restored = input as PromptInput
            const currentSessionId = runtimeRef.current.sessionId
            const composerEmpty =
              !composerInputRef.current &&
              referencesRef.current.length === 0 &&
              attachmentsRef.current.length === 0
            if (composerEmpty) {
              updateComposer(restored.message)
              setReferences(restored.references ?? [])
              setAttachments(restored.images ?? [])
            } else if (currentSessionId) {
              setRecoveries((current) => ({
                ...current,
                [currentSessionId]: {
                  input: restored,
                  reason: 'runtime-crashed'
                }
              }))
            }
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
        if (ompEvent.type === 'available_commands_update') {
          const sessionKey = runtimeSessionKey(runtimeRef.current)
          if (!sessionKey) return
          const commands = validateAvailableCommands(ompEvent)
          if (!commands) {
            window.desktop.log({
              level: 'error',
              message: 'OMP 返回了无效命令目录快照'
            })
            const previous = slashCatalogCache.current.get(sessionKey) ?? []
            setSlashCatalog({
              sessionKey,
              commands: previous,
              loading: false,
              error: '命令列表刷新失败',
              stale: previous.length > 0,
              hasFreshSnapshot: previous.length > 0
            })
            return
          }
          slashCatalogCache.current.set(sessionKey, commands)
          setSlashCatalog({
            sessionKey,
            commands,
            loading: false,
            error: null,
            stale: false,
            hasFreshSnapshot: true
          })
          return
        }
        const workspaceId = activeWorkspaceIdRef.current
        if (
          (ompEvent.type === 'agent_end' ||
            ompEvent.type === 'session_info_update') &&
          workspaceId
        ) {
          void refreshSessions(
            workspaceId,
            0,
            sessionSearchRef.current,
            false,
            true
          )
        }
        if (!knownOmpEventTypes.has(ompEvent.type)) {
          window.desktop.log({
            level: 'debug',
            message: `忽略未知 OMP 事件：${ompEvent.type}`
          })
          return
        }
        if (temporarySessionRef.current && !temporaryCreationRunning) return
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
    refreshCatalogWhenReady,
    refreshSessions,
    refreshWorkspaces,
    updateComposer
  ])

  useEffect(() => {
    if (
      runtime.status === 'ready' &&
      runtime.workspacePath &&
      runtime.sessionId
    ) {
      void refreshSlashCommands()
    }
  }, [
    refreshSlashCommands,
    runtime.sessionId,
    runtime.status,
    runtime.workspacePath
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
    const workspace = overview.workspaces.find(
      (item) => item.id === activeWorkspaceId
    )
    if (!workspace) return
    const temporaryStates = Object.values(sessionRuntimeStates).filter(
      (state) =>
        state.temporary &&
        state.sessionId &&
        state.workspacePath === workspace.path
    )
    if (temporaryStates.length === 0) return
    const timer = window.setTimeout(() => {
      const now = new Date().toISOString()
      setSessions((current) => {
        const existing = new Set(current.map((session) => session.id))
        const missing = temporaryStates.flatMap((state) =>
          state.sessionId && !existing.has(state.sessionId)
            ? [
                {
                  id: state.sessionId,
                  workspaceId: workspace.id,
                  path: `temporary:${state.sessionId}`,
                  title: state.snapshot.sessionName ?? '新对话',
                  createdAt: now,
                  modifiedAt: now,
                  messageCount: 1,
                  size: 0,
                  pinned: false,
                  archived: false,
                  compatibility: 'v3' as const,
                  status: 'pending' as const
                }
              ]
            : []
        )
        return missing.length ? [...missing, ...current] : current
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, overview.workspaces, sessionRuntimeStates])

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
    if (temporarySession) return
    if (
      runtime.status !== 'ready' ||
      !runtime.sessionId ||
      !currentProjectionKey
    )
      return
    if (skipHistoryRestoreKey.current === currentProjectionKey) {
      skipHistoryRestoreKey.current = undefined
      projectionCache.current.set(currentProjectionKey, projectionRef.current)
      return
    }
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
        while (projectionCache.current.size > 12) {
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
  }, [
    currentProjectionKey,
    runtime.sessionId,
    runtime.status,
    temporarySession
  ])

  const openWorkspace = async (): Promise<void> => {
    if (workspaceRequestPending.current) return
    workspaceRequestPending.current = true
    setOpeningWorkspace(true)
    try {
      const result = await window.desktop.chooseWorkspace()
      if (result.ok && result.data) {
        const { workspace, snapshot } = result.data
        resetSessionsForWorkspaceChange()
        setTemporarySession(false)
        setTemporarySessionId(undefined)
        setTemporaryApprovalMode('yolo')
        setComposerInput('')
        setReferences([])
        setAttachments([])
        setOverview((current) => ({
          ...current,
          activeWorkspaceId: workspace.id,
          workspaces: [
            workspace,
            ...current.workspaces.filter((item) => item.id !== workspace.id)
          ]
        }))
        applySnapshot(snapshot)
        void refreshWorkspaces()
      } else if (!result.ok) setSessionError(result.error.message)
    } finally {
      workspaceRequestPending.current = false
      setOpeningWorkspace(false)
    }
  }

  const activateWorkspace = async (workspaceId: string): Promise<void> => {
    if (workspaceId === activeWorkspaceId || workspaceRequestPending.current)
      return
    workspaceRequestPending.current = true
    setSwitchingWorkspace(true)
    resetSessionsForWorkspaceChange()
    try {
      const result = await window.desktop.activateWorkspace(workspaceId)
      if (!result.ok) {
        setSessionError(result.error.message)
        if (activeWorkspaceId)
          void refreshSessions(activeWorkspaceId, 0, sessionSearch)
        return
      }
      setTemporarySession(false)
      setTemporarySessionId(undefined)
      setTemporaryApprovalMode('yolo')
      setComposerInput('')
      setReferences([])
      setRecentReferences([])
      setAttachments([])
      applySnapshot(result.data)
      setOverview((current) => ({ ...current, activeWorkspaceId: workspaceId }))
      void refreshWorkspaces()
    } finally {
      workspaceRequestPending.current = false
      setSwitchingWorkspace(false)
    }
  }

  const switchSession = async (sessionId: string): Promise<void> => {
    if (sessionId.startsWith('temporary-')) {
      const currentCacheKey = runtimeSessionKey(runtime)
      if (currentCacheKey)
        projectionCache.current.set(currentCacheKey, projectionRef.current)
      const workspacePath =
        temporaryWorkspacePaths.current.get(sessionId) ?? runtime.workspacePath
      const targetKey = workspacePath
        ? `${workspacePath}:${sessionId}`
        : sessionId
      setProjection(
        projectionCache.current.get(targetKey) ?? createConversationProjection()
      )
      setTemporarySession(true)
      setTemporarySessionId(sessionId)
      setOpeningSession(false)
      setComposerInput('')
      setReferences([])
      setAttachments(attachmentCache.current.get(targetKey) ?? [])
      if (sessionRuntimeStates[sessionId]) {
        const result = await window.desktop.selectTemporarySession(sessionId)
        if (!result.ok && result.error.code !== 'SESSION_NOT_FOUND')
          setSessionError(result.error.message)
      }
      return
    }
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
    setTemporarySessionId(undefined)
    temporaryBaseSessionIdRef.current = undefined
    setTemporaryApprovalMode('yolo')
    if (temporarySession) setComposerInput('')
    setRecentReferences([])
    setAttachments(attachmentCache.current.get(targetCacheKey) ?? [])
    applySnapshot(result.data)
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, unreadCompletion: false }
          : session
      )
    )
    void refreshWorkspaces()
    setSessionError(null)
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
                    temporaryBaseSessionIdRef.current = detached.data.sessionId
                    setTemporarySession(true)
                    setTemporarySessionId(undefined)
                    setOpeningSession(false)
                    setTemporaryApprovalMode('yolo')
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
                    temporaryBaseSessionIdRef.current = left.data.sessionId
                    setTemporarySession(true)
                    setTemporarySessionId(undefined)
                    setOpeningSession(false)
                    setTemporaryApprovalMode('yolo')
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
              temporaryBaseSessionIdRef.current = runtimeRef.current.sessionId
              setTemporarySession(true)
              setTemporarySessionId(undefined)
              setOpeningSession(false)
              setTemporaryApprovalMode('yolo')
              setComposerInput('')
              setReferences([])
              setRecentReferences([])
              setAttachments([])
              setProjection(createConversationProjection())
              setSessionError(null)
            }}
            runtime={visibleRuntime}
            overview={overview}
            onOpenWorkspace={() => void openWorkspace()}
            openingWorkspace={openingWorkspace}
            switchingWorkspace={switchingWorkspace}
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
            onStopSession={(id) => {
              void window.desktop.stopSession(id).then((result) => {
                if (!result.ok) setSessionError(result.error.message)
              })
            }}
            search={sessionSearch}
            sessionRuntimeStates={sessionRuntimeStates}
            sessions={sessions}
          />
        </Panel>
        <Separator className="resize-handle" id="conversations-files" />
        <Panel defaultSize="17%" id="files" minSize={220}>
          <FileTree
            onAddReference={async (reference) => {
              if (!activeWorkspaceId) return '当前 Workspace 不可用'
              const result = await window.desktop.resolveWorkspaceReferences(
                activeWorkspaceId,
                [reference]
              )
              if (!result.ok) return result.error.message
              const resolved = result.data.references[0]
              if (!resolved) return '文件或目录不可引用'
              setReferences((current) =>
                current.some((item) => item.id === resolved.id)
                  ? current
                  : [...current, resolved]
              )
              return undefined
            }}
            runtime={visibleRuntime}
            workspaceId={activeWorkspaceId}
          />
        </Panel>
        <Separator className="resize-handle" id="files-conversation" />
        <Panel defaultSize="65%" id="conversation" minSize={480}>
          <Conversation
            runtime={visibleRuntime}
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
            temporarySessionId={temporarySessionId}
            temporaryRuntimeState={
              temporarySessionId
                ? sessionRuntimeStates[temporarySessionId]
                : undefined
            }
            recovery={recoveries[temporarySessionId ?? runtime.sessionId ?? '']}
            temporaryApprovalMode={temporaryApprovalMode}
            onTemporaryApprovalMode={setTemporaryApprovalMode}
            onSessionQueued={(submission, title) => {
              if (temporaryBindings.current.has(submission.temporarySessionId))
                return
              const workspacePath = runtime.workspacePath
              if (workspacePath)
                temporaryWorkspacePaths.current.set(
                  submission.temporarySessionId,
                  workspacePath
                )
              setTemporarySessionId(submission.temporarySessionId)
              const previousTemporarySessionId = temporarySessionId
              if (
                previousTemporarySessionId &&
                previousTemporarySessionId !== submission.temporarySessionId
              ) {
                setSessionRuntimeStates((current) => {
                  const next = { ...current }
                  delete next[previousTemporarySessionId]
                  return next
                })
                setRecoveries((current) => {
                  const next = { ...current }
                  delete next[previousTemporarySessionId]
                  return next
                })
              }
              const now = new Date().toISOString()
              if (activeWorkspaceId)
                setSessions((current) => [
                  {
                    id: submission.temporarySessionId,
                    workspaceId: activeWorkspaceId,
                    path: `temporary:${submission.temporarySessionId}`,
                    title,
                    createdAt: now,
                    modifiedAt: now,
                    messageCount: 1,
                    size: 0,
                    pinned: false,
                    archived: false,
                    compatibility: 'v3',
                    status: 'pending'
                  },
                  ...current.filter(
                    (item) =>
                      item.id !== submission.temporarySessionId &&
                      item.id !== previousTemporarySessionId
                  )
                ])
              if (workspacePath)
                projectionCache.current.set(
                  `${workspacePath}:${submission.temporarySessionId}`,
                  projectionRef.current
                )
            }}
            onPromptAccepted={() => {
              const sessionId = runtimeRef.current.sessionId
              if (!sessionId) return
              setSessions((current) => {
                const session = current.find((item) => item.id === sessionId)
                if (!session) return current
                return [
                  { ...session, modifiedAt: new Date().toISOString() },
                  ...current.filter((item) => item.id !== sessionId)
                ]
              })
            }}
            onRecoveryConsumed={(replacement) => {
              const recoverySessionId = temporarySessionId ?? runtime.sessionId
              if (!recoverySessionId) return
              setRecoveries((current) => {
                const next = { ...current }
                if (replacement)
                  next[recoverySessionId] = {
                    input: replacement,
                    reason: 'cancelled'
                  }
                else delete next[recoverySessionId]
                return next
              })
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
            slashCatalog={slashCatalog}
            onRefreshSlashCommands={refreshSlashCommands}
          />
        </Panel>
      </Group>
    </div>
  )
}
