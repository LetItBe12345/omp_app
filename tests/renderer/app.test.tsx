import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/app'

describe('App shell', () => {
  it('保持稳定的三栏语义结构', () => {
    const { container } = render(<App />)
    const slots = [...container.querySelectorAll('[data-slot]')].map(
      (element) => element.getAttribute('data-slot')
    )

    expect(slots).toMatchInlineSnapshot(`
      [
        "app-shell",
        "conversation-sidebar",
        "workspace-empty-state",
        "file-tree",
        "files-empty-state",
        "conversation-main",
        "conversation-empty-state",
      ]
    `)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('未实现的交互保持禁用并提供说明', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '新建对话' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '任务输入' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.getByText('此功能将在后续任务中提供')).toBeInTheDocument()
  })
})
