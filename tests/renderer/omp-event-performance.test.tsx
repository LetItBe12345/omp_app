import { act, render } from '@testing-library/react'
import { Profiler, useEffect, useState, type ComponentProps } from 'react'
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
  onReady,
  onRender
}: {
  initial: ConversationProjection
  onReady: (
    setter: React.Dispatch<React.SetStateAction<ConversationProjection>>
  ) => void
  onRender: ComponentProps<typeof Profiler>['onRender']
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
        <Profiler id="conversation" onRender={onRender}>
          <ThreadMessages />
        </Profiler>
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
    let batchStartedAt: number | undefined
    const commitLatencies: number[] = []
    const renderDurations: number[] = []
    const recordCommit: ComponentProps<typeof Profiler>['onRender'] = (
      _id,
      phase,
      actualDuration,
      _baseDuration,
      _startTime,
      commitTime
    ): void => {
      if (phase === 'mount' || batchStartedAt === undefined) return
      commitLatencies.push(commitTime - batchStartedAt)
      renderDurations.push(actualDuration)
      batchStartedAt = undefined
    }
    const { container } = render(
      <PerformanceHarness
        initial={projection}
        onReady={setUpdater}
        onRender={recordCommit}
      />
    )
    const firstHistoryMessage = container.querySelector('.assistant-message')

    for (let second = 0; second < 60; second += 1) {
      batchStartedAt = performance.now()
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
      // React 提交时已经更新 DOM。文字断言只检查结果，不计入性能数据。
      expect(container.querySelector('.process-content')).toHaveTextContent(
        `可见流式输出 ${second * 100 + 99}`
      )
    }

    const commitP95 = commitLatencies.sort((left, right) => left - right)[
      Math.floor(commitLatencies.length * 0.95)
    ]
    const renderP95 = renderDurations.sort((left, right) => left - right)[
      Math.floor(renderDurations.length * 0.95)
    ]
    expect(commitLatencies).toHaveLength(60)
    expect(commitLatencies.every((duration) => duration >= 0)).toBe(true)
    expect(commitP95).toBeLessThan(100)
    expect(renderP95).toBeLessThan(100)
    expect(container.querySelector('.assistant-message')).toBe(
      firstHistoryMessage
    )
  }, 20_000)
})
