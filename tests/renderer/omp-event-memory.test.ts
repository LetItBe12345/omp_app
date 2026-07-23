// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  projectHistory,
  reduceOmpEvent,
  type AssistantTurn,
  type ConversationProjection
} from '../../src/renderer/omp-event-reducer'

function applySnapshots(
  initial: ConversationProjection,
  count: number
): ConversationProjection {
  let projection = initial
  for (let index = 0; index < count; index += 1) {
    projection = reduceOmpEvent(projection, {
      type: 'message_update',
      message: {
        id: 'stream',
        role: 'assistant',
        content: [{ type: 'text', text: `snapshot ${index}` }]
      }
    })
  }
  return projection
}

describe('流式投影内存', () => {
  it('GC 后连续输出不保留旧累计快照', () => {
    const messages = Array.from({ length: 1_000 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      ...(index % 2 === 0 ? {} : { id: `a-${index}`, stopReason: 'stop' }),
      content: [{ type: 'text', text: `历史 ${index}` }]
    }))
    let projection = projectHistory({ messages })
    projection = reduceOmpEvent(projection, { type: 'agent_start' })
    projection = applySnapshots(projection, 6_000)

    const runtime = globalThis as typeof globalThis & {
      gc?: () => void
      process: { memoryUsage(): { heapUsed: number } }
    }
    const gc = runtime.gc
    gc?.()
    const baseline = runtime.process.memoryUsage().heapUsed
    projection = applySnapshots(projection, 6_000)
    gc?.()
    const after = runtime.process.memoryUsage().heapUsed
    const active = projection.turns.find(
      (turn): turn is AssistantTurn =>
        turn.role === 'assistant' && turn.id === projection.activeTurnId
    )

    expect(active?.items).toHaveLength(1)
    expect(active?.items[0]).toMatchObject({ text: 'snapshot 5999' })
    if (gc) expect(after - baseline).toBeLessThan(8 * 1024 * 1024)
  })
})
