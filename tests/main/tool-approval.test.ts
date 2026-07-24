// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  approvalTimeoutMs,
  isToolApprovalRequest,
  summarizeToolApproval
} from '../../src/main/tool-approval'

describe('tool approval adapter', () => {
  const request = {
    type: 'extension_ui_request',
    id: 'approval-1',
    method: 'select',
    title: 'Allow tool: write\nPath: /workspace/src/app.ts\nContent:\nsecret',
    options: ['Approve', 'Deny']
  }

  it('只在 v17.0.6 三项精确匹配时启用', () => {
    expect(isToolApprovalRequest(request, '17.0.6')).toBe(true)
    expect(isToolApprovalRequest(request, '17.0.7')).toBe(false)
    expect(
      isToolApprovalRequest(
        { ...request, options: ['Deny', 'Approve'] },
        '17.0.6'
      )
    ).toBe(false)
    expect(
      isToolApprovalRequest(
        { ...request, title: 'Please allow tool: write' },
        '17.0.6'
      )
    ).toBe(false)
  })

  it('摘要排除写入 Content，并处理路径、URL、命令和多文件', () => {
    expect(summarizeToolApproval(request.title, '/workspace')).toBe(
      '写入 · src/app.ts'
    )
    expect(
      summarizeToolApproval(
        'Allow tool: browser\nAction: open\nURL: https://user@example.com/docs?q=secret',
        '/workspace'
      )
    ).toBe('浏览器 · example.com/docs')
    expect(
      summarizeToolApproval(
        'Allow tool: bash\nCommand: pnpm test\nCwd: /workspace/packages/app',
        '/workspace'
      )
    ).toBe('命令 · packages/app · pnpm test')
    expect(
      summarizeToolApproval(
        'Allow tool: ast_edit\nPaths: /workspace/a.ts, /tmp/b.ts',
        '/workspace'
      )
    ).toBe('写入 · a.ts 等 2 个文件')
    expect(summarizeToolApproval(request.title, '/workspace')).not.toContain(
      'secret'
    )
  })

  it('默认 30 秒且只采用更短的 OMP 超时', () => {
    expect(approvalTimeoutMs(request)).toBe(30_000)
    expect(approvalTimeoutMs({ ...request, timeout: 5_000 })).toBe(5_000)
    expect(approvalTimeoutMs({ ...request, timeout: 60_000 })).toBe(30_000)
  })
})
