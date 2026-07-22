import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/desktop-api'
import type { RuntimeSupervisor } from '../../src/main/runtime-supervisor'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    on: (channel: string, listener: (...args: unknown[]) => unknown) =>
      electron.listeners.set(channel, listener),
    off: (channel: string) => electron.listeners.delete(channel),
    removeHandler: (channel: string) => {
      electron.removeHandler(channel)
      electron.handlers.delete(channel)
    }
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

describe('registerRuntimeIpc', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.listeners.clear()
    electron.removeHandler.mockClear()
    electron.send.mockClear()
  })

  it('Renderer 重载后重放尚未回答的 Extension UI 请求', async () => {
    const { registerRuntimeIpc } = await import('../../src/main/runtime-ipc')
    const emitter = new EventEmitter()
    const supervisor = Object.assign(emitter, {
      diagnosticsPath: '/tmp/runtime.log',
      sendFrame: vi.fn(),
      snapshot: {
        status: 'ready',
        isStreaming: false,
        queuedMessageCount: 0
      }
    }) as unknown as RuntimeSupervisor
    const webContents = {
      isDestroyed: () => false,
      send: electron.send
    }
    const cleanup = registerRuntimeIpc(
      supervisor,
      () => ({ isDestroyed: () => false, webContents }) as never
    )
    const request = {
      type: 'extension_ui_request',
      id: 'ui-1',
      method: 'confirm',
      title: '确认',
      message: '继续吗？'
    }

    emitter.emit('event', request)
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
      type: 'omp-event',
      event: request
    })

    electron.send.mockClear()
    electron.listeners.get(IPC_CHANNELS.rendererReady)?.()
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.event, {
      type: 'omp-event',
      event: request
    })

    cleanup()
  })
})
