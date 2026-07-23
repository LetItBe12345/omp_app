import type { OmpEvent } from '../shared/desktop-api'

export type RunStatus =
  | 'running'
  | 'retrying'
  | 'waiting'
  | 'completed'
  | 'completed-incomplete'
  | 'length'
  | 'error'
  | 'aborted'

export type NarrativeItem = {
  id: string
  kind: 'narrative'
  narrative: 'reasoning' | 'intermediate' | 'final'
  text: string
  messageId: string
  blockIndex: number
}

export type ActionCategory =
  'context' | 'command' | 'edit' | 'subagent' | 'external'

export type ActionState =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'rejected'
  | 'aborted'
  | 'incomplete'

export type ActionItem = {
  id: string
  kind: 'action'
  toolCallId: string
  toolName: string
  category: ActionCategory
  args?: Record<string, unknown>
  argsText?: string
  intent?: string
  state: ActionState
  progress?: string
  resultSummary?: string
  error?: string
  messageId?: string
  blockIndex?: number
  ended: boolean
}

export type InteractionOption = {
  label: string
  value: string
}

export type InteractionItem = {
  id: string
  kind: 'interaction'
  requestId: string
  method: 'select' | 'confirm' | 'input' | 'editor'
  title: string
  message?: string
  placeholder?: string
  options: InteractionOption[]
  actionId?: string
  resolved: boolean
}

export type ArtifactItem = {
  id: string
  kind: 'artifact'
  label: string
  value: string
}

export type TurnItem =
  NarrativeItem | ActionItem | InteractionItem | ArtifactItem

type MessageProjection = {
  id: string
  itemIds: string[]
  stopReason?: string
}

export type AssistantTurn = {
  id: string
  role: 'assistant'
  items: TurnItem[]
  finalItemIds: string[]
  messages: MessageProjection[]
  status: RunStatus
  startedAt?: number
  endedAt?: number
  waitingStartedAt?: number
  waitingDurationMs: number
  userCollapsed: boolean
  manualExpanded: boolean
  history: boolean
  diagnostics: string[]
}

export type UserTurn = {
  id: string
  role: 'user'
  text: string
  createdAt?: number
}

export type ConversationTurn = UserTurn | AssistantTurn

export type ConversationProjection = {
  turns: ConversationTurn[]
  activeTurnId?: string
  activeMessageId?: string
  sequence: number
}

const CONTEXT_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'find',
  'ls',
  'web_search',
  'fetch'
])

const COMMAND_TOOLS = new Set(['bash', 'shell', 'exec', 'command'])
const EDIT_TOOLS = new Set([
  'edit',
  'write',
  'apply_patch',
  'create_file',
  'delete_file'
])
const SUBAGENT_TOOLS = new Set(['task', 'subagent', 'delegate'])

