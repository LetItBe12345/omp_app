import * as Dialog from '@radix-ui/react-dialog'
import { Minus, Plus, Settings2, X } from 'lucide-react'
import { useState } from 'react'
import type {
  RuntimeNetworkConfig,
  RuntimeNetworkMode,
  RuntimeSettings
} from '../shared/desktop-api'

const networkLabels: Record<RuntimeNetworkMode, string> = {
  off: '关闭',
  auto: '自动检测',
  manual: '手动代理'
}

export function RuntimeSettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<RuntimeSettings | null>(null)
  const [network, setNetwork] = useState<RuntimeNetworkConfig>({ mode: 'auto' })
  const [parallel, setParallel] = useState(5)
  const [port, setPort] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setError(null)
    const result = await window.desktop.getRuntimeSettings()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSettings(result.data)
    setNetwork(result.data.defaultNetwork)
    setParallel(result.data.maxParallelSessions)
    setPort(result.data.defaultNetwork.manualPort?.toString() ?? '')
  }

  const changeOpen = (next: boolean): void => {
    setOpen(next)
    if (next) void load()
  }

  const save = async (): Promise<void> => {
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 10) {
      setError('最大并行数量必须是 1–10 的整数')
      return
    }
    let defaultNetwork = network
    if (network.mode === 'manual') {
      const manualPort = Number(port)
      if (
        !Number.isInteger(manualPort) ||
        manualPort < 1 ||
        manualPort > 65_535
      ) {
        setError('端口必须是 1–65535 的整数')
        return
      }
      defaultNetwork = { mode: 'manual', manualPort }
    }
    setWorking(true)
    setError(null)
    const result = await window.desktop.applyRuntimeSettings({
      defaultNetwork,
      maxParallelSessions: parallel
    })
    setWorking(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSettings(result.data)
    setOpen(false)
  }

  return (
    <Dialog.Root onOpenChange={changeOpen} open={open}>
      <Dialog.Trigger asChild>
        <button
          aria-label="设置"
          className="inline-grid size-8 place-items-center rounded-lg text-[var(--text-muted)]"
          type="button"
        >
          <Settings2 size={16} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border)] bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">
              Runtime 设置
            </Dialog.Title>
            <Dialog.Close className="inline-grid size-8 place-items-center rounded-lg">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-[var(--text-muted)]">
            默认网络只用于之后创建的新会话，不修改已有会话。
          </Dialog.Description>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">新会话默认网络</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['off', 'auto', 'manual'] as const).map((mode) => (
                <button
                  aria-pressed={network.mode === mode}
                  className={`rounded-lg border px-2 py-2 text-xs ${
                    network.mode === mode
                      ? 'border-[var(--text-primary)] bg-[var(--surface-selected)]'
                      : 'border-[var(--border)]'
                  }`}
                  key={mode}
                  onClick={() => setNetwork({ mode })}
                  type="button"
                >
                  {networkLabels[mode]}
                </button>
              ))}
            </div>
            {network.mode === 'manual' && (
              <label className="mt-3 block text-xs">
                本地代理端口
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 outline-none"
                  inputMode="numeric"
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="7890"
                  value={port}
                />
              </label>
            )}
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              最大并行 Session 数量
            </legend>
            <div className="mt-2 flex items-center gap-2">
              <button
                aria-label="减少并行数量"
                className="inline-grid size-9 place-items-center rounded-lg border border-[var(--border)]"
                disabled={parallel <= 1}
                onClick={() => setParallel((value) => Math.max(1, value - 1))}
                type="button"
              >
                <Minus size={15} />
              </button>
              <input
                aria-label="最大并行 Session 数量"
                className="h-9 w-16 rounded-lg border border-[var(--border)] text-center outline-none"
                max={10}
                min={1}
                onChange={(event) => setParallel(Number(event.target.value))}
                type="number"
                value={parallel}
              />
              <button
                aria-label="增加并行数量"
                className="inline-grid size-9 place-items-center rounded-lg border border-[var(--border)]"
                disabled={parallel >= 10}
                onClick={() => setParallel((value) => Math.min(10, value + 1))}
                type="button"
              >
                <Plus size={15} />
              </button>
            </div>
            {settings && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                正在运行 {settings.runningSessions} / {parallel}，等待{' '}
                {settings.waitingSessions}
              </p>
            )}
          </fieldset>

          {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close
              className="rounded-lg px-3 py-2 text-sm"
              type="button"
            >
              取消
            </Dialog.Close>
            <button
              className="rounded-lg bg-[var(--text-primary)] px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={working}
              onClick={() => void save()}
              type="button"
            >
              {working ? '正在保存…' : '保存'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
