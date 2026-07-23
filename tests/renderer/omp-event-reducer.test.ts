import { describe, expect, it } from 'vitest'
import {
  appendUserTurn,
  createConversationProjection,
  projectHistory,
  reduceOmpEvent,
  setTurnCollapsed,
  shouldCollapseTurn,
  turnElapsedMs,
  turnStatusText,
  type AssistantTurn
} from '../../src/renderer/omp-event-reducer'

function assistantTurn(
  projection: ReturnType<typeof createConversationProjection>
): AssistantTurn {
  const turn = projection.turns.find(
    (item): item is AssistantTurn => item.role === 'assistant'
  )
  if (!turn) throw new Error('缺少 Assistant Turn')
  return turn
}

function run(
  events: Array<{ type: string; [key: string]: unknown }>
): ReturnType<typeof createConversationProjection> {
  return events.reduce(
    (projection, event, index) =>
      reduceOmpEvent(projection, event, index * 100),
    createConversationProjection()
  )
}

describe('OmpEventReducer', () => {
  it('message_update 使用累计快照替换，不重复追加文本', () => {
    const projection = run([
      { type: 'agent_start' },
      {
        type: 'message_start',
        message: { id: 'a1', role: 'assistant', content: [] }
      },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '你' }]
        }
      },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '你好' }]
        }
      }
    ])

    const turn = assistantTurn(projection)
    expect(turn.items).toHaveLength(1)
    expect(turn.items[0]).toMatchObject({ kind: 'narrative', text: '你好' })
  })

  it('保留过程文本、工具和最终文本的原始顺序，并只引用最终文本一次', () => {
    const projection = run([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'text', text: '先检查。' },
            {
              type: 'toolCall',
              id: 't1',
              name: 'read',
              arguments: { path: 'a.ts' }
            }
          ]
        }
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: { path: 'a.ts', summary: '读取完成' }
      },
      {
        type: 'message_end',
        message: {
          id: 'a2',
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '检查完成。' }]
        }
      },
      { type: 'agent_end' }
    ])

    const turn = assistantTurn(projection)
    expect(
      turn.items.map((item) =>
        item.kind === 'narrative' ? item.text : item.kind
      )
    ).toEqual(['先检查。', 'action', '检查完成。'])
    expect(turn.finalItemIds).toHaveLength(1)
    expect(
      turn.items.filter(
        (item) => item.kind === 'narrative' && item.narrative === 'final'
      )
    ).toHaveLength(1)
  })

  it('同一 toolCallId 归并乱序、重复和结束后的旧进度', () => {
    const projection = run([
      { type: 'agent_start' },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'bash',
        partialResult: '旧进度'
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: { summary: '完成' }
      },
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'pnpm test' }
      },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'bash',
        partialResult: '不应倒退'
      }
    ])

    const actions = assistantTurn(projection).items.filter(
      (item) => item.kind === 'action'
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      state: 'success',
      ended: true,
      progress: undefined,
      args: { command: 'pnpm test' }
    })
  })

  it('Tool Update 先于消息中的 Tool Call 到达时仍只有一个 Action', () => {
    const projection = run([
      { type: 'agent_start' },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'read',
        partialResult: '读取中'
      },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 't1',
              name: 'read',
              arguments: { path: 'a.ts' }
            }
          ]
        }
      }
    ])
    const actions = assistantTurn(projection).items.filter(
      (item) => item.kind === 'action'
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      toolCallId: 't1',
      progress: '读取中',
      args: { path: 'a.ts' }
    })
  })

  it('Interaction 只在唯一候选 Action 时关联，处理后移除控件', () => {
    let projection = run([
      { type: 'agent_start' },
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash'
      },
      {
        type: 'extension_ui_request',
        id: 'ui1',
        method: 'select',
        title: '选择',
        options: ['A', 'B']
      }
    ])
    let turn = assistantTurn(projection)
    expect(turn.status).toBe('waiting')
    expect(turn.items.at(-1)).toMatchObject({
      kind: 'interaction',
      actionId: 't1'
    })

    projection = reduceOmpEvent(
      projection,
      { type: 'extension_ui_resolved', id: 'ui1' },
      1_000
    )
    turn = assistantTurn(projection)
    expect(turn.items.some((item) => item.kind === 'interaction')).toBe(false)
    expect(turn.items.some((item) => item.kind === 'action')).toBe(true)
  })

  it('正常 stop、length、error、aborted 只对 stop 分类最终回答', () => {
    for (const reason of ['stop', 'length', 'error', 'aborted']) {
      const projection = run([
        { type: 'agent_start' },
        {
          type: 'message_end',
          message: {
            id: `a-${reason}`,
            role: 'assistant',
            stopReason: reason,
            content: [{ type: 'text', text: '输出' }]
          }
        },
        { type: 'agent_end' }
      ])
      const turn = assistantTurn(projection)
      expect(turn.finalItemIds.length).toBe(reason === 'stop' ? 1 : 0)
      expect(turnStatusText(turn.status)).toBe(
        {
          stop: '已完成',
          length: '输出不完整',
          error: '失败',
          aborted: '已中止'
        }[reason]
      )
    }
  })

  it('stop 没有非空最终文本时折叠且不生成空最终项', () => {
    const turn = assistantTurn(
      run([
        { type: 'agent_start' },
        {
          type: 'message_end',
          message: {
            id: 'a1',
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'thinking', thinking: '检查完成条件' }]
          }
        },
        { type: 'agent_end' }
      ])
    )
    expect(turn.status).toBe('completed')
    expect(turn.finalItemIds).toEqual([])
    expect(shouldCollapseTurn(turn)).toBe(true)
  })

  it('stop 时缺少 Tool End 标记记录不完整并默认折叠', () => {
    const turn = assistantTurn(
      run([
        { type: 'agent_start' },
        {
          type: 'message_end',
          message: {
            id: 'a1',
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'toolCall', id: 't1', name: 'read' }]
          }
        },
        { type: 'agent_end' }
      ])
    )
    expect(turn.status).toBe('completed-incomplete')
    expect(shouldCollapseTurn(turn)).toBe(true)
    expect(turn.items[0]).toMatchObject({ state: 'incomplete' })
  })

  it('手动折叠和展开覆盖运行中与完成态默认值', () => {
    let projection = run([{ type: 'agent_start' }])
    let turn = assistantTurn(projection)
    expect(shouldCollapseTurn(turn)).toBe(false)
    projection = setTurnCollapsed(projection, turn.id, true)
    turn = assistantTurn(projection)
    expect(shouldCollapseTurn(turn)).toBe(true)
    projection = setTurnCollapsed(projection, turn.id, false)
    turn = assistantTurn(projection)
    expect(shouldCollapseTurn(turn)).toBe(false)
  })

  it('摘要耗时扣除 Interaction 等待时间', () => {
    const projection = run([
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'ui1',
        method: 'confirm',
        title: '继续'
      },
      { type: 'extension_ui_resolved', id: 'ui1' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '完成' }]
        }
      },
      { type: 'agent_end' }
    ])
    const turn = assistantTurn(projection)
    expect(turnElapsedMs(turn)).toBe(300)
  })

  it('历史按可见用户消息分 Turn，隐藏用户消息不切断 Turn', () => {
    const projection = projectHistory({
      messages: [
        {
          role: 'assistant',
          id: 'orphan',
          stopReason: 'stop',
          content: [{ type: 'text', text: '历史开头' }]
        },
        { role: 'user', content: [{ type: 'text', text: '问题' }] },
        {
          role: 'assistant',
          id: 'a1',
          stopReason: 'toolUse',
          content: [{ type: 'toolCall', id: 't1', name: 'read' }]
        },
        { role: 'user', hidden: true, content: '合成消息' },
        {
          role: 'toolResult',
          toolCallId: 't1',
          content: [{ type: 'text', text: '完成' }]
        },
        {
          role: 'assistant',
          id: 'a2',
          stopReason: 'stop',
          content: [{ type: 'text', text: '回答' }]
        }
      ]
    })

    expect(projection.turns.map((turn) => turn.role)).toEqual([
      'assistant',
      'user',
      'assistant'
    ])
    const last = projection.turns.at(-1)
    expect(last?.role === 'assistant' && last.finalItemIds).toHaveLength(1)
  })

  it('用户消息追加不复制已有投影', () => {
    const initial = createConversationProjection()
    const next = appendUserTurn(initial, '测试')
    expect(initial.turns).toEqual([])
    expect(next.turns[0]).toMatchObject({ role: 'user', text: '测试' })
  })
})
