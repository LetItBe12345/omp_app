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
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn().mockResolvedValue({ ok: true, data: null }),
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
      stopCurrentRun: vi.fn().mockResolvedValue({ ok: true, data: null }),
      switchSession: vi.fn(),
      log: vi.fn(),
      reportPerformance: vi.fn(),
      rendererReady: vi.fn()
    }
  })
}

afterEach(() => cleanup())
afterEach(() => vi.clearAllMocks())