export function createConversationProjection(): ConversationProjection {
  return { turns: [], sequence: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeToolName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '工具'
}

export function classifyAction(toolName: string): ActionCategory {
  const normalized = toolName.toLowerCase()
  if (CONTEXT_TOOLS.has(normalized)) return 'context'
  if (COMMAND_TOOLS.has(normalized)) return 'command'
  if (EDIT_TOOLS.has(normalized)) return 'edit'
  if (SUBAGENT_TOOLS.has(normalized)) return 'subagent'
  return 'external'
}

function safeArgs(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function looksLikeBinary(value: string): boolean {
  if (value.startsWith('data:')) return true
  if (value.length < 512) return false
  return /^[a-z0-9+/=\s]+$/iu.test(value) && !value.includes(' ')
}

function summaryValue(value: unknown, depth = 0): string | undefined {
  if (depth > 2 || value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    if (looksLikeBinary(value)) return undefined
    return value.replace(/\s+/gu, ' ').trim() || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const summary = summaryValue(item, depth + 1)
      if (summary) return summary
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  for (const key of [
    'path',
    'filePath',
    'query',
    'command',
    'target',
    'name',
    'message',
    'summary',
    'text',
    'content'
  ]) {
    const summary = summaryValue(value[key], depth + 1)
    if (summary) return summary
  }
  return undefined
}

export function actionSummary(action: ActionItem): string | undefined {
  const args = action.args
  if (!args) return action.resultSummary
  for (const key of [
    'path',
    'filePath',
    'query',
    'pattern',
    'command',
    'target',
    'name'
  ]) {
    const value = summaryValue(args[key])
    if (value)
      return key === 'command' ? (value.split('\n')[0] ?? value) : value
  }
  return action.resultSummary
}

function nextId(state: ConversationProjection, prefix: string): string {
  state.sequence += 1
  return `${prefix}-${state.sequence}`
}

function currentTurn(
  state: ConversationProjection,
  create = true
): AssistantTurn | undefined {
  const found = state.turns.find(
    (turn): turn is AssistantTurn =>
      turn.role === 'assistant' && turn.id === state.activeTurnId
  )
  if (found || !create) return found
  const turn: AssistantTurn = {
    id: nextId(state, 'assistant'),
    role: 'assistant',
    items: [],
    finalItemIds: [],
    messages: [],
    status: 'running',
    waitingDurationMs: 0,
    userCollapsed: false,
    manualExpanded: false,
    history: false,
    diagnostics: []
  }
  state.turns.push(turn)
  state.activeTurnId = turn.id
  return turn
}

function messageId(
  state: ConversationProjection,
  message: Record<string, unknown> | undefined
): string {
  const id = stringValue(message?.['id'])
  if (id) return id
  if (state.activeMessageId) return state.activeMessageId
  return nextId(state, 'message')
}

function actionByToolCallId(
  turn: AssistantTurn,
  toolCallId: string
): ActionItem | undefined {
  return turn.items.find(
    (item): item is ActionItem =>
      item.kind === 'action' && item.toolCallId === toolCallId
  )
}

function actionFromBlock(
  block: Record<string, unknown>,
  id: string,
  messageIdValue: string,
  blockIndex: number,
  existing?: ActionItem
): ActionItem {
  const toolName = normalizeToolName(block['name'])
  return {
    id,
    kind: 'action',
    toolCallId: id,
    toolName,
    category: classifyAction(toolName),
    args: safeArgs(block['arguments']) ?? existing?.args,
    argsText: stringValue(block['argumentsText']) ?? existing?.argsText,
    intent: stringValue(block['intent']) ?? existing?.intent,
    state: existing?.state ?? 'pending',
    progress: existing?.progress,
    resultSummary: existing?.resultSummary,
    error: existing?.error,
    messageId: messageIdValue,
    blockIndex,
    ended: existing?.ended ?? false
  }
}

function itemsFromMessage(
  turn: AssistantTurn,
  message: Record<string, unknown>,
  messageIdValue: string
): TurnItem[] {
  const content = Array.isArray(message['content']) ? message['content'] : []
  return content.flatMap((rawBlock, blockIndex): TurnItem[] => {
    if (!isRecord(rawBlock)) return []
    const type = rawBlock['type']
    if (type === 'text') {
      const text = stringValue(rawBlock['text']) ?? ''
      return [
        {
          id: `${messageIdValue}:text:${blockIndex}`,
          kind: 'narrative',
          narrative: 'intermediate',
          text,
          messageId: messageIdValue,
          blockIndex
        }
      ]
    }
    if (type === 'thinking') {
      return [
        {
          id: `${messageIdValue}:thinking:${blockIndex}`,
          kind: 'narrative',
          narrative: 'reasoning',
          text: stringValue(rawBlock['thinking']) ?? '',
          messageId: messageIdValue,
          blockIndex
        }
      ]
    }
    if (type === 'redactedThinking') {
      return [
        {
          id: `${messageIdValue}:thinking:${blockIndex}`,
          kind: 'narrative',
          narrative: 'reasoning',
          text: '思考内容不可用',
          messageId: messageIdValue,
          blockIndex
        }
      ]
    }
    if (type === 'toolCall') {
      const toolCallId = stringValue(rawBlock['id'])
      if (!toolCallId) return []
      const existing = actionByToolCallId(turn, toolCallId)
      return [
        actionFromBlock(
          rawBlock,
          toolCallId,
          messageIdValue,
          blockIndex,
          existing
        )
      ]
    }
    return []
  })
}

function applyMessageSnapshot(
  state: ConversationProjection,
  event: OmpEvent
): void {
  if (!isRecord(event['message'])) return
  const message = event['message']
  if (message['role'] !== 'assistant') return
  const turn = currentTurn(state)
  if (!turn) return
  const id = messageId(state, message)
  state.activeMessageId = id
  const existingProjection = turn.messages.find((entry) => entry.id === id)
  const nextItems = itemsFromMessage(turn, message, id)
  const oldIds = new Set(existingProjection?.itemIds ?? [])
  const nextIds = new Set(nextItems.map((item) => item.id))
  const firstOldIndex = turn.items.findIndex((item) => oldIds.has(item.id))
  const retained = turn.items.filter((item) => {
    if (nextIds.has(item.id)) return false
    if (!oldIds.has(item.id)) return true
    return item.kind === 'action' && item.ended
  })
  const insertAt = firstOldIndex < 0 ? retained.length : firstOldIndex
  retained.splice(insertAt, 0, ...nextItems)
  turn.items = retained
  const projection: MessageProjection = {
    id,
    itemIds: nextItems.map((item) => item.id),
    stopReason: stringValue(message['stopReason'])
  }
  if (existingProjection) Object.assign(existingProjection, projection)
  else turn.messages.push(projection)
  if (event.type === 'message_end') state.activeMessageId = undefined
}

function actionStateFromEnd(event: OmpEvent): ActionState {
  if (event['isError'] === true) return 'error'
  const status = stringValue(event['status'])?.toLowerCase()
  if (status === 'rejected' || status === 'denied') return 'rejected'
  if (status === 'aborted' || status === 'cancelled') return 'aborted'
  return 'success'
}

function upsertAction(state: ConversationProjection, event: OmpEvent): void {
  const toolCallId = stringValue(event['toolCallId'])
  if (!toolCallId) return
  const turn = currentTurn(state)
  if (!turn) return
  let action = actionByToolCallId(turn, toolCallId)
  const toolName = normalizeToolName(event['toolName'])
  if (!action) {
    action = {
      id: toolCallId,
      kind: 'action',
      toolCallId,
      toolName,
      category: classifyAction(toolName),
      state: 'pending',
      ended: false
    }
    turn.items.push(action)
  }
  if (
    toolName !== '工具' &&
    action.toolName !== '工具' &&
    action.toolName !== toolName
  ) {
    turn.diagnostics.push(
      `Tool ${toolCallId} 名称冲突：${action.toolName} → ${toolName}`
    )
  }
  if (event.type === 'tool_execution_start') {
    action.toolName = toolName
    action.category = classifyAction(toolName)
    action.args = safeArgs(event['args']) ?? action.args
    action.intent = stringValue(event['intent']) ?? action.intent
    if (!action.ended) action.state = 'running'
    return
  }
  if (event.type === 'tool_execution_update') {
    if (action.ended) return
    action.toolName = toolName
    action.category = classifyAction(toolName)
    action.args = safeArgs(event['args']) ?? action.args
    action.state = 'running'
    action.progress = summaryValue(event['partialResult'])
    return
  }
  if (action.ended) {
    turn.diagnostics.push(`Tool ${toolCallId} 收到重复结束事件`)
  }
  action.toolName = toolName
  action.category = classifyAction(toolName)
  action.args = safeArgs(event['args']) ?? action.args
  action.state = actionStateFromEnd(event)
  action.ended = true
  action.progress = undefined
  if (action.state === 'error') {
    action.error =
      summaryValue(event['error']) ??
      summaryValue(event['result']) ??
      '工具执行失败'
  } else {
    action.resultSummary = summaryValue(event['result'])
  }
}

function interactionOptions(value: unknown): InteractionOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((option): InteractionOption[] => {
    if (typeof option === 'string') return [{ label: option, value: option }]
    if (!isRecord(option)) return []
    const value = stringValue(option['value']) ?? stringValue(option['id'])
    const label =
      stringValue(option['label']) ?? stringValue(option['name']) ?? value
    return value && label ? [{ label, value }] : []
  })
}

function addInteraction(
  state: ConversationProjection,
  event: OmpEvent,
  now: number
): void {
  const requestId = stringValue(event['id'])
  const method = event['method']
  if (
    !requestId ||
    (method !== 'select' &&
      method !== 'confirm' &&
      method !== 'input' &&
      method !== 'editor')
  )
    return
  const turn = currentTurn(state)
  if (!turn) return
  const candidates = turn.items.filter(
    (item): item is ActionItem =>
      item.kind === 'action' &&
      (item.state === 'pending' || item.state === 'running')
  )
  const interaction: InteractionItem = {
    id: `interaction:${requestId}`,
    kind: 'interaction',
    requestId,
    method,
    title: stringValue(event['title']) ?? '需要操作',
    message: stringValue(event['message']),
    placeholder: stringValue(event['placeholder']),
    options: interactionOptions(event['options']),
    actionId: candidates.length === 1 ? candidates[0]?.id : undefined,
    resolved: false
  }
  turn.items.push(interaction)
  turn.status = 'waiting'
  turn.userCollapsed = false
  turn.manualExpanded = true
  turn.waitingStartedAt ??= now
}

function resolveInteraction(
  state: ConversationProjection,
  targetId: string,
  now: number
): void {
  const turn = currentTurn(state, false)
  if (!turn) return
  turn.items = turn.items.filter(
    (item) => item.kind !== 'interaction' || item.requestId !== targetId
  )
  if (turn.waitingStartedAt !== undefined) {
    turn.waitingDurationMs += Math.max(0, now - turn.waitingStartedAt)
    turn.waitingStartedAt = undefined
  }
  if (turn.status === 'waiting') turn.status = 'running'
}

function classifyFinalAnswer(turn: AssistantTurn): void {
  turn.finalItemIds = []
  for (const item of turn.items) {
    if (item.kind === 'narrative' && item.narrative === 'final') {
      item.narrative = 'intermediate'
    }
  }
  const lastMessage = turn.messages.at(-1)
  if (!lastMessage || lastMessage.stopReason !== 'stop') return
  const messageItems = lastMessage.itemIds
    .map((id) => turn.items.find((item) => item.id === id))
    .filter((item): item is TurnItem => item !== undefined)
  const lastToolIndex = messageItems.findLastIndex(
    (item) => item.kind === 'action'
  )
  const candidates =
    lastToolIndex < 0 ? messageItems : messageItems.slice(lastToolIndex + 1)
  const finals = candidates.filter(
    (item): item is NarrativeItem =>
      item.kind === 'narrative' &&
      item.narrative !== 'reasoning' &&
      item.text.trim().length > 0
  )
  for (const item of finals) {
    item.narrative = 'final'
    turn.finalItemIds.push(item.id)
  }
}

function finishTurn(
  state: ConversationProjection,
  event: OmpEvent,
  now: number
): void {
  const turn = currentTurn(state, false)
  if (!turn) return
  if (Array.isArray(event['messages'])) {
    const assistantMessages = event['messages'].filter(
      (message): message is Record<string, unknown> =>
        isRecord(message) && message['role'] === 'assistant'
    )
    const last = assistantMessages.at(-1)
    if (last) {
      applyMessageSnapshot(state, { type: 'message_end', message: last })
    }
  }
  if (turn.waitingStartedAt !== undefined) {
    turn.waitingDurationMs += Math.max(0, now - turn.waitingStartedAt)
    turn.waitingStartedAt = undefined
  }
  turn.endedAt = now
  const pendingInteraction = turn.items.some(
    (item) => item.kind === 'interaction' && !item.resolved
  )
  if (pendingInteraction) {
    turn.status = 'waiting'
    return
  }
  let incomplete = false
  for (const item of turn.items) {
    if (
      item.kind === 'action' &&
      (item.state === 'pending' || item.state === 'running')
    ) {
      item.state = 'incomplete'
      item.ended = true
      incomplete = true
    }
  }
  const stopReason = turn.messages.at(-1)?.stopReason
  if (stopReason === 'stop') {
    turn.status = incomplete ? 'completed-incomplete' : 'completed'
    classifyFinalAnswer(turn)
  } else if (stopReason === 'length') {
    turn.status = 'length'
  } else if (stopReason === 'aborted') {
    turn.status = 'aborted'
  } else {
    turn.status = 'error'
  }
  state.activeTurnId = undefined
  state.activeMessageId = undefined
}

function cloneProjection(
  projection: ConversationProjection
): ConversationProjection {
  return {
    ...projection,
    turns: projection.turns.map((turn) => {
      if (turn.role !== 'assistant' || turn.id !== projection.activeTurnId) {
        return turn
      }
      return {
        ...turn,
        items: turn.items.map((item) => ({ ...item })),
        finalItemIds: [...turn.finalItemIds],
        messages: turn.messages.map((message) => ({
          ...message,
          itemIds: [...message.itemIds]
        })),
        diagnostics: [...turn.diagnostics]
      }
    })
  }
}

export function reduceOmpEvent(
  projection: ConversationProjection,
  event: OmpEvent,
  now = Date.now()
): ConversationProjection {
  const state = cloneProjection(projection)
  switch (event.type) {
    case 'agent_start': {
      const turn = currentTurn(state)
      if (turn) {
        turn.status = 'running'
        turn.startedAt ??= now
      }
      break
    }
    case 'message_start':
    case 'message_update':
    case 'message_end':
      applyMessageSnapshot(state, event)
      break
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      upsertAction(state, event)
      break
    case 'extension_ui_request':
      if (
        event['method'] === 'cancel' &&
        typeof event['targetId'] === 'string'
      ) {
        resolveInteraction(state, event['targetId'], now)
      } else {
        addInteraction(state, event, now)
      }
      break
    case 'extension_ui_resolved':
      if (typeof event['id'] === 'string') {
        resolveInteraction(state, event['id'], now)
      }
      break
    case 'auto_retry_start': {
      const turn = currentTurn(state)
      if (turn) turn.status = 'retrying'
      break
    }
    case 'auto_retry_end': {
      const turn = currentTurn(state, false)
      if (turn && turn.status === 'retrying') turn.status = 'running'
      break
    }
    case 'auto_compaction_start': {
      const turn = currentTurn(state)
      if (turn) turn.diagnostics.push('开始压缩上下文')
      break
    }
    case 'auto_compaction_end': {
      const turn = currentTurn(state, false)
      if (turn) turn.diagnostics.push('上下文压缩结束')
      break
    }
    case 'notice': {
      const turn = currentTurn(state, false)
      const message = stringValue(event['message'])
      if (turn && message) turn.diagnostics.push(message)
      break
    }
    case 'turn_start':
    case 'turn_end':
      break
    case 'agent_end':
      finishTurn(state, event, now)
      break
  }
  return state
}

export function appendUserTurn(
  projection: ConversationProjection,
  text: string,
  now = Date.now()
): ConversationProjection {
  const state = cloneProjection(projection)
  state.turns.push({
    id: nextId(state, 'user'),
    role: 'user',
    text,
    createdAt: now
  })
  return state
}

export function setTurnCollapsed(
  projection: ConversationProjection,
  turnId: string,
  collapsed: boolean
): ConversationProjection {
  const state = cloneProjection(projection)
  state.sequence += 1
  const turnIndex = state.turns.findIndex(
    (item) => item.role === 'assistant' && item.id === turnId
  )
  const existing = state.turns[turnIndex]
  if (existing?.role === 'assistant') {
    state.turns[turnIndex] = {
      ...existing,
      items: existing.items.map((item) => ({ ...item })),
      finalItemIds: [...existing.finalItemIds],
      messages: existing.messages.map((message) => ({
        ...message,
        itemIds: [...message.itemIds]
      })),
      diagnostics: [...existing.diagnostics]
    }
  }
  const turn = state.turns.find(
    (item): item is AssistantTurn =>
      item.role === 'assistant' && item.id === turnId
  )
  if (turn) turn.userCollapsed = collapsed
  if (turn) turn.manualExpanded = !collapsed
  return state
}

function visibleUserText(message: Record<string, unknown>): string | undefined {
  if (message['role'] !== 'user' || message['hidden'] === true) return undefined
  const content = message['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part['type'] === 'text'
    )
    .map((part) => stringValue(part['text']) ?? '')
    .join('')
}

function toolResultId(message: Record<string, unknown>): string | undefined {
  if (message['role'] !== 'toolResult') return undefined
  return stringValue(message['toolCallId'])
}

export function projectHistory(raw: unknown): ConversationProjection {
  const state = createConversationProjection()
  const messages = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['messages'])
      ? raw['messages']
      : []
  for (const rawMessage of messages) {
    if (!isRecord(rawMessage)) continue
    const userText = visibleUserText(rawMessage)
    if (userText !== undefined) {
      state.activeTurnId = undefined
      state.activeMessageId = undefined
      state.turns.push({
        id: nextId(state, 'user'),
        role: 'user',
        text: userText,
        createdAt:
          typeof rawMessage['timestamp'] === 'number'
            ? rawMessage['timestamp']
            : undefined
      })
      continue
    }
    if (rawMessage['role'] === 'assistant') {
      const id =
        stringValue(rawMessage['id']) ??
        stringValue(rawMessage['timestamp']) ??
        nextId(state, 'history-message')
      state.activeMessageId = id
      applyMessageSnapshot(state, {
        type: 'message_end',
        message: { ...rawMessage, id }
      })
      const turn = currentTurn(state, false)
      if (turn) turn.history = true
      continue
    }
    const resultId = toolResultId(rawMessage)
    if (resultId) {
      const turn = currentTurn(state, false)
      const action = turn && actionByToolCallId(turn, resultId)
      if (action) {
        action.ended = true
        action.state = rawMessage['isError'] === true ? 'error' : 'success'
        if (action.state === 'error') {
          action.error = summaryValue(rawMessage['content'])
        } else {
          action.resultSummary = summaryValue(rawMessage['content'])
        }
      }
    }
  }
  for (const turn of state.turns) {
    if (turn.role !== 'assistant') continue
    let incomplete = false
    for (const item of turn.items) {
      if (
        item.kind === 'action' &&
        (item.state === 'pending' || item.state === 'running')
      ) {
        item.state = 'incomplete'
        item.ended = true
        incomplete = true
      }
    }
    const reason = turn.messages.at(-1)?.stopReason
    turn.status =
      reason === 'stop'
        ? incomplete
          ? 'completed-incomplete'
          : 'completed'
        : reason === 'length'
          ? 'length'
          : reason === 'aborted'
            ? 'aborted'
            : 'error'
    if (reason === 'stop') classifyFinalAnswer(turn)
  }
  state.activeTurnId = undefined
  state.activeMessageId = undefined
  return state
}

export function turnStatusText(status: RunStatus): string {
  switch (status) {
    case 'running':
      return '进行中'
    case 'retrying':
      return '重试中'
    case 'waiting':
      return '等待操作'
    case 'completed':
      return '已完成'
    case 'completed-incomplete':
      return '已完成 · 记录不完整'
    case 'length':
      return '输出不完整'
    case 'error':
      return '失败'
    case 'aborted':
      return '已中止'
  }
}

export function turnElapsedMs(
  turn: AssistantTurn,
  now = Date.now()
): number | undefined {
  if (turn.startedAt === undefined) return undefined
  const end = turn.endedAt ?? now
  const activeWait =
    turn.waitingStartedAt === undefined
      ? 0
      : Math.max(0, now - turn.waitingStartedAt)
  return Math.max(0, end - turn.startedAt - turn.waitingDurationMs - activeWait)
}

export function shouldCollapseTurn(turn: AssistantTurn): boolean {
  return (
    turn.userCollapsed ||
    (!turn.manualExpanded &&
      (turn.status === 'completed' || turn.status === 'completed-incomplete'))
  )
}
