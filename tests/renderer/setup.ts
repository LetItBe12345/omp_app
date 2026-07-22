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
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn().mockResolvedValue({ ok: true, data: null }),
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
      newSession: vi.fn(),
      onRuntimeEvent: vi.fn().mockReturnValue(vi.fn()),
      openExternal: vi.fn(),
      openRuntimeLog: vi.fn(),
      prompt: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      restartRuntime: vi.fn(),
      respondExtensionUi: vi.fn(),
      revealPath: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
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
