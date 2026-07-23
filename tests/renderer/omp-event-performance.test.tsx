import { act, render, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  ConversationRuntime,
  ThreadMessages
} from '../../src/renderer/conversation-thread'
import {
  projectHistory,
  reduceOmpEvent,
  type AssistantTurn,
  type ConversationProjection
} from '../../src/renderer/omp-event-reducer'

function PerformanceHarness({
  initial,
  onReady
}: {
  initial: ConversationProjection
  onReady: (
    setter: React.Dispatch<React.SetStateAction<ConversationProjection>>
  ) => void
}): React.JSX.Element {
  const [projection, setProjection] = useState(initial)
  useEffect(() => onReady(setProjection), [onReady])
  return (
    <div style={{ height: 700 }}>
      <ConversationRuntime
        isRunning
        onCancel={async () => undefined}
        onSend={async () => undefined}
        projection={projection}
        setProjection={setProjection}
      >
        <ThreadMessages />
      </ConversationRuntime>
    </div>
  )
}

function historyMessages(): Array<Record<string, unknown>> {
  return Array.from({ length: 1_000 }, (_, index) =>
    index % 2 === 0
      ? {
          role: 'user',
          content: [{ type: 'text', text: `问题 ${index / 2}` }]
        }
      : {
          id: `assistant-${index}`,
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: `回答 ${index / 2}` }]
        }
  )
}

describe('流式投影性能', () => {
  it('1,000 条历史后处理 6,000 个累计快照，批次 P95 小于 100ms 且不保存旧快照', () => {
    let projection = projectHistory({ messages: historyMessages() })
    projection = reduceOmpEvent(projection, { type: 'agent_start' }, 0)
    const durations: number[] = []

    for (let batch = 0; batch < 60; batch += 1) {
      const startedAt = performance.now()
      for (let index = 0; index < 100; index += 1) {
        const sequence = batch * 100 + index
        projection = reduceOmpEvent(
          projection,
          {
            type: 'message_update',
            message: {
              id: 'streaming-message',
              role: 'assistant',
              content: [{ type: 'text', text: `流式输出 ${sequence}` }]
            }
          },
          sequence
        )
      }
      durations.push(performance.now() - startedAt)
    }

    const sorted = [...durations].sort((left, right) => left - right)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity
    const active = projection.turns.find(
      (turn): turn is AssistantTurn =>
        turn.role === 'assistant' && turn.id === projection.activeTurnId
    )
    expect(p95).toBeLessThan(100)
    expect(active?.items).toHaveLength(1)
    expect(active?.items[0]).toMatchObject({ text: '流式输出 5999' })
    expect(JSON.stringify(active).length).toBeLessThan(20_000)
  })

  it('1,000 条历史挂载后模拟 60 秒流式更新，React 提交批次 P95 小于 100ms', async () => {
    let projection = projectHistory({ messages: historyMessages() })
    projection = reduceOmpEvent(projection, { type: 'agent_start' }, 0)
    let updateProjection:
      React.Dispatch<React.SetStateAction<ConversationProjection>> | undefined
    const setUpdater = (
      setter: React.Dispatch<React.SetStateAction<ConversationProjection>>
    ): void => {
      updateProjection = setter
    }
    const { container } = render(
      <PerformanceHarness initial={projection} onReady={setUpdater} />
    )
    const durations: number[] = []

    for (let second = 0; second < 60; second += 1) {
      const startedAt = performance.now()
      await act(async () => {
        updateProjection?.((current) => {
          let next = current
          for (let index = 0; index < 100; index += 1) {
            const sequence = second * 100 + index
            next = reduceOmpEvent(
              next,
              {
                type: 'message_update',
                message: {
                  id: 'streaming-message',
                  role: 'assistant',
                  content: [{ type: 'text', text: `可见流式输出 ${sequence}` }]
                }
              },
              sequence
            )
          }
          return next
        })
      })
      await waitFor(
        () => {
          const assistantMessages =
            container.querySelectorAll('.assistant-message')
          expect(
            assistantMessages.item(assistantMessages.length - 1)
          ).toHaveTextContent(`可见流式输出 ${second * 100 + 99}`)
        },
        { interval: 5, timeout: 100 }
      )
      durations.push(performance.now() - startedAt)
    }

    const sorted = durations.sort((left, right) => left - right)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity
    expect(p95).toBeLessThan(100)
  }, 20_000)
})
