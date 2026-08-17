import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  RuntimeSnapshot,
  SessionRuntimeState,
  SessionSummary,
  WorkspaceOverview
} from '../../src/shared/desktop-api'
import { WorkspaceSidebar } from '../../src/renderer/workspace-sidebar'

const runtime: RuntimeSnapshot = {
  status: 'ready',
  workspacePath: '/home/jin/projects/example',
  sessionId: 'session-active',
  isStreaming: false,
  queuedMessageCount: 0
}

const overview: WorkspaceOverview = {
  activeWorkspaceId: 'workspace',
  workspaces: [
    {
      id: 'workspace',
      path: '/home/jin/projects/example',
      name: 'example',
      available: true,
      pinned: false,
      addedAt: '2026-07-25T00:00:00.000Z',
      lastUsedAt: '2026-07-25T00:00:00.000Z'
    }
  ],
  hasMore: false
}

const sessions: SessionSummary[] = [
  {
    id: 'session-active',
    workspaceId: 'workspace',
    path: '/home/jin/.omp/sessions/session-active.jsonl',
    title: '当前会话',
    createdAt: '2026-07-25T00:00:00.000Z',
    modifiedAt: '2026-07-25T00:00:00.000Z',
    messageCount: 1,
    size: 1,
    pinned: false,
    archived: false,
    compatibility: 'v3',
    status: 'complete'
  }
]

function renderSidebar(
  onRenameSession = vi.fn(),
  sessionRuntimeStates: Record<string, SessionRuntimeState> = {},
  sessionItems = sessions,
  workspaceOverview = overview
): ReturnType<typeof render> {
  return render(
    <WorkspaceSidebar
      archivedExpanded={false}
      error={null}
      hasMoreSessions={false}
      onActivateWorkspace={vi.fn()}
      onArchiveSession={vi.fn()}
      onArchivedExpanded={vi.fn()}
      onDeleteSession={vi.fn()}
      onLoadMoreSessions={vi.fn()}
      onLoadMoreWorkspaces={vi.fn()}
      onNewSession={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onPinSession={vi.fn()}
      onPinWorkspace={vi.fn()}
      onRenameSession={onRenameSession}
      onSearch={vi.fn()}
      onSwitchSession={vi.fn()}
      openingWorkspace={false}
      switchingWorkspace={false}
      overview={workspaceOverview}
      runtime={runtime}
      search=""
      sessionRuntimeStates={sessionRuntimeStates}
      sessions={sessionItems}
    />
  )
}

describe('WorkspaceSidebar', () => {
  it('当前 Session 归入会话组，并为 Workspace 显示绝对路径提示', () => {
    renderSidebar()

    expect(screen.queryByText('正在运行')).not.toBeInTheDocument()
    expect(screen.getByText('会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /example/ })).toHaveAttribute(
      'title',
      '/home/jin/projects/example'
    )
    expect(screen.getByText('/home/jin/projects/example')).toBeInTheDocument()
  })

  it('使用行内输入框重命名，Enter 保存、Esc 和失焦取消', () => {
    const onRenameSession = vi.fn()
    renderSidebar(onRenameSession)

    fireEvent.contextMenu(screen.getByRole('button', { name: /当前会话/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByRole('textbox', { name: '重命名 当前会话' })
    fireEvent.change(input, { target: { value: '新的名称' } })
    fireEvent.submit(input.closest('form')!)
    expect(onRenameSession).toHaveBeenCalledWith('session-active', '新的名称')

    fireEvent.contextMenu(screen.getByRole('button', { name: /当前会话/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: '重命名 当前会话' }),
      { key: 'Escape' }
    )
    expect(
      screen.queryByRole('textbox', { name: '重命名 当前会话' })
    ).not.toBeInTheDocument()
    expect(onRenameSession).toHaveBeenCalledTimes(1)

    fireEvent.contextMenu(screen.getByRole('button', { name: /当前会话/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const blurred = screen.getByRole('textbox', { name: '重命名 当前会话' })
    fireEvent.change(blurred, { target: { value: '不应保存' } })
    fireEvent.blur(blurred)
    expect(
      screen.queryByRole('textbox', { name: '重命名 当前会话' })
    ).not.toBeInTheDocument()
    expect(onRenameSession).toHaveBeenCalledTimes(1)
  })

  it('Session 和 Workspace 的等待交互状态优先于未查看蓝点', () => {
    const state: SessionRuntimeState = {
      runtimeInstanceId: 'runtime-1',
      generation: 1,
      workspacePath: '/home/jin/projects/example',
      sessionId: 'session-active',
      phase: 'waiting-interaction',
      snapshot: runtime
    }
    renderSidebar(
      vi.fn(),
      { 'session-active': state },
      [{ ...sessions[0]!, unreadCompletion: true }],
      {
        ...overview,
        workspaces: [{ ...overview.workspaces[0]!, unreadCompletion: true }]
      }
    )

    expect(screen.getByLabelText('等待操作')).toBeInTheDocument()
    expect(screen.getByLabelText('有会话等待操作')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('运行已完成，尚未查看')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('有未查看的已完成会话')
    ).not.toBeInTheDocument()
  })

  it('会话行使用图标区分排队和执行，不写状态文字', () => {
    const baseState = {
      runtimeInstanceId: 'runtime-1',
      generation: 1,
      workspacePath: '/home/jin/projects/example',
      sessionId: 'session-active',
      snapshot: runtime
    }
    const rendered = renderSidebar(vi.fn(), {
      'session-active': { ...baseState, phase: 'queued' }
    })
    expect(screen.getByLabelText('等待开始')).toBeInTheDocument()
    expect(screen.queryByText('等待')).not.toBeInTheDocument()

    rendered.rerender(
      <WorkspaceSidebar
        archivedExpanded={false}
        error={null}
        hasMoreSessions={false}
        onActivateWorkspace={vi.fn()}
        onArchiveSession={vi.fn()}
        onArchivedExpanded={vi.fn()}
        onDeleteSession={vi.fn()}
        onLoadMoreSessions={vi.fn()}
        onLoadMoreWorkspaces={vi.fn()}
        onNewSession={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onPinSession={vi.fn()}
        onPinWorkspace={vi.fn()}
        onRenameSession={vi.fn()}
        onSearch={vi.fn()}
        onStopSession={vi.fn()}
        onSwitchSession={vi.fn()}
        openingWorkspace={false}
        overview={overview}
        runtime={runtime}
        search=""
        sessionRuntimeStates={{
          'session-active': { ...baseState, phase: 'running' }
        }}
        sessions={sessions}
        switchingWorkspace={false}
      />
    )
    expect(screen.getByLabelText('正在执行')).toBeInTheDocument()
  })

  it('会话运行失败时显示红色失败图标', () => {
    renderSidebar(vi.fn(), {
      'session-active': {
        runtimeInstanceId: 'runtime-1',
        generation: 1,
        workspacePath: '/home/jin/projects/example',
        sessionId: 'session-active',
        phase: 'failed',
        snapshot: runtime
      }
    })

    expect(screen.getByLabelText('运行失败')).toHaveClass('text-red-600')
  })
})
