import {
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  TextMessagePartProvider,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  useThreadViewport,
  type AppendMessage,
  type ThreadMessageLike
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import {
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleEllipsis,
  CircleHelp,
  CircleStop,
  Clock3,
  Copy,
  FileDiff,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileText,
  Folder,
  Globe,
  LoaderCircle,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import type {
  ExtensionUiResponse,
  ToolApprovalRequest
} from '../shared/desktop-api'
import {
  actionSummary,
  reduceOmpEvent,
  setTurnCollapsed,
  shouldCollapseTurn,
  turnElapsedMs,
  type ActionItem,
  type AssistantTurn,
  type ArtifactItem,
  type ConversationProjection,
  type InteractionItem,
  type NarrativeItem
} from './omp-event-reducer'

type ConversationContextValue = {
  projection: ConversationProjection
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
  sessionId?: string
  workspacePath?: string
}

const ConversationContext = createContext<ConversationContextValue | null>(null)
const SettledTurnsContext = createContext<{
  turns: ReadonlyMap<string, AssistantTurn>
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
} | null>(null)

function useConversationContext(): ConversationContextValue {
  const value = useContext(ConversationContext)
  if (!value) throw new Error('ConversationContext 不可用')
  return value
}

function messageStatus(turn: AssistantTurn): ThreadMessageLike['status'] {
  if (
    turn.status === 'running' ||
    turn.status === 'retrying' ||
    turn.status === 'waiting'
  ) {
    return undefined
  }
  if (turn.status === 'completed' || turn.status === 'completed-incomplete') {
    return { type: 'complete', reason: 'stop' }
  }
  return {
    type: 'incomplete',
    reason:
      turn.status === 'length'
        ? 'length'
        : turn.status === 'aborted'
          ? 'cancelled'
          : 'error'
  }
}

function toThreadMessages(
  projection: ConversationProjection
): ThreadMessageLike[] {
  return projection.turns.flatMap((turn): ThreadMessageLike[] => {
    if (turn.role === 'user') {
      return [
        {
          id: turn.id,
          role: 'user',
          content: [{ type: 'text', text: turn.text }],
          createdAt: turn.createdAt ? new Date(turn.createdAt) : undefined
        }
      ]
    }
    if (turn.id === projection.activeTurnId) return []
    return [
      {
        id: turn.id,
        role: 'assistant',
        status: messageStatus(turn),
        metadata: { custom: { ompTurnId: turn.id } },
        content: turn.items.flatMap(
          (item): Exclude<ThreadMessageLike['content'], string> => {
            if (item.kind === 'narrative') {
              return [
                item.narrative === 'final'
                  ? { type: 'text', text: item.text }
                  : {
                      type: 'reasoning',
                      text: item.text
                    }
              ]
            }
            if (item.kind === 'action') {
              return [
                {
                  type: 'tool-call',
                  toolCallId: item.toolCallId,
                  toolName: item.toolName,
                  args: item.args as never,
                  argsText: item.argsText,
                  result:
                    item.state === 'running' || item.state === 'pending'
                      ? undefined
                      : (item.resultSummary ?? item.error ?? item.state),
                  isError: item.state === 'error'
                }
              ]
            }
            if (item.kind === 'interaction') {
              return [
                {
                  type: 'data-omp-interaction',
                  data: item
                }
              ]
            }
            return [{ type: 'data-omp-artifact', data: item }]
          }
        )
      }
    ]
  })
}

function findText(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

const convertThreadMessage = (message: ThreadMessageLike): ThreadMessageLike =>
  message

function CopyActionButton({
  label,
  value,
  className,
  compact = false
}: {
  label: string
  value: string
  className?: string
  compact?: boolean
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle')

  const copy = async (): Promise<void> => {
    try {
      const copied = await window.desktop.copyText(value)
      setState(copied ? 'success' : 'error')
    } catch {
      setState('error')
    }
    window.setTimeout(() => setState('idle'), 1_500)
  }

  return (
    <button
      aria-label={label}
      className={className ?? 'message-copy'}
      onClick={() => void copy()}
      title={label}
      type="button"
    >
      {state === 'success' ? (
        <Check size={13} />
      ) : state === 'error' ? (
        compact ? (
          <CircleAlert size={13} />
        ) : (
          <>
            <CircleAlert size={13} />
            <span>复制失败</span>
          </>
        )
      ) : (
        <Copy size={13} />
      )}
    </button>
  )
}

function statusIcon(action: ActionItem): ReactNode {
  if (action.state === 'pending') {
    return (
      <Clock3
        aria-label="等待执行"
        className="text-[var(--text-muted)]"
        size={14}
      />
    )
  }
  if (action.state === 'running') {
    return (
      <LoaderCircle
        aria-label="运行中"
        className="tool-spinner animate-spin text-[var(--text-muted)]"
        size={14}
      />
    )
  }
  if (action.state === 'success') {
    return <Check aria-label="成功" className="text-emerald-600" size={14} />
  }
  if (action.state === 'error') {
    return <CircleAlert aria-label="失败" className="text-red-600" size={14} />
  }
  if (action.state === 'aborted' || action.state === 'rejected') {
    return (
      <CircleStop
        aria-label={action.state === 'aborted' ? '已中止' : '已拒绝'}
        className="text-[var(--text-muted)]"
        size={14}
      />
    )
  }
  return (
    <CircleEllipsis
      aria-label="状态未知"
      className="text-[var(--text-muted)]"
      size={14}
    />
  )
}

function argumentText(
  action: ActionItem,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = action.args?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function shortenPath(value: string, workspacePath?: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '')
  const workspace = workspacePath?.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (workspace && normalized.startsWith(`${workspace}/`)) {
    return normalized.slice(workspace.length + 1)
  }
  if (!/^(?:[a-z]:\/|\/)/iu.test(normalized)) return normalized
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : normalized
}

function cleanInlineSummary(value: string | undefined): string | undefined {
  if (!value) return undefined
  const paragraph = value
    .split(/\n\s*\n/u)
    .find((part) => part.trim().length > 0)
  if (!paragraph) return undefined
  const cleaned = paragraph
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gmu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~`>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.length > 160 ? `${cleaned.slice(0, 159)}…` : cleaned
}

type ToolPresentation = {
  Icon: LucideIcon
  label: string
  detail?: string
  detailTitle?: string
}

function actionPresentation(
  action: ActionItem,
  workspacePath?: string
): ToolPresentation {
  const name = action.toolName.toLowerCase()
  const path = argumentText(action, ['path', 'filePath', 'directory'])
  const pathDetail = path ? shortenPath(path, workspacePath) : undefined
  if (name === 'read')
    return {
      Icon: FileText,
      label: '读取',
      detail: pathDetail,
      detailTitle: path
    }
  if (name === 'grep')
    return {
      Icon: Search,
      label: '搜索',
      detail: argumentText(action, ['pattern', 'query'])
    }
  if (name === 'glob')
    return {
      Icon: FileSearch,
      label: '匹配文件',
      detail: argumentText(action, ['pattern', 'query'])
    }
  if (name === 'find')
    return {
      Icon: Search,
      label: '查找',
      detail: argumentText(action, ['query', 'pattern']) ?? pathDetail,
      detailTitle: path
    }
  if (name === 'ls')
    return {
      Icon: Folder,
      label: '浏览目录',
      detail: pathDetail,
      detailTitle: path
    }
  if (name === 'web_search')
    return {
      Icon: Globe,
      label: '搜索网页',
      detail: argumentText(action, ['query'])
    }
  if (name === 'fetch')
    return {
      Icon: Globe,
      label: '获取网页',
      detail: argumentText(action, ['url', 'target']) ?? pathDetail,
      detailTitle: path
    }
  if (['bash', 'shell', 'exec', 'command'].includes(name)) {
    const command = argumentText(action, ['command', 'cmd'])
    return {
      Icon: SquareTerminal,
      label: '运行',
      detail: command?.split(/\r?\n/u)[0],
      detailTitle: command
    }
  }
  const editTools: Record<string, { Icon: LucideIcon; label: string }> = {
    edit: { Icon: FilePenLine, label: '修改' },
    write: { Icon: FilePenLine, label: '写入' },
    apply_patch: { Icon: FileDiff, label: '应用修改' },
    create_file: { Icon: FilePlus2, label: '创建' },
    delete_file: { Icon: Trash2, label: '删除' }
  }
  const edit = editTools[name]
  if (edit) return { ...edit, detail: pathDetail, detailTitle: path }
  if (action.category === 'subagent') {
    const tasks = action.args?.['tasks']
    const detail = Array.isArray(tasks)
      ? `${tasks.length} 个任务`
      : argumentText(action, ['name', 'task'])
    return { Icon: Bot, label: '子任务', detail }
  }
  return {
    Icon: Wrench,
    label: action.toolName,
    detail: actionSummary(action)
  }
}

function findToolResult(messages: unknown, toolCallId: string): unknown {
  const list: unknown[] = Array.isArray(messages)
    ? messages
    : messages &&
        typeof messages === 'object' &&
        Array.isArray((messages as Record<string, unknown>)['messages'])
      ? ((messages as Record<string, unknown>)['messages'] as unknown[])
      : []
  for (const message of list) {
    if (!message || typeof message !== 'object' || Array.isArray(message))
      continue
    const record = message as Record<string, unknown>
    if (record['toolCallId'] === toolCallId) return record['content']
  }
  return undefined
}

function ToolRow({ action }: { action: ActionItem }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const { workspacePath } = useConversationContext()
  const presentation = actionPresentation(action, workspacePath)
  const resultSummary =
    action.category === 'subagent' && action.state === 'success'
      ? cleanInlineSummary(action.resultSummary)
      : undefined
  const copyResult = async (): Promise<void> => {
    const result = await window.desktop.getMessages()
    if (!result.ok) return
    const value = findToolResult(result.data, action.toolCallId)
    if (value === undefined) return
    const copied = await window.desktop.copyText(
      typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    )
    setCopied(copied)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <div
      className={`tool-row ${action.state === 'error' ? 'tool-row-error' : ''} ${
        action.category === 'subagent' ? 'tool-row-subagent' : ''
      }`}
      data-tool-call-id={action.toolCallId}
      title={`原始工具：${action.toolName}`}
    >
      <span className="tool-kind" title={action.toolName}>
        <presentation.Icon aria-hidden size={14} strokeWidth={1.75} />
      </span>
      <span className="tool-name">{presentation.label}</span>
      <span
        aria-label={presentation.detailTitle}
        className="tool-summary"
        title={presentation.detailTitle}
      >
        {presentation.detail}
      </span>
      <span className="tool-state">{statusIcon(action)}</span>
      {action.ended && (
        <button
          aria-label={`复制 ${action.toolName} 完整结果`}
          className="tool-copy"
          onClick={() => void copyResult()}
          title="从 Session 复制完整结果"
          type="button"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
      {resultSummary && (
        <span className="tool-result-summary" title={action.resultSummary}>
          {resultSummary}
        </span>
      )}
      {action.error && (
        <span className="tool-error-summary" title={action.error}>
          {action.error}
        </span>
      )}
    </div>
  )
}

function CommandResultCard({
  item
}: {
  item: ArtifactItem
}): React.JSX.Element {
  const lines = item.value.split(/\r?\n/u)
  const truncated = lines.length > 8
  const [expanded, setExpanded] = useState(false)
  const visible = expanded || !truncated ? lines : lines.slice(0, 8)
  return (
    <section className="command-result-card">
      <div className="command-result-body">
        <pre>{visible.join('\n')}</pre>
      </div>
      <div className="command-result-footer">
        <div className="command-result-actions">
          <CopyActionButton label="复制命令结果" value={item.copyText} />
          {truncated && (
            <button
              className="message-copy"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {expanded ? '收起' : `展开 · 共 ${lines.length} 行`}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function ActionWithInteraction({
  action,
  turn
}: {
  action: ActionItem
  turn: AssistantTurn
}): React.JSX.Element {
  const interactions = turn.items.filter(
    (item): item is InteractionItem =>
      item.kind === 'interaction' && item.actionId === action.id
  )
  return (
    <div className="action-with-interaction">
      <ToolRow action={action} />
      {interactions.map((interaction) => (
        <Interaction interaction={interaction} key={interaction.id} />
      ))}
    </div>
  )
}

function Interaction({
  interaction
}: {
  interaction: InteractionItem
}): React.JSX.Element {
  const { sessionId, setProjection } = useConversationContext()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!interaction.deadline || interaction.timedOut) return
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [interaction.deadline, interaction.timedOut])
  const respond = async (response: ExtensionUiResponse): Promise<void> => {
    if (submitting) return
    if (!sessionId) return
    setSubmitting(true)
    const result = await window.desktop.respondExtensionUi(
      sessionId,
      interaction.requestId,
      response
    )
    if (result.ok) {
      setProjection((current) =>
        reduceOmpEvent(current, {
          type: 'extension_ui_resolved',
          id: interaction.requestId
        })
      )
    } else {
      setSubmitting(false)
    }
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (interaction.method === 'confirm') {
      void respond({ confirmed: true })
    } else if (value.trim()) {
      void respond({ value })
    }
  }
  return (
    <form
      className="interaction"
      data-interaction-id={interaction.requestId}
      onSubmit={submit}
    >
      <p className="interaction-title">{interaction.title}</p>
      {interaction.message && (
        <p className="interaction-message">{interaction.message}</p>
      )}
      {interaction.timedOut ? (
        <p className="interaction-message">已超时</p>
      ) : (
        interaction.deadline && (
          <p className="interaction-message">
            剩余 {Math.max(0, Math.ceil((interaction.deadline - now) / 1_000))}{' '}
            秒
          </p>
        )
      )}
      {!interaction.timedOut && interaction.method === 'select' ? (
        <div className="interaction-options">
          {interaction.options.map((option) => (
            <button
              className="secondary-button"
              disabled={submitting}
              key={option.value}
              onClick={() => void respond({ value: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : !interaction.timedOut && interaction.method === 'confirm' ? (
        <div className="interaction-options">
          <button
            className="primary-button"
            disabled={submitting}
            type="submit"
          >
            确认
          </button>
          <button
            className="secondary-button"
            disabled={submitting}
            onClick={() => void respond({ confirmed: false })}
            type="button"
          >
            取消
          </button>
        </div>
      ) : !interaction.timedOut ? (
        <>
          {interaction.method === 'editor' ? (
            <textarea
              aria-label={interaction.title}
              className="interaction-editor"
              onChange={(event) => setValue(event.target.value)}
              placeholder={interaction.placeholder}
              value={value}
            />
          ) : (
            <input
              aria-label={interaction.title}
              className="interaction-input"
              onChange={(event) => setValue(event.target.value)}
              placeholder={interaction.placeholder}
              value={value}
            />
          )}
          <div className="interaction-options">
            <button
              className="primary-button"
              disabled={submitting || !value.trim()}
              type="submit"
            >
              提交
            </button>
            <button
              className="secondary-button"
              disabled={submitting}
              onClick={() => void respond({ cancelled: true })}
              type="button"
            >
              取消
            </button>
          </div>
        </>
      ) : null}
    </form>
  )
}

function ControlledMarkdownLink({
  href,
  children
}: {
  href?: string
  children?: ReactNode
}): React.JSX.Element {
  const external = href ? /^https?:\/\//iu.test(href) : false
  const [validLocal, setValidLocal] = useState(false)
  useEffect(() => {
    if (!href || external) {
      queueMicrotask(() => setValidLocal(false))
      return
    }
    let cancelled = false
    void window.desktop.validateLocalPath(href).then((valid) => {
      if (!cancelled) setValidLocal(valid)
    })
    return () => {
      cancelled = true
    }
  }, [external, href])

  const open = (): void => {
    if (!href) return
    if (external) void window.desktop.openExternal(href)
    else if (validLocal) void window.desktop.revealPath(href)
  }
  const interactive = external || validLocal
  return (
    <a
      aria-label={interactive && href ? `Ctrl+Enter 打开 ${href}` : undefined}
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (interactive && (event.ctrlKey || event.metaKey)) open()
      }}
      onKeyDown={(event) => {
        if (
          interactive &&
          event.key === 'Enter' &&
          (event.ctrlKey || event.metaKey)
        ) {
          event.preventDefault()
          open()
        }
      }}
      rel="noreferrer"
      tabIndex={interactive ? 0 : -1}
      title={interactive ? 'Ctrl+点击打开' : undefined}
    >
      {children}
    </a>
  )
}

const CodeBlockContext = createContext(false)

function InlinePathCode({
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  const block = useContext(CodeBlockContext)
  const value =
    typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.join('')
        : ''
  const [valid, setValid] = useState(false)
  useEffect(() => {
    if (block || !value || value.includes('\n')) {
      queueMicrotask(() => setValid(false))
      return
    }
    let cancelled = false
    void window.desktop.validateLocalPath(value).then((result) => {
      if (!cancelled) setValid(result)
    })
    return () => {
      cancelled = true
    }
  }, [block, value])
  if (!valid || block) return <code {...props}>{children}</code>
  return (
    <a
      aria-label={`Ctrl+Enter 打开 ${value}`}
      href={value}
      onClick={(event) => {
        event.preventDefault()
        if (event.ctrlKey || event.metaKey)
          void window.desktop.revealPath(value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          void window.desktop.revealPath(value)
        }
      }}
      title="Ctrl+点击打开"
    >
      <code {...props}>{children}</code>
    </a>
  )
}

const markdownComponents = {
  a: ({
    href,
    children
  }: {
    href?: string
    children?: ReactNode
  }): React.JSX.Element => (
    <ControlledMarkdownLink href={href}>{children}</ControlledMarkdownLink>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }): React.JSX.Element => (
    <ControlledMarkdownLink href={src}>
      {alt || '远程图片'}
    </ControlledMarkdownLink>
  ),
  pre: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element => (
    <CodeBlockContext.Provider value>
      <pre {...props}>{children}</pre>
    </CodeBlockContext.Provider>
  ),
  code: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement>): React.JSX.Element => (
    <InlinePathCode {...props}>{children}</InlinePathCode>
  )
}

function answerCandidateItems(turn: AssistantTurn): NarrativeItem[] {
  const items: NarrativeItem[] = []
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index]
    if (!item) continue
    if (item.kind === 'narrative' && item.redacted) continue
    if (
      item.kind === 'narrative' &&
      item.narrative === 'intermediate' &&
      !item.text.trim()
    ) {
      continue
    }
    if (item.kind === 'narrative' && item.narrative === 'intermediate') {
      items.unshift(item)
      continue
    }
    break
  }
  return items
}

function processItems(
  turn: AssistantTurn,
  candidateIds: ReadonlySet<string> = new Set()
): AssistantTurn['items'] {
  return turn.items.filter((item) => {
    if (item.kind === 'artifact') return false
    if (item.kind !== 'narrative') return true
    return (
      item.narrative !== 'final' &&
      !item.redacted &&
      (item.narrative === 'reasoning' || item.text.trim().length > 0) &&
      !candidateIds.has(item.id)
    )
  })
}

function NarrativeMarkdown({
  item,
  candidate = false
}: {
  item: NarrativeItem
  candidate?: boolean
}): React.JSX.Element {
  return (
    <TextMessagePartProvider text={item.text} isRunning={candidate}>
      <div
        data-slot={candidate ? 'assistant-visible-text' : undefined}
        className={
          candidate
            ? 'assistant-answer-candidate prose max-w-none'
            : 'process-narrative-markdown'
        }
      >
        <MarkdownTextPrimitive
          components={markdownComponents}
          defer={candidate}
          skipHtml
          smooth={false}
        />
      </div>
    </TextMessagePartProvider>
  )
}

function ProcessItems({
  turn,
  candidateIds
}: {
  turn: AssistantTurn
  candidateIds?: ReadonlySet<string>
}): React.JSX.Element {
  return (
    <>
      {processItems(turn, candidateIds).map((item) => {
        if (item.kind === 'narrative') {
          return item.narrative === 'reasoning' ? (
            <div className="thinking-narrative" key={item.id}>
              {item.text}
            </div>
          ) : (
            <NarrativeMarkdown item={item} key={item.id} />
          )
        }
        if (item.kind === 'action') {
          return (
            <ActionWithInteraction action={item} key={item.id} turn={turn} />
          )
        }
        if (item.kind === 'interaction' && !item.actionId) {
          return <Interaction interaction={item} key={item.id} />
        }
        return null
      })}
    </>
  )
}

function ProcessContents({
  turn,
  candidateIds
}: {
  turn: AssistantTurn
  candidateIds?: ReadonlySet<string>
}): React.JSX.Element {
  return (
    <div className="process-shell">
      <div
        aria-label="完整执行过程"
        className="process-content"
        id={`process-${turn.id}`}
      >
        <ProcessItems candidateIds={candidateIds} turn={turn} />
      </div>
    </div>
  )
}

function formatElapsed(turn: AssistantTurn, now: number): string | undefined {
  const elapsed = turnElapsedMs(turn, now)
  if (elapsed === undefined) return undefined
  if (elapsed < 1_000) return '少于 1 秒'
  const seconds = Math.floor(elapsed / 1_000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
}

function processStatusIcon(turn: AssistantTurn): React.JSX.Element {
  if (turn.status === 'running' || turn.status === 'retrying') {
    return (
      <LoaderCircle
        aria-label="运行中"
        className="process-spinner animate-spin"
        size={14}
      />
    )
  }
  if (turn.status === 'waiting') {
    return <CircleHelp aria-label="等待操作" size={14} />
  }
  if (turn.status === 'completed' || turn.status === 'completed-incomplete') {
    return <Check aria-label="已完成" className="text-emerald-600" size={14} />
  }
  if (turn.status === 'error' || turn.status === 'length') {
    return <CircleAlert aria-label="失败" className="text-red-600" size={14} />
  }
  return <CircleStop aria-label="已中止" size={14} />
}

function processStatusLabel(turn: AssistantTurn): string {
  if (turn.status === 'running' || turn.status === 'retrying') return '运行中'
  if (turn.status === 'waiting') return '等待操作'
  if (turn.status === 'completed' || turn.status === 'completed-incomplete') {
    return '已完成'
  }
  if (turn.status === 'error' || turn.status === 'length') return '失败'
  return '已中止'
}

function ProcessSummary({
  turn,
  expanded,
  onToggle,
  toolApprovals = []
}: {
  turn: AssistantTurn
  expanded: boolean
  onToggle: () => void
  toolApprovals?: ToolApprovalRequest[]
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const running =
    turn.status === 'running' ||
    turn.status === 'retrying' ||
    turn.status === 'waiting'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running])
  const elapsed = formatElapsed(turn, now)
  const toolCount = new Set(
    turn.items.flatMap((item) =>
      item.kind === 'action' ? [item.toolCallId] : []
    )
  ).size
  const pendingApprovals = toolApprovals.filter(
    (request) => request.status === 'pending'
  )
  const approvalDeadline = Math.min(
    ...pendingApprovals.map((request) => request.deadline)
  )
  const unresolvedInteraction = turn.items.find(
    (item): item is InteractionItem =>
      item.kind === 'interaction' && !item.resolved && !item.timedOut
  )
  const waitingLabel =
    pendingApprovals.length > 0
      ? `等待确认 · ${Math.max(
          0,
          Math.ceil((approvalDeadline - now) / 1_000)
        )}秒`
      : unresolvedInteraction
        ? unresolvedInteraction.deadline
          ? `等待操作 · ${Math.max(
              0,
              Math.ceil((unresolvedInteraction.deadline - now) / 1_000)
            )}秒`
          : '等待操作'
        : turn.status === 'waiting'
          ? '等待操作'
          : undefined
  const label =
    waitingLabel ??
    [toolCount ? `${toolCount} 次工具调用` : undefined, elapsed]
      .filter(Boolean)
      .join(' · ')
  return (
    <button
      aria-controls={`process-${turn.id}`}
      aria-expanded={expanded}
      aria-label={`${processStatusLabel(turn)}${label ? ` · ${label}` : ''}`}
      className="process-summary"
      onClick={onToggle}
      type="button"
    >
      <span className="process-summary-main">
        {processStatusIcon(turn)}
        <span className="process-summary-label">{label}</span>
      </span>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  )
}

function AssistantMessage(): React.JSX.Element | null {
  const id = useAuiState((state) => state.message.id)
  const settled = useContext(SettledTurnsContext)
  const turn = settled?.turns.get(id)
  const setProjection = settled?.setProjection
  const isAtBottom = useThreadViewport((state) => state.isAtBottom)
  const previousStatus = useRef(turn?.status)
  const summaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!turn || !setProjection) return
    const previous = previousStatus.current
    previousStatus.current = turn.status
    if (
      (turn.status === 'completed' || turn.status === 'completed-incomplete') &&
      previous !== turn.status &&
      !isAtBottom
    ) {
      setProjection((current) => setTurnCollapsed(current, turn.id, false))
    }
  }, [isAtBottom, setProjection, turn])

  if (!turn || !setProjection) return null
  const commandResults = turn.items.filter(
    (item): item is ArtifactItem =>
      item.kind === 'artifact' && item.artifact === 'command-result'
  )
  const hasProcess = processItems(turn).length > 0
  const finalText = turn.finalItemIds
    .map((id) => turn.items.find((item) => item.id === id))
    .flatMap((item) =>
      item?.kind === 'narrative' && item.narrative === 'final'
        ? [item.text]
        : []
    )
    .join('')
  const collapsed = shouldCollapseTurn(turn)
  const expanded = !collapsed

  const toggle = (): void => {
    if (expanded) {
      const process = document.getElementById(`process-${turn.id}`)
      if (process?.contains(document.activeElement)) {
        summaryRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    setProjection((current) => setTurnCollapsed(current, turn.id, expanded))
  }

  return (
    <MessagePrimitive.Root className="assistant-message" data-role="assistant">
      {hasProcess && (
        <div ref={summaryRef}>
          <ProcessSummary expanded={expanded} onToggle={toggle} turn={turn} />
        </div>
      )}
      {hasProcess && expanded && <ProcessContents turn={turn} />}
      {commandResults.map((item) => (
        <CommandResultCard item={item} key={item.id} />
      ))}
      <div
        className="assistant-final prose max-w-none"
        data-slot="assistant-visible-text"
      >
        <MessagePrimitive.Parts
          components={{
            Text: () => (
              <MarkdownTextPrimitive
                components={markdownComponents}
                defer
                skipHtml
                smooth={false}
              />
            ),
            Reasoning: () => null,
            tools: { Fallback: () => null }
          }}
        />
      </div>
      {finalText ? (
        <div className="assistant-copy-row">
          <CopyActionButton label="复制回答" value={finalText} />
        </div>
      ) : null}
    </MessagePrimitive.Root>
  )
}

function UserMessage(): React.JSX.Element {
  const text = useAuiState((state) =>
    state.message.content
      .filter(
        (part): part is { type: 'text'; text: string } => part.type === 'text'
      )
      .map((part) => part.text)
      .join('')
  )
  return (
    <MessagePrimitive.Root className="user-message" data-role="user">
      <MessagePrimitive.Parts
        components={{
          Text: () => <MessagePartPrimitive.Text />
        }}
      />
      {text ? (
        <div className="user-copy-inline">
          <CopyActionButton
            className="message-copy message-copy-compact"
            compact
            label="复制用户输入"
            value={text}
          />
        </div>
      ) : null}
    </MessagePrimitive.Root>
  )
}

function ThreadMessage(): React.JSX.Element {
  const role = useAuiState((state) => state.message.role)
  return role === 'user' ? <UserMessage /> : <AssistantMessage />
}

function LiveAssistantTurn({
  toolApprovals = []
}: {
  toolApprovals?: ToolApprovalRequest[]
}): React.JSX.Element | null {
  const { projection, setProjection } = useConversationContext()
  const previousApprovalIds = useRef(new Set<string>())
  const turn = projection.turns.find(
    (item): item is AssistantTurn =>
      item.role === 'assistant' && item.id === projection.activeTurnId
  )
  useEffect(() => {
    if (!turn) return undefined
    const next = new Set(toolApprovals.map((request) => request.id))
    const hasNew = [...next].some(
      (requestId) => !previousApprovalIds.current.has(requestId)
    )
    previousApprovalIds.current = next
    if (hasNew) {
      const timer = window.setTimeout(
        () =>
          setProjection((current) => setTurnCollapsed(current, turn.id, false)),
        0
      )
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [setProjection, toolApprovals, turn])
  if (!turn) return null
  const expanded = !shouldCollapseTurn(turn)
  const commandResults = turn.items.filter(
    (item): item is ArtifactItem =>
      item.kind === 'artifact' && item.artifact === 'command-result'
  )
  const candidates = answerCandidateItems(turn)
  const candidateIds = new Set(candidates.map((item) => item.id))
  const hasProcess = processItems(turn, candidateIds).length > 0
  const hasSummary = hasProcess || toolApprovals.length > 0
  if (!hasSummary && candidates.length === 0 && commandResults.length > 0) {
    return (
      <div
        className="assistant-message"
        data-message-id={turn.id}
        data-role="assistant"
      >
        {commandResults.map((item) => (
          <CommandResultCard item={item} key={item.id} />
        ))}
      </div>
    )
  }
  return (
    <div
      className="assistant-message"
      data-message-id={turn.id}
      data-role="assistant"
    >
      {hasSummary && (
        <ProcessSummary
          expanded={expanded}
          onToggle={() =>
            setProjection((current) =>
              setTurnCollapsed(current, turn.id, expanded)
            )
          }
          turn={turn}
          toolApprovals={toolApprovals}
        />
      )}
      {hasSummary && expanded && (
        <>
          {hasProcess && (
            <ProcessContents candidateIds={candidateIds} turn={turn} />
          )}
          <ToolApprovalPanel requests={toolApprovals} />
        </>
      )}
      {commandResults.map((item) => (
        <CommandResultCard item={item} key={item.id} />
      ))}
      {candidates.map((item) => (
        <NarrativeMarkdown candidate item={item} key={item.id} />
      ))}
    </div>
  )
}

const approvalStatusLabel: Record<ToolApprovalRequest['status'], string> = {
  pending: '待确认',
  approved: '已允许',
  'auto-approved': '已自动允许',
  denied: '已拒绝',
  cancelled: '已取消',
  invalid: '请求已失效'
}

function ToolApprovalPanel({
  requests
}: {
  requests: ToolApprovalRequest[]
}): React.JSX.Element | null {
  const { sessionId } = useConversationContext()
  const [now, setNow] = useState(0)
  const primaryButton = useRef<HTMLButtonElement | null>(null)
  const previousCount = useRef(0)
  const pending = requests.filter((request) => request.status === 'pending')
  const grouped = requests.length > 1
  const deadline = Math.min(
    ...pending.map((request) => request.deadline),
    Number.POSITIVE_INFINITY
  )
  const remaining =
    now === 0 ? 30 : Math.max(0, Math.ceil((deadline - now) / 1_000))

  useEffect(() => {
    if (requests.length === 0) return
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [requests.length])

  useEffect(() => {
    if (previousCount.current === 0 && requests.length > 0)
      primaryButton.current?.focus()
    previousCount.current = requests.length
  }, [requests.length])

  if (requests.length === 0) return null

  const respond = (request: ToolApprovalRequest, value: 'Approve' | 'Deny') =>
    sessionId
      ? window.desktop.respondExtensionUi(sessionId, request.id, { value })
      : Promise.resolve({
          ok: false as const,
          error: {
            code: 'SESSION_NOT_FOUND' as const,
            message: 'Session ID 不可用',
            retryable: false
          }
        })
  const respondAll = (value: 'Approve' | 'Deny'): void => {
    for (const request of pending) void respond(request, value)
  }

  return (
    <section
      aria-label="工具审批"
      className="tool-approval-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (grouped) respondAll('Deny')
        else if (pending[0]) void respond(pending[0], 'Deny')
      }}
    >
      <div className="tool-approval-heading">
        <span>
          {grouped
            ? `待确认 ${pending.length} / ${requests.length}`
            : '工具权限确认'}
        </span>
        {pending.length > 0 && <span>{remaining} 秒后自动允许</span>}
      </div>
      <div className="tool-approval-list">
        {requests.map((request) => (
          <div className="tool-approval-row" key={request.id}>
            <span className="tool-approval-summary" title={request.summary}>
              {request.summary}
            </span>
            {request.status === 'pending' ? (
              <span className="tool-approval-actions">
                <button
                  onClick={() => void respond(request, 'Deny')}
                  type="button"
                >
                  拒绝
                </button>
                <button
                  onClick={() => void respond(request, 'Approve')}
                  ref={!grouped ? primaryButton : undefined}
                  type="button"
                >
                  允许
                </button>
              </span>
            ) : (
              <span className="tool-approval-status">
                {approvalStatusLabel[request.status]}
              </span>
            )}
          </div>
        ))}
      </div>
      {grouped && pending.length > 0 && (
        <div className="tool-approval-batch">
          <button onClick={() => respondAll('Deny')} type="button">
            全部拒绝
          </button>
          <button
            onClick={() => respondAll('Approve')}
            ref={primaryButton}
            type="button"
          >
            全部允许
          </button>
        </div>
      )}
    </section>
  )
}

const ThreadMessages = memo(function ThreadMessages({
  toolApprovals = []
}: {
  toolApprovals?: ToolApprovalRequest[]
}): React.JSX.Element {
  return (
    <ThreadPrimitive.Root className="conversation-thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <div className="thread-content">
          <ThreadPrimitive.Messages components={{ Message: ThreadMessage }} />
          <LiveAssistantTurn toolApprovals={toolApprovals} />
        </div>
        <ThreadPrimitive.ScrollToBottom
          aria-label="回到对话底部"
          className="thread-scroll-bottom"
        >
          <ArrowDown size={16} />
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
})

export function ConversationRuntime({
  projection,
  setProjection,
  isRunning,
  sessionId,
  workspacePath,
  onSend,
  onCancel,
  children
}: {
  projection: ConversationProjection
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
  isRunning: boolean
  sessionId?: string
  workspacePath?: string
  onSend: (message: string) => Promise<void>
  onCancel: () => Promise<void>
  children: ReactNode
}): React.JSX.Element {
  const messages = useMemo(
    () => toThreadMessages(projection),
    // Active Turn is rendered directly from the projection. Its token updates
    // must not reconvert and reconcile the full settled history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projection.activeTurnId, projection.sequence, projection.turns.length]
  )
  const settledTurns = useMemo(
    () =>
      new Map(
        projection.turns.flatMap((turn): Array<[string, AssistantTurn]> =>
          turn.role === 'assistant' && turn.id !== projection.activeTurnId
            ? [[turn.id, turn]]
            : []
        )
      ),
    // Active token updates do not change settled turns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projection.activeTurnId, projection.sequence, projection.turns.length]
  )
  const settledContext = useMemo(
    () => ({ turns: settledTurns, setProjection }),
    [setProjection, settledTurns]
  )
  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage: convertThreadMessage,
    onNew: async (message) => onSend(findText(message)),
    onCancel
  })
  const messageKey = messages.map((message) => message.id).join('\n')
  return (
    <ConversationContext.Provider
      value={{ projection, setProjection, sessionId, workspacePath }}
    >
      <SettledTurnsContext.Provider value={settledContext}>
        <AssistantRuntimeProvider key={messageKey} runtime={runtime}>
          {children}
        </AssistantRuntimeProvider>
      </SettledTurnsContext.Provider>
    </ConversationContext.Provider>
  )
}

export { ThreadMessages }
