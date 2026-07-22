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
      openExternal: vi.fn(),
      log: vi.fn(),
      reportPerformance: vi.fn(),
      rendererReady: vi.fn()
    }
  })
}

afterEach(() => cleanup())
