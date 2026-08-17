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
      copyText: vi.fn().mockResolvedValue(true),
      chooseWorkspace: vi.fn().mockResolvedValue({ ok: true, data: null }),
      getWorkspaces: vi.fn().mockResolvedValue({
        ok: true,
        data: { workspaces: [], hasMore: false }
      }),
      activateWorkspace: vi.fn(),
      setWorkspacePinned: vi.fn(),
      removeWorkspace: vi.fn(),
      listWorkspaceEntries: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          entries: [],
          total: 0,
          offset: 0,
          limit: 100,
          revision: 1,
          workspaceVersion: 1,
          hasMore: false
        }
      }),
      searchWorkspaceEntries: vi.fn().mockResolvedValue({
        ok: true,
        data: { entries: [], truncated: false, workspaceVersion: 1 }
      }),
      watchWorkspaceDirectories: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceId: 'workspace',
          workspaceVersion: 1,
          watchedDirectories: 1,
          limited: false
        }
      }),
      refreshWorkspaceDirectories: vi.fn().mockResolvedValue({
        ok: true,
        data: { workspaceVersion: 1, revisions: {} }
      }),
      onWorkspaceFilesEvent: vi.fn().mockReturnValue(vi.fn()),
      openWorkspaceEntry: vi.fn().mockResolvedValue({ ok: true, data: true }),
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
      resolveDroppedFiles: vi.fn().mockResolvedValue({
        ok: true,
        data: { references: [], rejectedCount: 0 }
      }),
      resolveWorkspaceReferences: vi
        .fn()
        .mockImplementation(async (_workspaceId, references) => ({
          ok: true,
          data: { references, rejectedCount: 0 }
        })),
      cancelPendingModelSelection: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'ready', isStreaming: false, queuedMessageCount: 0 }
      }),
      cancelProviderLogin: vi
        .fn()
        .mockResolvedValue({ ok: true, data: undefined }),
      followUp: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      getAvailableCommands: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getRuntimeState: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'stopped',
          isStreaming: false,
          queuedMessageCount: 0
        }
      }),
      getRuntimeNetwork: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          config: { mode: 'auto' },
          source: 'login-shell',
          result: 'direct'
        }
      }),
      applyRuntimeNetwork: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          config: { mode: 'auto' },
          source: 'login-shell',
          result: 'direct'
        }
      }),
      detectRuntimeProxy: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          config: { mode: 'auto' },
          source: 'login-shell',
          result: 'direct'
        }
      }),
      checkRuntimeProxyPort: vi
        .fn()
        .mockResolvedValue({ ok: true, data: true }),
      getRuntimeEnvironmentDiagnostic: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          shell: '/bin/bash',
          path: '/usr/bin',
          source: 'login-shell',
          tools: [],
          network: {
            config: { mode: 'auto' },
            source: 'login-shell',
            result: 'direct'
          },
          copyText: 'Shell: /bin/bash'
        }
      }),
      getMessages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getSessionMessages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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
          temporarySessionId: 'temporary-new-session'
        }
      }),
      cancelQueuedSession: vi.fn().mockResolvedValue({
        ok: true,
        data: { message: '已取消' }
      }),
      selectTemporarySession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'ready',
          workspacePath: '/tmp/workspace',
          isStreaming: false,
          queuedMessageCount: 0
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
      validateLocalPath: vi.fn().mockResolvedValue(false),
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
