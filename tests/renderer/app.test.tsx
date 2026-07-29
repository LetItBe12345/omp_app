import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('打开系统目录选择器期间立即显示等待状态', async () => {
    let finishSelection: ((value: { ok: true; data: null }) => void) | undefined
    vi.mocked(window.desktop.chooseWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finishSelection = resolve
      })
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Workspace' }))

    expect(
      screen.getByRole('button', { name: '正在打开目录选择器' })
    ).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在打开目录选择器…')

    finishSelection?.({ ok: true, data: null })
    await screen.findByRole('button', { name: '打开 Workspace' })
  })

  it('Runtime 启动完成前先显示新 Workspace', async () => {
    vi.mocked(window.desktop.getWorkspaces).mockResolvedValue({
      ok: true,
      data: {
        activeWorkspaceId: 'workspace-new',
        workspaces: [
          {
            id: 'workspace-new',
            path: '/tmp/new-workspace',
            name: 'new-workspace',
            available: true,
            pinned: false,
            addedAt: '2026-07-24T00:00:00.000Z',
            lastUsedAt: '2026-07-24T00:00:00.000Z'
          }
        ],
        hasMore: false
      }
    })
    vi.mocked(window.desktop.chooseWorkspace).mockResolvedValueOnce({
      ok: true,
      data: {
        workspace: {
          id: 'workspace-new',
          path: '/tmp/new-workspace',
          name: 'new-workspace',
          available: true,
          pinned: false,
          addedAt: '2026-07-24T00:00:00.000Z',
          lastUsedAt: '2026-07-24T00:00:00.000Z'
        },
        snapshot: {
          status: 'starting',
          workspacePath: '/tmp/new-workspace',
          isStreaming: false,
          queuedMessageCount: 0
        }
      }
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Workspace' }))

    expect(
      (await screen.findAllByText('new-workspace')).length
    ).toBeGreaterThan(0)
    expect(window.desktop.getRuntimeState).toHaveBeenCalledTimes(1)
  })

  it('Runtime 后台启动 ready 后刷新 Provider、模型和思考强度', async () => {
    let runtimeListener:
      Parameters<typeof window.desktop.onRuntimeEvent>[0] | undefined
    vi.mocked(window.desktop.onRuntimeEvent).mockImplementationOnce(
      (listener) => {
        runtimeListener = listener
        return vi.fn()
      }
    )
    vi.mocked(window.desktop.getAvailableModels).mockResolvedValueOnce({
      ok: true,
      data: [
        {
          provider: 'openai-codex',
          id: 'gpt-5.4-mini',
          name: 'GPT-5.4-Mini',
          reasoning: true,
          thinking: {
            efforts: ['low', 'medium', 'high', 'xhigh'],
            defaultLevel: 'medium'
          }
        }
      ]
    })
    vi.mocked(window.desktop.getLoginProviders).mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 'openai-codex',
          name: 'ChatGPT Plus/Pro',
          available: true,
          authenticated: true
        }
      ]
    })
    render(<App />)

    await waitFor(() => expect(runtimeListener).toBeDefined())
    act(() => {
      runtimeListener?.({
        type: 'snapshot',
        snapshot: {
          status: 'ready',
          workspacePath: '/tmp/workspace',
          model: 'openai-codex/gpt-5.4-mini',
          thinkingLevel: 'high',
          isStreaming: false,
          queuedMessageCount: 0
        }
      })
    })

    await waitFor(() =>
      expect(window.desktop.getAvailableModels).toHaveBeenCalledTimes(1)
    )
    expect(window.desktop.getLoginProviders).toHaveBeenCalledTimes(1)
    expect(window.desktop.getProviderLoginState).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('button', { name: '选择模型' })
    ).toHaveTextContent('GPT-5.4-Mini')
    expect(
      screen.getByRole('button', { name: '选择推理强度' })
    ).toHaveTextContent('高')
    expect(screen.getByRole('button', { name: '选择推理强度' })).toBeEnabled()
  })

  it('切换 Workspace 时立即移除旧 Session，成功后显示目标列表', async () => {
    const workspaces = [
      {
        id: 'workspace-a',
        path: '/tmp/workspace-a',
        name: 'workspace-a',
        available: true,
        pinned: false,
        addedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'workspace-b',
        path: '/tmp/workspace-b',
        name: 'workspace-b',
        available: true,
        pinned: false,
        addedAt: '2026-01-02T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    const session = (id: string, workspaceId: string, title: string) => ({
      id,
      workspaceId,
      path: `/tmp/${id}.jsonl`,
      title,
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
      size: 1,
      pinned: false,
      archived: false,
      compatibility: 'v3' as const,
      status: 'complete' as const
    })
    vi.mocked(window.desktop.getWorkspaces)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          activeWorkspaceId: 'workspace-a',
          workspaces,
          hasMore: false
        }
      })
      .mockResolvedValue({
        ok: true,
        data: {
          activeWorkspaceId: 'workspace-b',
          workspaces,
          hasMore: false
        }
      })
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace-a',
        sessionId: 'session-a',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    let finishTargetSessions:
      | ((
          value: Awaited<ReturnType<typeof window.desktop.listSessions>>
        ) => void)
      | undefined
    vi.mocked(window.desktop.listSessions).mockImplementation((workspaceId) => {
      if (workspaceId === 'workspace-a')
        return Promise.resolve({
          ok: true,
          data: {
            sessions: [session('session-a', workspaceId, '旧会话')],
            hasMore: false,
            nextOffset: 0
          }
        })
      return new Promise((resolve) => {
        finishTargetSessions = resolve
      })
    })
    vi.mocked(window.desktop.activateWorkspace).mockResolvedValue({
      ok: true,
      data: {
        status: 'starting',
        workspacePath: '/tmp/workspace-b',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    render(<App />)

    expect(await screen.findByText('旧会话')).toBeInTheDocument()
    const targetWorkspace = screen.getByRole('button', {
      name: 'workspace-b'
    })
    fireEvent.click(targetWorkspace)
    fireEvent.click(targetWorkspace)
    expect(window.desktop.activateWorkspace).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByText('旧会话')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(window.desktop.listSessions).toHaveBeenCalledWith(
        'workspace-b',
        0,
        ''
      )
    )

    finishTargetSessions?.({
      ok: true,
      data: {
        sessions: [session('session-b', 'workspace-b', '目标会话')],
        hasMore: false,
        nextOffset: 0
      }
    })
    expect(
      await screen.findByRole('button', { name: '目标会话' })
    ).toBeDisabled()
  })

  it('Session 切换成功后清除上一次失败提示', async () => {
    vi.mocked(window.desktop.getWorkspaces).mockResolvedValue({
      ok: true,
      data: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            path: '/tmp/workspace',
            name: 'workspace',
            available: true,
            pinned: false,
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        hasMore: false
      }
    })
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    vi.mocked(window.desktop.listSessions).mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          {
            id: 'session-2',
            workspaceId: 'workspace-1',
            path: '/tmp/session-2.jsonl',
            title: '第二个会话',
            createdAt: '2026-01-01T00:00:00.000Z',
            modifiedAt: '2026-01-01T00:00:00.000Z',
            messageCount: 1,
            size: 1,
            pinned: false,
            archived: false,
            compatibility: 'v3',
            status: 'complete'
          }
        ],
        hasMore: false,
        nextOffset: 0
      }
    })
    vi.mocked(window.desktop.switchSession)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session 不存在',
          retryable: false
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'ready',
          workspacePath: '/tmp/workspace',
          sessionId: 'session-2',
          isStreaming: false,
          queuedMessageCount: 0
        }
      })
    render(<App />)

    const sessionButton = await screen.findByRole('button', {
      name: '第二个会话'
    })
    fireEvent.click(sessionButton)
    expect(await screen.findByText('Session 不存在')).toBeInTheDocument()
    fireEvent.click(sessionButton)
    await waitFor(() =>
      expect(screen.queryByText('Session 不存在')).not.toBeInTheDocument()
    )
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
        message: '补充测试',
        references: []
      })
    )

    const nextComposer = screen.getByRole('textbox', { name: '任务输入' })
    await waitFor(() => expect(nextComposer).toBeEnabled())
    fireEvent.change(nextComposer, { target: { value: '/compact' } })
    fireEvent.keyDown(nextComposer, { key: 'Enter' })
    expect(window.desktop.followUp).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText('任务结束后可执行 Slash Command')
    ).toBeInTheDocument()
  })

  it('Slash 菜单支持上下键切换并按当前选中项发送', async () => {
    let runtimeListener:
      Parameters<typeof window.desktop.onRuntimeEvent>[0] | undefined
    vi.mocked(window.desktop.onRuntimeEvent).mockImplementationOnce(
      (listener) => {
        runtimeListener = listener
        return vi.fn()
      }
    )
    vi.mocked(window.desktop.getAvailableCommands).mockResolvedValue({
      ok: true,
      data: [
        { name: 'alpha', source: 'builtin' },
        { name: 'beta', source: 'builtin' }
      ]
    })
    render(<App />)

    await waitFor(() => expect(runtimeListener).toBeDefined())
    act(() => {
      runtimeListener?.({
        type: 'snapshot',
        snapshot: {
          status: 'ready',
          workspacePath: '/tmp/workspace',
          sessionId: 'session-1',
          isStreaming: false,
          queuedMessageCount: 0
        }
      })
    })
    await waitFor(() =>
      expect(window.desktop.getAvailableCommands).toHaveBeenCalledTimes(1)
    )

    const composer = await screen.findByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '/' } })
    ;(composer as HTMLTextAreaElement).setSelectionRange(1, 1)
    fireEvent.select(composer)

    let options = await screen.findAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    await waitFor(() => {
      options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'false')
      expect(options[1]).toHaveAttribute('aria-selected', 'true')
    })

    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() =>
      expect(window.desktop.prompt).toHaveBeenCalledWith({
        message: '/beta',
        references: []
      })
    )
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

  it('Prompt 请求返回前禁止重复提交同一输入', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    let finishPrompt:
      ((value: { ok: true; data: undefined }) => void) | undefined
    vi.mocked(window.desktop.prompt).mockReturnValue(
      new Promise((resolve) => {
        finishPrompt = resolve
      })
    )
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '只发送一次' } })
    const sendButton = screen.getByRole('button', { name: '发送' })

    fireEvent.click(sendButton)
    const pendingSendButton = screen.getByRole('button', { name: '发送' })
    await waitFor(() => expect(pendingSendButton).toBeDisabled())
    fireEvent.click(pendingSendButton)
    expect(window.desktop.prompt).toHaveBeenCalledTimes(1)
    finishPrompt?.({ ok: true, data: undefined })
  })

  it('中文输入法组合和候选确认期间 Enter 不发送任务', async () => {
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValue({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '中文输入' } })

    fireEvent.compositionStart(composer)
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
    expect(window.desktop.prompt).not.toHaveBeenCalled()

    fireEvent.compositionEnd(composer)
    fireEvent.keyDown(composer, { key: 'Enter', keyCode: 229 })
    expect(window.desktop.prompt).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', keyCode: 13 })
    await waitFor(() =>
      expect(window.desktop.prompt).toHaveBeenCalledWith({
        message: '中文输入',
        references: []
      })
    )
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

  it('新建按钮先打开临时输入，首条发送时才创建真实 Session', async () => {
    const createdSession = {
      id: 'new-session',
      workspaceId: 'workspace-1',
      path: '/tmp/new-session.jsonl',
      title: '第一条消息',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
      size: 1,
      pinned: false,
      archived: false,
      compatibility: 'v3' as const,
      status: 'pending' as const
    }
    vi.mocked(window.desktop.getWorkspaces).mockResolvedValueOnce({
      ok: true,
      data: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            path: '/tmp/workspace',
            name: 'workspace',
            available: true,
            pinned: false,
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        hasMore: false
      }
    })
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'session-1',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    vi.mocked(window.desktop.listSessions).mockImplementation(async () => ({
      ok: true,
      data: {
        sessions:
          vi.mocked(window.desktop.createSession).mock.calls.length > 0
            ? [createdSession]
            : [],
        hasMore: false,
        nextOffset: 0
      }
    }))
    render(<App />)

    const newButton = await screen.findByRole('button', { name: '新建对话' })
    await waitFor(() => expect(newButton).toBeEnabled())
    fireEvent.click(newButton)
    expect(window.desktop.newSession).not.toHaveBeenCalled()

    const composer = screen.getByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '第一条消息' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() =>
      expect(window.desktop.createSession).toHaveBeenCalledWith(
        { message: '第一条消息', references: [] },
        '第一条消息',
        'yolo'
      )
    )
    expect(
      await screen.findByText('第一条消息', {
        selector: '[data-role="user"] *'
      })
    ).toBeInTheDocument()
  })

  it('临时新会话忽略旧会话迟到的历史和 Runtime 快照，显式切回后才恢复', async () => {
    let runtimeListener:
      Parameters<typeof window.desktop.onRuntimeEvent>[0] | undefined
    vi.mocked(window.desktop.onRuntimeEvent).mockImplementationOnce(
      (listener) => {
        runtimeListener = listener
        return vi.fn()
      }
    )
    vi.mocked(window.desktop.getWorkspaces).mockResolvedValueOnce({
      ok: true,
      data: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            path: '/tmp/workspace',
            name: 'workspace',
            available: true,
            pinned: false,
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        hasMore: false
      }
    })
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'old-session',
        sessionName: '旧会话',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    vi.mocked(window.desktop.listSessions).mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          {
            id: 'old-session',
            workspaceId: 'workspace-1',
            path: '/tmp/old-session.jsonl',
            title: '旧会话',
            createdAt: '2026-01-01T00:00:00.000Z',
            modifiedAt: '2026-01-01T00:00:00.000Z',
            messageCount: 1,
            size: 1,
            pinned: false,
            archived: false,
            compatibility: 'v3',
            status: 'complete'
          }
        ],
        hasMore: false,
        nextOffset: 0
      }
    })
    const oldHistory = [
      {
        role: 'user',
        content: [{ type: 'text', text: '旧会话内容' }]
      }
    ]
    let finishOldHistory:
      | ((
          value: Awaited<ReturnType<typeof window.desktop.getMessages>>
        ) => void)
      | undefined
    vi.mocked(window.desktop.getMessages)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOldHistory = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true, data: oldHistory })
    vi.mocked(window.desktop.switchSession).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'old-session',
        sessionName: '旧会话',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    render(<App />)

    const oldSessionButton = await screen.findByRole('button', {
      name: '旧会话'
    })
    await waitFor(() => expect(window.desktop.getMessages).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))

    expect(oldSessionButton).not.toHaveClass('bg-[var(--surface-selected)]')
    expect(screen.getByText('开始处理本地项目')).toBeInTheDocument()
    act(() => {
      runtimeListener?.({
        type: 'snapshot',
        snapshot: {
          status: 'ready',
          workspacePath: '/tmp/workspace',
          sessionId: 'old-session',
          sessionName: '旧会话',
          isStreaming: false,
          queuedMessageCount: 0
        }
      })
      runtimeListener?.({
        type: 'omp-event-batch',
        events: [
          { type: 'agent_start' },
          {
            type: 'message_end',
            message: {
              id: 'late-assistant',
              role: 'assistant',
              content: [{ type: 'text', text: '迟到的实时回复' }]
            }
          },
          { type: 'agent_end' }
        ]
      })
    })
    finishOldHistory?.({ ok: true, data: oldHistory })

    await waitFor(() =>
      expect(screen.queryByText('旧会话内容')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('迟到的实时回复')).not.toBeInTheDocument()
    expect(screen.getByText('开始处理本地项目')).toBeInTheDocument()
    expect(window.desktop.getMessages).toHaveBeenCalledTimes(1)

    fireEvent.click(oldSessionButton)
    await waitFor(() =>
      expect(window.desktop.switchSession).toHaveBeenCalledWith('old-session')
    )
    expect(await screen.findByText('旧会话内容')).toBeInTheDocument()
    expect(window.desktop.getMessages).toHaveBeenCalledTimes(2)
  })

  it('新 Session 创建请求返回前立即显示用户首条消息', async () => {
    vi.mocked(window.desktop.getWorkspaces).mockResolvedValueOnce({
      ok: true,
      data: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            path: '/tmp/workspace',
            name: 'workspace',
            available: true,
            pinned: false,
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        hasMore: false
      }
    })
    vi.mocked(window.desktop.getRuntimeState).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'ready',
        workspacePath: '/tmp/workspace',
        sessionId: 'old-session',
        isStreaming: false,
        queuedMessageCount: 0
      }
    })
    vi.mocked(window.desktop.createSession).mockReturnValueOnce(
      new Promise(() => undefined)
    )
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '新建对话' }))
    const composer = screen.getByRole('textbox', { name: '任务输入' })
    fireEvent.change(composer, { target: { value: '面试会问什么' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('面试会问什么')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '任务输入' })).toHaveValue('')
  })
})
