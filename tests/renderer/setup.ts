import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

Object.defineProperty(globalThis, '__OMP_UI_FIXTURE__', {
  configurable: true,
  value: false
})

if (typeof window !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn().mockResolvedValue({ ok: true, data: null }),
      getWorkspaces: vi.fn().mockResolvedValue({
        ok: true,
        data: { workspaces: [], hasMore: false }
      }),
      activateWorkspace: vi.fn(),
      setWorkspacePinned: vi.fn(),
      removeWorkspace: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({
        ok: true,
        data: { sessions: [], hasMore: false, nextOffset: 0 }
      }),
      setSessionPinned: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      setSessionArchived: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      renameSession: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      deleteSession: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      getContextCandidates: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      cancelPendingModelSelection: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'ready', isStreaming: false, queuedMessageCount: 0 }
      }),
      cancelProviderLogin: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      followUp: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      getRuntimeState: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'stopped',
          isStreaming: false,
          queuedMessageCount: 0
        }
      }),
      getMessages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getLoginProviders: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getAvailableModels: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getProviderLoginState: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'idle' }
      }),
      loginProvider: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      newSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          snapshot: {
            status: 'ready',
            workspacePath: '/tmp/workspace',
            sessionId: 'new-session',
            isStreaming: true,
            queuedMessageCount: 0
          },
          session: {
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
            compatibility: 'v3',
            status: 'pending'
          }
        }
      }),
      onRuntimeEvent: vi.fn().mockReturnValue(vi.fn()),
      openExternal: vi.fn(),
      openRuntimeLog: vi.fn(),
      prompt: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      restartRuntime: vi.fn(),
      reopenProviderLoginUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, data: true }),
      respondExtensionUi: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      revealPath: vi.fn(),
      selectModel: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'ready', isStreaming: false, queuedMessageCount: 0 }
      }),
      setThinkingLevel: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      setApprovalMode: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'ready',
          isStreaming: false,
          queuedMessageCount: 0,
          approvalMode: 'write'
        }
      }),
      stopCurrentRun: vi.fn().mockResolvedValue({ ok: true, data: null }),
      switchSession: vi.fn(),
      log: vi.fn(),
      reportPerformance: vi.fn(),
      rendererReady: vi.fn()
    }
  })
}

afterEach(() => {
  cleanup()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
afterEach(() => vi.clearAllMocks())
