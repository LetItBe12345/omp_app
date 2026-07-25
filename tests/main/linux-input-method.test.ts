// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { configureLinuxInputMethod } from '../../src/main/linux-input-method'

describe('configureLinuxInputMethod', () => {
  it('Linux Wayland 启用原生 IME 和 text-input-v3', () => {
    const appendSwitch = vi.fn()

    configureLinuxInputMethod({ appendSwitch }, 'linux', 'wayland')

    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'enable-wayland-ime')
    expect(appendSwitch).toHaveBeenNthCalledWith(
      2,
      'wayland-text-input-version',
      '3'
    )
  })

  it('X11 和非 Linux 平台不追加 Wayland 参数', () => {
    const appendSwitch = vi.fn()

    configureLinuxInputMethod({ appendSwitch }, 'linux', 'x11')
    configureLinuxInputMethod({ appendSwitch }, 'darwin', 'wayland')

    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
