import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/app'

describe('App shell', () => {
  it('保持稳定的三栏语义结构', () => {
    const { container } = render(<App />)
    const slots = [...container.querySelectorAll('[data-slot]')].map(
      (element) => element.getAttribute('data-slot')
    )

    expect(slots).toMatchInlineSnapshot(`
      [
        "app-shell",
        "conversation-sidebar",
        "workspace-empty-state",
        "file-tree",
        "files-empty-state",
        "conversation-main",
        "conversation-empty-state",
      ]
    `)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('未实现的交互保持禁用并提供说明', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '新建对话' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '任务输入' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.getByText('请先打开 Workspace')).toBeInTheDocument()
  })

  it('运行中使用 Stop 按钮和 Ctrl+C 停止同一任务', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: true,
        queuedMessageCount: 0
      }
    })
    render(<App />)

    await screen.findByRole('button', { name: '停止' })
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    await waitFor(() =>
      expect(window.desktop.stopCurrentRun).toHaveBeenCalledTimes(1)
    )
  })

  it('运行中将 Enter 输入发送为 Follow-up，并拒绝 Slash Command', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: true,
        queuedMessageCount: 0
      }
    })
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: '任务输入' })

    fireEvent.change(composer, { target: { value: '补充测试' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() =>
      expect(window.desktop.followUp).toHaveBeenCalledWith({
        message: '补充测试'
      })
    )

    fireEvent.change(composer, { target: { value: '/compact' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(window.desktop.followUp).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText('任务结束后可执行 Slash Command')
    ).toBeInTheDocument()
  })

  it('存在文本选择时 Ctrl+C 保持复制且不触发 Stop', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: true,
        queuedMessageCount: 0
      }
    })
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '需要复制' } })
    ;(composer as HTMLTextAreaElement).setSelectionRange(0, 2)
    composer.focus()

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    expect(window.desktop.stopCurrentRun).not.toHaveBeenCalled()
  })

  it('点击 Stop 后立即禁用重复操作', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: true,
        queuedMessageCount: 0
      }
    })
    let finishStop: ((value: { ok: true; data: null }) => void) | undefined
    vi.mocked(window.desktop.stopCurrentRun).mockReturnValue(
      new Promise((resolve) => {
        finishStop = resolve
      })
    )
    render(<App />)
    const stopButton = await screen.findByRole('button', { name: '停止' })

    fireEvent.click(stopButton)
    await waitFor(() => expect(stopButton).toBeDisabled())
    fireEvent.click(stopButton)
    expect(window.desktop.stopCurrentRun).toHaveBeenCalledTimes(1)
    finishStop?.({ ok: true, data: null })
  })

  it('当前模型从可用目录消失时阻止发送并打开模型选择器', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: false,
        queuedMessageCount: 0,
        model: 'missing/model'
      }
    })
    vi.mocked(window.desktop.getAvailableModels).mockResolvedValueOnce({
      ok: true,
      data: [
        {
          provider: 'test',
          id: 'fake-model',
          name: 'Fake Model',
          reasoning: false
        }
      ]
    })
    render(<App />)

    expect(
      await screen.findByText('当前模型不可用，请重新选择模型')
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '任务输入' })).toBeDisabled()
    expect(
      screen.getByRole('combobox', { name: '模型选择器' })
    ).toBeInTheDocument()
  })
})
