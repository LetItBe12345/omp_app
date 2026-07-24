import { isAbsolute, relative, resolve } from 'node:path'
import type { OmpEvent, ToolApprovalRequest } from '../shared/desktop-api'

const TOOL_LABELS: Record<string, string> = {
  bash: '命令',
  write: '写入',
  edit: '写入',
  ast_edit: '写入',
  browser: '浏览器',
  eval: '执行',
  debug: '调试'
}

export function isToolApprovalRequest(
  event: OmpEvent,
  runtimeVersion: string | undefined
): boolean {
  return (
    runtimeVersion === '17.0.6' &&
    event.type === 'extension_ui_request' &&
    event['method'] === 'select' &&
    Array.isArray(event['options']) &&
    event['options'].length === 2 &&
    event['options'][0] === 'Approve' &&
    event['options'][1] === 'Deny' &&
    typeof event['title'] === 'string' &&
    event['title'].split(/\r?\n/u)[0]?.startsWith('Allow tool: ') === true
  )
}

function displayPath(value: string, workspacePath: string): string {
  if (/^https?:\/\//iu.test(value)) return displayUrl(value)
  const absolute = isAbsolute(value) ? value : resolve(workspacePath, value)
  const local = relative(workspacePath, absolute)
  return local === '' || (!local.startsWith('..') && !isAbsolute(local))
    ? local || '.'
    : absolute
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}

function detail(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`
  return lines
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()
}

export function summarizeToolApproval(
  title: string,
  workspacePath: string
): string {
  const lines = title.split(/\r?\n/u)
  const tool = lines[0]?.slice('Allow tool: '.length).trim() || '未知工具'
  const label = TOOL_LABELS[tool] ?? tool

  const command = detail(lines, 'Command')
  if (command) {
    const cwd = detail(lines, 'Cwd') ?? detail(lines, 'Working directory')
    const cwdPrefix =
      cwd && displayPath(cwd, workspacePath) !== '.'
        ? `${displayPath(cwd, workspacePath)} · `
        : ''
    return `${label} · ${cwdPrefix}${command}`
  }

  const path = detail(lines, 'Path')
  if (path) return `${label} · ${displayPath(path, workspacePath)}`

  const paths = detail(lines, 'Paths')
  if (paths) {
    const entries = paths
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const first = entries[0]
    if (first) {
      return `${label} · ${displayPath(first, workspacePath)}${
        entries.length > 1 ? ` 等 ${entries.length} 个文件` : ''
      }`
    }
  }

  const url = detail(lines, 'URL')
  if (url) return `${label} · ${displayUrl(url)}`

  const action = detail(lines, 'Action')
  if (action) return `${label} · ${action}`

  const program = detail(lines, 'Program')
  if (program) return `${label} · ${displayPath(program, workspacePath)}`

  return label
}

export function approvalTimeoutMs(event: OmpEvent): number {
  const ompTimeout =
    typeof event['timeout'] === 'number' && event['timeout'] > 0
      ? event['timeout']
      : 30_000
  return Math.min(30_000, ompTimeout)
}

export function publicToolApproval(
  event: OmpEvent,
  workspacePath: string,
  deadline: number
): ToolApprovalRequest {
  return {
    id: String(event['id']),
    summary: summarizeToolApproval(String(event['title']), workspacePath),
    status: 'pending',
    deadline
  }
}
