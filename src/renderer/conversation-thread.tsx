import {
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  useThreadViewport,
  type AppendMessage,
  type PartState,
  type ThreadMessageLike
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Copy,
  LoaderCircle,
  Wrench
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
  turnStatusText,
  type ActionItem,
  type AssistantTurn,
  type ArtifactItem,
  type ConversationProjection,
  type InteractionItem
} from './omp-event-reducer'

type ConversationContextValue = {
  projection: ConversationProjection
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
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
  if (action.state === 'running' || action.state === 'pending') {
    return (
      <LoaderCircle
        aria-label="进行中"
        className="animate-spin text-[var(--text-muted)]"
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
    return <CircleStop aria-label={action.state} size={14} />
  }
  return (
    <CircleAlert
      aria-label="未完整结束"
      className="text-[var(--text-muted)]"
      size={14}
    />
  )
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

function ToolRow({
  action,
  compact = false
}: {
  action: ActionItem
  compact?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const summary = actionSummary(action)
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
      className={`tool-row ${compact ? 'tool-row-compact' : ''}`}
      data-tool-call-id={action.toolCallId}
    >
      <span className="tool-state">{statusIcon(action)}</span>
      <span className="tool-name">{action.toolName}</span>
      {summary && <span className="tool-summary">{summary}</span>}
      <span className="tool-status">
        {action.error ?? (action.state === 'incomplete' ? '未完整结束' : '')}
      </span>
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

function contextSummary(
  turn: AssistantTurn,
  indices: readonly number[]
): string {
  const actions = indices.flatMap((index): ActionItem[] => {
    const item = turn.items[index]
    return item?.kind === 'action' ? [item] : []
  })
  const paths = new Set<string>()
  let searches = 0
  for (const action of actions) {
    const path =
      action.args?.['path'] ??
      action.args?.['filePath'] ??
      action.args?.['directory']
    if (typeof path === 'string' && path.trim()) {
      paths.add(path.replaceAll('\\', '/').replace(/\/+$/u, ''))
    }
    if (
      ['grep', 'glob', 'find', 'web_search'].includes(
        action.toolName.toLowerCase()
      )
    ) {
      searches += 1
    }
  }
  const parts = [
    paths.size ? `读取 ${paths.size} 个文件` : undefined,
    searches ? `搜索 ${searches} 次` : undefined
  ].filter(Boolean)
  return parts.length > 0
    ? parts.join(' · ')
    : `执行了 ${actions.length} 次上下文操作`
}

function LiveProcessItems({
  turn
}: {
  turn: AssistantTurn
}): React.JSX.Element {
  const nodes: Array<
    | { kind: 'context'; actions: ActionItem[] }
    | { kind: 'item'; item: AssistantTurn['items'][number] }
  > = []
  for (const item of turn.items) {
    if (item.kind === 'narrative' && item.narrative === 'final') continue
    const groupable =
      item.kind === 'action' &&
      item.category === 'context' &&
      !['error', 'rejected', 'aborted'].includes(item.state)
    const previous = nodes.at(-1)
    if (groupable && previous?.kind === 'context') {
      previous.actions.push(item)
    } else if (groupable) {
      nodes.push({ kind: 'context', actions: [item] })
    } else {
      nodes.push({ kind: 'item', item })
    }
  }
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'context') {
          const indices = node.actions.map((action) =>
            turn.items.findIndex((item) => item.id === action.id)
          )
          return (
            <div
              className="context-group"
              key={`context-${node.actions[0]?.id}`}
            >
              <div className="context-heading">
                <Wrench size={13} />
                {contextSummary(turn, indices)}
              </div>
              {node.actions.map((action) => (
                <ActionWithInteraction
                  action={action}
                  key={action.id}
                  turn={turn}
                />
              ))}
            </div>
          )
        }
        const item = node.item
        if (item.kind === 'narrative') {
          return (
            <div className="process-narrative" key={item.id}>
              {item.text}
            </div>
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
      <div className="process-indicator">
        <LoaderCircle className="animate-spin" size={13} />
        正在处理
      </div>
    </>
  )
}

function Interaction({
  interaction
}: {
  interaction: InteractionItem
}): React.JSX.Element {
  const { setProjection } = useConversationContext()
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
    setSubmitting(true)
    const result = await window.desktop.respondExtensionUi(
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

function ProcessContents({
  turn,
  expanded
}: {
  turn: AssistantTurn
  expanded: boolean
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const running =
    turn.status === 'running' ||
    turn.status === 'retrying' ||
    turn.status === 'waiting'

  useEffect(() => {
    if (!expanded) return
    const element = scrollRef.current
    if (!element) return
    if (running) {
      element.scrollTop = element.scrollHeight
    } else {
      element.scrollTop = 0
    }
    window.requestAnimationFrame(() => setFollowing(running))
  }, [expanded, running])

  useEffect(() => {
    const element = scrollRef.current
    if (expanded && running && following && element) {
      element.scrollTop = element.scrollHeight
    }
  }, [expanded, following, running, turn.items])

  return (
    <div className="process-shell">
      <div
        aria-label="完整执行过程"
        className="process-content"
        id={`process-${turn.id}`}
        onScroll={(event) => {
          const element = event.currentTarget
          setFollowing(
            element.scrollHeight - element.scrollTop - element.clientHeight < 32
          )
        }}
        ref={scrollRef}
      >
        {running ? (
          <LiveProcessItems turn={turn} />
        ) : (
          <MessagePrimitive.GroupedParts
            groupBy={(part: PartState) => {
              if (part.type === 'text') return []
              if (
                part.type === 'tool-call' &&
                [
                  'read',
                  'grep',
                  'glob',
                  'find',
                  'ls',
                  'web_search',
                  'fetch'
                ].includes(part.toolName.toLowerCase()) &&
                !part.isError
              ) {
                return ['group-process', 'group-context'] as const
              }
              return ['group-process'] as const
            }}
            indicator="always"
          >
            {({ part, children }) => {
              if (part.type === 'group-process') return <>{children}</>
              if (part.type === 'group-context') {
                return (
                  <div className="context-group">
                    <div className="context-heading">
                      <Wrench size={13} />
                      {contextSummary(turn, part.indices)}
                    </div>
                    {children}
                  </div>
                )
              }
              if (part.type === 'reasoning') {
                return <div className="process-narrative">{part.text}</div>
              }
              if (part.type === 'tool-call') {
                const action = turn.items.find(
                  (item): item is ActionItem =>
                    item.kind === 'action' &&
                    item.toolCallId === part.toolCallId
                )
                return action ? (
                  <ActionWithInteraction action={action} turn={turn} />
                ) : null
              }
              if (part.type === 'data') {
                if (
                  part.name === 'omp-interaction' &&
                  part.data &&
                  typeof part.data === 'object'
                ) {
                  const interaction = part.data as InteractionItem
                  return interaction.actionId ? null : (
                    <Interaction interaction={interaction} />
                  )
                }
                return null
              }
              if (part.type === 'indicator') {
                return running ? (
                  <div className="process-indicator">
                    <LoaderCircle className="animate-spin" size={13} />
                    正在处理
                  </div>
                ) : null
              }
              return null
            }}
          </MessagePrimitive.GroupedParts>
        )}
      </div>
      {!following && running && (
        <button
          aria-label="回到过程底部"
          className="process-scroll-bottom"
          onClick={() => {
            const element = scrollRef.current
            if (element) element.scrollTop = element.scrollHeight
            setFollowing(true)
          }}
          type="button"
        >
          <ArrowDown size={15} />
        </button>
      )}
    </div>
  )
}

function formatElapsed(turn: AssistantTurn, now: number): string | undefined {
  const elapsed = turnElapsedMs(turn, now)
  if (elapsed === undefined) return undefined
  if (elapsed < 1_000) return '少于 1 秒'
  return `${Math.floor(elapsed / 1_000)} 秒`
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
  const label =
    pendingApprovals.length > 0
      ? `等待操作 · ${Math.max(
          0,
          Math.ceil((approvalDeadline - now) / 1_000)
        )} 秒后自动允许`
      : [
          elapsed
            ? running
              ? `思考中 ${elapsed}`
              : `思考了 ${elapsed}`
            : undefined,
          toolCount ? `${toolCount} 个工具` : undefined,
          turnStatusText(turn.status)
        ]
          .filter(Boolean)
          .join(' · ')
  return (
    <button
      aria-controls={`process-${turn.id}`}
      aria-expanded={expanded}
      className="process-summary"
      onClick={onToggle}
      type="button"
    >
      <span>{label}</span>
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
  const hasProcess = turn.items.some(
    (item) =>
      item.kind !== 'artifact' &&
      (item.kind !== 'narrative' || item.narrative !== 'final')
  )
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
      {hasProcess && expanded && (
        <ProcessContents expanded={expanded} turn={turn} />
      )}
      {commandResults.map((item) => (
        <CommandResultCard item={item} key={item.id} />
      ))}
      <div className="assistant-final">
        <MessagePrimitive.Parts
          components={{
            Text: () => (
              <MarkdownTextPrimitive
                components={markdownComponents}
                defer
                skipHtml
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
  const hasProcess = turn.items.some(
    (item) =>
      item.kind !== 'artifact' &&
      (item.kind !== 'narrative' || item.narrative !== 'final')
  )
  if (!hasProcess && commandResults.length > 0) {
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
      {expanded && (
        <>
          <ProcessContents expanded turn={turn} />
          <ToolApprovalPanel requests={toolApprovals} />
        </>
      )}
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
    window.desktop.respondExtensionUi(request.id, { value })
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
  onSend,
  onCancel,
  children
}: {
  projection: ConversationProjection
  setProjection: React.Dispatch<React.SetStateAction<ConversationProjection>>
  isRunning: boolean
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
    <ConversationContext.Provider value={{ projection, setProjection }}>
      <SettledTurnsContext.Provider value={settledContext}>
        <AssistantRuntimeProvider key={messageKey} runtime={runtime}>
          {children}
        </AssistantRuntimeProvider>
      </SettledTurnsContext.Provider>
    </ConversationContext.Provider>
  )
}

export { ThreadMessages }
