import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ToolApprovalRequest } from '../../src/shared/desktop-api'
import {
  ConversationRuntime,
  ThreadMessages
} from '../../src/renderer/conversation-thread'
import {
  createConversationProjection,
  reduceOmpEvent,
  type ConversationProjection
} from '../../src/renderer/omp-event-reducer'

function projectionFrom(
  events: Array<{ type: string; [key: string]: unknown }>
): ConversationProjection {
  return events.reduce(
    (projection, event, index) =>
      reduceOmpEvent(projection, event, index * 1_000),
    createConversationProjection()
  )
}

function Harness({
  initial,
  toolApprovals
}: {
  initial: ConversationProjection
  toolApprovals?: ToolApprovalRequest[]
}): React.JSX.Element {
  const [projection, setProjection] = useState(initial)
  return (
    <div style={{ height: 700 }}>
      <ConversationRuntime
        isRunning={false}
        onCancel={async () => undefined}
        onSend={async () => undefined}
        projection={projection}
        setProjection={setProjection}
      >
        <ThreadMessages toolApprovals={toolApprovals} />
      </ConversationRuntime>
    </div>
  )
}

describe('ConversationThread', () => {
  it('工具审批使用中文单项和批量操作，默认焦点在允许', async () => {
    const deadline = Date.now() + 30_000
    const initial = projectionFrom([{ type: 'agent_start' }])
    const { rerender } = render(
      <Harness
        initial={initial}
        toolApprovals={[
          {
            id: 'approval-1',
            summary: '命令 · pnpm test',
            status: 'pending',
            deadline
          }
        ]}
      />
    )

    expect(screen.getByText('命令 · pnpm test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '允许' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '允许' }))
    expect(window.desktop.respondExtensionUi).toHaveBeenCalledWith(
      'approval-1',
      { value: 'Approve' }
    )

    rerender(
      <Harness
        initial={initial}
        toolApprovals={[
          {
            id: 'approval-1',
            summary: '命令 · pnpm test',
            status: 'pending',
            deadline
          },
          {
            id: 'approval-2',
            summary: '写入 · src/app.ts',
            status: 'pending',
            deadline
          }
        ]}
      />
    )
    expect(screen.getByText('待确认 2 / 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '全部拒绝' }))
    expect(window.desktop.respondExtensionUi).toHaveBeenCalledWith(
      'approval-1',
      { value: 'Deny' }
    )
    expect(window.desktop.respondExtensionUi).toHaveBeenCalledWith(
      'approval-2',
      { value: 'Deny' }
    )
  })

  it('完成后只显示单行摘要和最终回答，点击一次展开完整过程', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'thinking', thinking: '检查代码' },
            { type: 'text', text: '先读取文件。' },
            {
              type: 'toolCall',
              id: 't1',
              name: 'read',
              arguments: { path: 'src/app.tsx' }
            }
          ]
        }
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: { path: 'src/app.tsx' }
      },
      {
        type: 'message_end',
        message: {
          id: 'a2',
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '已经检查完成。' }]
        }
      },
      { type: 'agent_end' }
    ])
    render(<Harness initial={projection} />)

    const summary = await screen.findByRole('button', {
      name: /思考了 4 秒 · 1 个工具 · 已完成/
    })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('检查代码')).not.toBeInTheDocument()
    expect(screen.getAllByText('已经检查完成。')).toHaveLength(1)

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('检查代码')).toBeInTheDocument()
    expect(screen.getByText('先读取文件。')).toBeInTheDocument()
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
    expect(screen.queryByText(/展开全文|查看详情/)).not.toBeInTheDocument()
  })

  it('等待 Interaction 时保持展开并原样回传 select 选择', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'ui-1',
        method: 'select',
        title: '选择环境',
        options: [
          { label: '开发', value: 'dev' },
          { label: '生产', value: 'prod' }
        ]
      }
    ])
    render(<Harness initial={projection} />)

    expect(
      await screen.findByRole('button', { name: /等待操作/ })
    ).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '开发' }))
    await waitFor(() =>
      expect(window.desktop.respondExtensionUi).toHaveBeenCalledWith('ui-1', {
        value: 'dev'
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('选择环境')).not.toBeInTheDocument()
    )
  })

  it('失败轨迹保持展开，完整错误直接可见', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        isError: true,
        error: '命令退出码为 1'
      },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'error',
          content: []
        }
      },
      { type: 'agent_end' }
    ])
    render(<Harness initial={projection} />)

    expect(await screen.findByRole('button', { name: /失败/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByText('命令退出码为 1')).toBeInTheDocument()
  })

  it('Markdown 不执行原始 HTML、危险链接或远程图片', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '<script>window.bad = true</script>\n[危险链接](javascript:alert(1))\n![远程图](https://example.com/a.png)'
            }
          ]
        }
      },
      { type: 'agent_end' }
    ])
    const { container } = render(<Harness initial={projection} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(await screen.findByText('危险链接'))
    expect(window.desktop.openExternal).not.toHaveBeenCalled()
    expect(screen.getByText('远程图')).toBeInTheDocument()
  })

  it('HTTP 链接和有效本地路径只在按住修饰键时打开', async () => {
    vi.mocked(window.desktop.validateLocalPath).mockImplementation(
      async (value) => value === 'src/main.ts:12:3'
    )
    const projection = projectionFrom([
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '[文档](https://example.com/docs) `src/main.ts:12:3`\n\n```\nsrc/ignored.ts\n```'
            }
          ]
        }
      },
      { type: 'agent_end' }
    ])
    render(<Harness initial={projection} />)

    const external = await screen.findByText('文档')
    fireEvent.click(external)
    expect(window.desktop.openExternal).not.toHaveBeenCalled()
    fireEvent.click(external, { ctrlKey: true })
    expect(window.desktop.openExternal).toHaveBeenCalledWith(
      'https://example.com/docs'
    )

    const local = await screen.findByRole('link', {
      name: 'Ctrl+Enter 打开 src/main.ts:12:3'
    })
    fireEvent.click(local)
    expect(window.desktop.revealPath).not.toHaveBeenCalled()
    fireEvent.keyDown(local, { key: 'Enter', ctrlKey: true })
    expect(window.desktop.revealPath).toHaveBeenCalledWith('src/main.ts:12:3')
    expect(screen.getByText('src/ignored.ts').closest('a')).toBeNull()
  })

  it('顶层复制按钮走 Desktop 原生剪贴板 IPC', async () => {
    const projection = projectionFrom([
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '回答内容' }]
        }
      },
      { type: 'agent_end' }
    ])
    render(<Harness initial={projection} />)

    fireEvent.click(await screen.findByRole('button', { name: '复制回答' }))
    await waitFor(() =>
      expect(window.desktop.copyText).toHaveBeenCalledWith('回答内容')
    )
  })
})
