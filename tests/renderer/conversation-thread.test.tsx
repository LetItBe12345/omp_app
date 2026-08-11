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
  toolApprovals,
  workspacePath
}: {
  initial: ConversationProjection
  toolApprovals?: ToolApprovalRequest[]
  workspacePath?: string
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
        workspacePath={workspacePath}
      >
        <ThreadMessages toolApprovals={toolApprovals} />
      </ConversationRuntime>
    </div>
  )
}

describe('ConversationThread', () => {
  it('活动 Turn 完成并转入历史时不会按旧索引读取消息', async () => {
    function CompletionHarness(): React.JSX.Element {
      const [projection, setProjection] = useState(() =>
        projectionFrom([
          { type: 'agent_start' },
          {
            type: 'message_end',
            message: {
              id: 'working',
              role: 'assistant',
              stopReason: 'toolUse',
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'read',
                  arguments: { path: 'README.md' }
                }
              ]
            }
          }
        ])
      )
      return (
        <div style={{ height: 700 }}>
          <button
            onClick={() =>
              setProjection((current) =>
                reduceOmpEvent(current, {
                  type: 'message_end',
                  message: {
                    id: 'final',
                    role: 'assistant',
                    stopReason: 'stop',
                    content: [{ type: 'text', text: '最终回答' }]
                  }
                })
              )
            }
            type="button"
          >
            完成
          </button>
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

    render(<CompletionHarness />)
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(await screen.findByText('最终回答')).toBeInTheDocument()
  })

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
    const { container } = render(<Harness initial={projection} />)

    const summary = await screen.findByRole('button', {
      name: /已完成 · 1 次工具调用 · 4秒/
    })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('检查代码')).not.toBeInTheDocument()
    expect(screen.getAllByText('已经检查完成。')).toHaveLength(1)

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('检查代码')).toBeInTheDocument()
    expect(screen.getByText('先读取文件。')).toBeInTheDocument()
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
    expect(container.querySelector('.context-group')).toBeNull()
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

  it('活动 Turn 的尾部普通文本显示为回答候选，且不显示 Process 摘要和复制按钮', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: '## 正在整理\n\n候选回答' }]
        }
      }
    ])
    const { container } = render(<Harness initial={projection} />)

    expect(
      await screen.findByRole('heading', { name: '正在整理' })
    ).toBeVisible()
    expect(screen.getByText('候选回答')).toBeVisible()
    expect(
      container.querySelector('.assistant-answer-candidate')
    ).not.toBeNull()
    expect(container.querySelector('.process-summary')).toBeNull()
    expect(screen.queryByRole('button', { name: '复制回答' })).toBeNull()
  })

  it('新的工具项到来后，原回答候选回退到 Process', async () => {
    function CandidateFallbackHarness(): React.JSX.Element {
      const [projection, setProjection] = useState(() =>
        projectionFrom([
          { type: 'agent_start' },
          {
            type: 'message_update',
            message: {
              id: 'a1',
              role: 'assistant',
              content: [{ type: 'text', text: '我先给出判断。' }]
            }
          }
        ])
      )
      return (
        <div style={{ height: 700 }}>
          <button
            onClick={() =>
              setProjection((current) =>
                reduceOmpEvent(current, {
                  type: 'message_update',
                  message: {
                    id: 'a1',
                    role: 'assistant',
                    content: [
                      { type: 'text', text: '我先给出判断。' },
                      {
                        type: 'toolCall',
                        id: 't1',
                        name: 'read',
                        arguments: { path: 'README.md' }
                      }
                    ]
                  }
                })
              )
            }
            type="button"
          >
            添加工具
          </button>
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

    const { container } = render(<CandidateFallbackHarness />)
    expect(await screen.findByText('我先给出判断。')).toBeVisible()
    expect(
      container.querySelector('.assistant-answer-candidate')
    ).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加工具' }))

    await waitFor(() =>
      expect(container.querySelector('.assistant-answer-candidate')).toBeNull()
    )
    expect(screen.getByLabelText('完整执行过程')).toHaveTextContent(
      '我先给出判断。'
    )
    expect(screen.getByLabelText('完整执行过程')).toHaveTextContent('读取')
  })

  it('工具逐条显示，不生成 Context Group，并缩短工作区内路径', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
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
              arguments: { path: '/workspace/project/src/app.tsx' }
            },
            {
              type: 'toolCall',
              id: 't2',
              name: 'grep',
              arguments: { pattern: 'ConversationRuntime' }
            }
          ]
        }
      }
    ])
    const { container } = render(
      <Harness initial={projection} workspacePath="/workspace/project" />
    )

    expect(await screen.findByText('src/app.tsx')).toBeVisible()
    expect(screen.getByText('ConversationRuntime')).toBeVisible()
    expect(container.querySelectorAll('.tool-row')).toHaveLength(2)
    expect(container.querySelector('.context-group')).toBeNull()
  })

  it('隐藏 redacted thinking，子任务只显示一行清理后的结果摘要', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'redactedThinking' },
            {
              type: 'toolCall',
              id: 't1',
              name: 'task',
              arguments: { tasks: [{ name: 'A' }, { name: 'B' }] }
            }
          ]
        }
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'task',
        result: { summary: '**完成** [报告](https://example.com)' }
      }
    ])
    render(<Harness initial={projection} />)

    expect(await screen.findByText('2 个任务')).toBeVisible()
    expect(screen.getByText('完成 报告')).toBeVisible()
    expect(screen.queryByText('思考内容不可用')).toBeNull()
  })

  it('空文本不打断候选，Thinking 保持在 Process', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '内部检查' },
            { type: 'text', text: '可见候选' },
            { type: 'text', text: '   ' }
          ]
        }
      }
    ])
    const { container } = render(<Harness initial={projection} />)

    expect(await screen.findByText('可见候选')).toBeVisible()
    expect(
      container.querySelector('.assistant-answer-candidate')
    ).toHaveTextContent('可见候选')
    expect(screen.getByLabelText('完整执行过程')).toHaveTextContent('内部检查')
    expect(container.querySelector('.thinking-narrative')).toHaveTextContent(
      '内部检查'
    )
  })

  it('Command、Edit、External 和三个 Subagent 工具使用各自展示分支', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'cmd',
              name: 'bash',
              arguments: { command: 'pnpm test\necho done' }
            },
            {
              type: 'toolCall',
              id: 'edit',
              name: 'apply_patch',
              arguments: { path: '/workspace/project/src/app.tsx' }
            },
            { type: 'toolCall', id: 'external', name: 'custom_tool' },
            { type: 'toolCall', id: 'task', name: 'task' },
            { type: 'toolCall', id: 'subagent', name: 'subagent' },
            { type: 'toolCall', id: 'delegate', name: 'delegate' }
          ]
        }
      }
    ])
    const { container } = render(
      <Harness initial={projection} workspacePath="/workspace/project" />
    )

    expect(await screen.findByText('pnpm test')).toBeVisible()
    expect(screen.getByText('应用修改')).toBeVisible()
    expect(screen.getByText('src/app.tsx')).toBeVisible()
    expect(screen.getByText('custom_tool')).toBeVisible()
    expect(screen.getAllByText('子任务')).toHaveLength(3)
    expect(container.querySelectorAll('.tool-row-subagent')).toHaveLength(3)
  })

  it('失败结束时回答候选回到 Process，不留在回答区域', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'error',
          content: [{ type: 'text', text: '未完成的回答' }]
        }
      },
      { type: 'agent_end' }
    ])
    const { container } = render(<Harness initial={projection} />)

    expect(await screen.findByRole('button', { name: /失败/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByLabelText('完整执行过程')).toHaveTextContent(
      '未完成的回答'
    )
    expect(container.querySelector('.assistant-answer-candidate')).toBeNull()
    expect(container.querySelector('.assistant-final')).toBeEmptyDOMElement()
  })

  it('completed-incomplete 按完成显示，不显示诊断文案', async () => {
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          id: 'a1',
          role: 'assistant',
          stopReason: 'stop',
          content: [
            { type: 'toolCall', id: 't1', name: 'read' },
            { type: 'text', text: '可用回答' }
          ]
        }
      },
      { type: 'agent_end' }
    ])
    render(<Harness initial={projection} />)

    const summary = await screen.findByRole('button', { name: /已完成/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/记录不完整|状态未知/)).toBeNull()
    expect(screen.getByText('可用回答')).toBeVisible()
  })

  it('等待确认摘要隐藏工具数量和总时长', async () => {
    const deadline = Date.now() + 30_000
    const projection = projectionFrom([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'toolCall', id: 't1', name: 'bash' }]
        }
      }
    ])
    render(
      <Harness
        initial={projection}
        toolApprovals={[
          { id: 'approval-1', summary: '运行测试', status: 'pending', deadline }
        ]}
      />
    )

    const summary = await screen.findByRole('button', { name: /等待确认/ })
    expect(summary).toHaveTextContent(/等待确认 · \d+秒/)
    expect(summary).not.toHaveTextContent('次工具调用')
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
