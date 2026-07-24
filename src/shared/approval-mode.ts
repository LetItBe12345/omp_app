import type { ApprovalMode } from './desktop-api'

export const APPROVAL_MODES = [
  'always-ask',
  'write',
  'yolo'
] as const satisfies readonly ApprovalMode[]

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  'always-ask': '严格',
  write: '标准',
  yolo: '全部允许'
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return APPROVAL_MODES.some((mode) => mode === value)
}
