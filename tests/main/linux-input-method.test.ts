// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { configureLinuxInputMethod } from '../../src/main/linux-input-method'

describe('configureLinuxInputMethod', () => {
  it('Linux Wayland 启用原生 IME 和 text-input-v3', () => {
    const appendSwitch = vi.fn()

    const environment = { GTK_IM_MODULE: 'ibus' }
    const backend = configureLinuxInputMethod(
      { appendSwitch },
      'linux',
      'wayland',
      environment
    )

    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'enable-wayland-ime')
    expect(appendSwitch).toHaveBeenNthCalledWith(
      2,
      'wayland-text-input-version',
      '3'
    )
    expect(backend).toBe('wayland')
    expect(environment['GTK_IM_MODULE']).toBe('ibus')
  })

  it('Linux X11 的 GTK IBus 切换到可用的 XIM 桥接', () => {
    const appendSwitch = vi.fn()
    const environment = {
      GTK_IM_MODULE: 'ibus',
      XMODIFIERS: '@im=ibus'
    }

    const backend = configureLinuxInputMethod(
      { appendSwitch },
      'linux',
      'x11',
      environment
    )

    expect(backend).toBe('xim')
    expect(environment['GTK_IM_MODULE']).toBe('xim')
    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('不覆盖 X11 的其他输入法或非 Linux 平台', () => {
    const appendSwitch = vi.fn()
    const fcitxEnvironment = { GTK_IM_MODULE: 'fcitx' }
    const macEnvironment = { GTK_IM_MODULE: 'ibus' }

    expect(
      configureLinuxInputMethod(
        { appendSwitch },
        'linux',
        'x11',
        fcitxEnvironment
      )
    ).toBe('unchanged')
    expect(
      configureLinuxInputMethod(
        { appendSwitch },
        'darwin',
        'x11',
        macEnvironment
      )
    ).toBe('unchanged')
    expect(fcitxEnvironment['GTK_IM_MODULE']).toBe('fcitx')
    expect(macEnvironment['GTK_IM_MODULE']).toBe('ibus')
    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
