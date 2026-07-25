import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  Network,
  RotateCcw,
  X
} from 'lucide-react'
import { useState } from 'react'
import type {
  RuntimeEnvironmentDiagnostic,
  RuntimeNetworkConfig,
  RuntimeNetworkMode,
  RuntimeNetworkStatus,
  RuntimeSnapshot
} from '../shared/desktop-api'

const labels: Record<RuntimeNetworkMode, string> = {
  off: '关闭',
  auto: '自动',
  manual: '手动'
}

export function RuntimeNetworkControl({
  runtime,
  loginActive,
  onSnapshot
}: {
  runtime: RuntimeSnapshot
  loginActive: boolean
  onSnapshot: (snapshot: RuntimeSnapshot) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RuntimeNetworkStatus | null>(null)
  const [draft, setDraft] = useState<RuntimeNetworkConfig>({ mode: 'auto' })
  const [panel, setPanel] = useState<'modes' | 'manual'>('modes')
  const [portText, setPortText] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] =
    useState<RuntimeEnvironmentDiagnostic | null>(null)
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const busy =
    runtime.isStreaming ||
    runtime.queuedMessageCount > 0 ||
    runtime.isAuthenticating ||
    loginActive

  const load = async (): Promise<void> => {
    setMessage(null)
    const result = await window.desktop.getRuntimeNetwork()
    if (!result.ok) {
      setMessage(result.error.message)
      return
    }
    setStatus(result.data)
    setDraft(result.data.config)
    setPortText(result.data.config.manualPort?.toString() ?? '')
    setPanel('modes')
  }

  const setOpenState = (next: boolean): void => {
    setOpen(next)
    if (next) void load()
    else {
      setPanel('modes')
      setMessage(null)
    }
  }

  const apply = async (config: RuntimeNetworkConfig): Promise<void> => {
    setWorking(true)
    setMessage(null)
    const result = await window.desktop.applyRuntimeNetwork(config)
    setWorking(false)
    if (!result.ok) {
      setMessage(result.error.message)
      return
    }
    setStatus(result.data)
    setOpen(false)
    const snapshot = await window.desktop.getRuntimeState()
    if (snapshot.ok) onSnapshot(snapshot.data)
  }

  const applyManual = (): void => {
    if (!/^\d{1,5}$/u.test(portText)) {
      setMessage('端口必须是 1–65535 的整数')
      return
    }
    const port = Number(portText)
    if (port < 1 || port > 65_535) {
      setMessage('端口必须是 1–65535 的整数')
      return
    }
    void apply({ mode: 'manual', manualPort: port })
  }

  const detectPort = async (): Promise<void> => {
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setMessage('端口必须是 1–65535 的整数')
      return
    }
    setWorking(true)
    const result = await window.desktop.checkRuntimeProxyPort(port)
    setWorking(false)
    setMessage(
      result.ok
        ? result.data
          ? '本地端口可以连接'
          : '本地端口当前不可连接；仍可保存'
        : result.error.message
    )
  }

  const detect = async (): Promise<void> => {
    setWorking(true)
    setMessage(null)
    const result = await window.desktop.detectRuntimeProxy()
    setWorking(false)
    if (result.ok) {
      setStatus(result.data)
      setMessage(result.data.error ?? '已重新检测 Login Shell')
      const snapshot = await window.desktop.getRuntimeState()
      if (snapshot.ok) onSnapshot(snapshot.data)
    } else setMessage(result.error.message)
  }

  const showDiagnostic = async (): Promise<void> => {
    setWorking(true)
    const result = await window.desktop.getRuntimeEnvironmentDiagnostic()
    setWorking(false)
    if (!result.ok) {
      setMessage(result.error.message)
      return
    }
    setDiagnostic(result.data)
    setDiagnosticOpen(true)
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpenState}>
        <Popover.Trigger asChild>
          <button
            aria-label="Runtime 代理"
            className="composer-control"
            disabled={busy}
            type="button"
          >
            <Network size={14} />
            <span>代理：{labels[status?.config.mode ?? 'auto']}</span>
            <ChevronDown size={14} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            className="popover-panel w-80 max-w-[calc(100vw-2rem)] p-1.5"
            sideOffset={6}
          >
            {panel === 'manual' ? (
              <div>
                <button
                  className="command-item w-full"
                  onClick={() => {
                    setPanel('modes')
                    setMessage(null)
                  }}
                  type="button"
                >
                  <ArrowLeft size={15} />
                  手动代理
                </button>
                <label className="block px-2 py-3 text-xs">
                  <span className="mb-1.5 block text-[var(--text-secondary)]">
                    本地 HTTP 代理端口
                  </span>
                  <input
                    aria-label="本地 HTTP 代理端口"
                    className="w-full rounded-md border border-[var(--border)] px-2.5 py-2 text-sm outline-none focus:border-[var(--text-muted)]"
                    inputMode="numeric"
                    maxLength={5}
                    onChange={(event) =>
                      setPortText(event.target.value.replace(/\D/gu, ''))
                    }
                    placeholder="1–65535"
                    value={portText}
                  />
                </label>
                <div className="flex gap-2 px-2 pb-2">
                  <button
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
                    disabled={working}
                    onClick={() => void detectPort()}
                    type="button"
                  >
                    检测端口
                  </button>
                  <button
                    className="rounded-md bg-[var(--text-primary)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    disabled={working}
                    onClick={applyManual}
                    type="button"
                  >
                    {runtime.workspacePath ? '应用并重启' : '保存'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {(['off', 'auto', 'manual'] as const).map((mode) => (
                  <button
                    aria-checked={draft.mode === mode}
                    className="command-item w-full"
                    key={mode}
                    onClick={() => {
                      setDraft({ ...draft, mode })
                      if (mode === 'manual') setPanel('manual')
                      else void apply({ ...draft, mode })
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className="flex-1">代理：{labels[mode]}</span>
                    {draft.mode === mode && <Check size={15} />}
                  </button>
                ))}
                <div className="mt-1 border-t border-[var(--border-subtle)] px-2 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
                  <p>
                    来源：
                    {status?.source === 'electron-fallback'
                      ? 'Electron 启动环境（Shell 探测失败）'
                      : 'Login Shell'}
                  </p>
                  <p>结果：{status?.proxySource ?? '未注入代理'}</p>
                  {status?.error && (
                    <p className="text-amber-700">{status.error}</p>
                  )}
                  <p>关闭只移除代理变量，不影响系统 TUN 或路由。</p>
                </div>
                <button
                  className="command-item w-full border-t border-[var(--border-subtle)]"
                  disabled={working}
                  onClick={() => void detect()}
                  type="button"
                >
                  <RotateCcw size={14} />
                  重新检测
                </button>
                <button
                  className="command-item w-full"
                  disabled={working}
                  onClick={() => void showDiagnostic()}
                  type="button"
                >
                  环境诊断
                </button>
              </div>
            )}
            {(working || message) && (
              <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-amber-700">
                {working && <LoaderCircle className="animate-spin" size={13} />}
                {message}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Dialog.Root open={diagnosticOpen} onOpenChange={setDiagnosticOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content max-w-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-base font-semibold">
                  Runtime 环境诊断
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-[var(--text-muted)]">
                  仅包含 Shell、PATH、Workspace、工具和脱敏后的代理来源。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button aria-label="关闭环境诊断" type="button">
                  <X size={17} />
                </button>
              </Dialog.Close>
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto rounded-lg bg-[var(--surface-app)] p-3 text-xs leading-5 whitespace-pre-wrap">
              {diagnostic?.copyText}
            </pre>
            <div className="mt-3 flex justify-end">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
                onClick={() =>
                  diagnostic &&
                  void window.desktop.copyText(diagnostic.copyText)
                }
                type="button"
              >
                <Copy size={14} />
                复制
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
