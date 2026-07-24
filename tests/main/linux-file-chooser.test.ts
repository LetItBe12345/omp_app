import { describe, expect, it, vi } from 'vitest'
import { configureLinuxFileChooser } from '../../src/main/linux-file-chooser'

describe('configureLinuxFileChooser', () => {
  it('Linux 在 portal v4 以下退回 GTK 或 KDE 选择器', () => {
    const appendSwitch = vi.fn()

    configureLinuxFileChooser({ appendSwitch }, 'linux')

    expect(appendSwitch).toHaveBeenCalledWith(
      'xdg-portal-required-version',
      '4'
    )
  })

  it('非 Linux 不修改文件选择器', () => {
    const appendSwitch = vi.fn()

    configureLinuxFileChooser({ appendSwitch }, 'darwin')

    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
