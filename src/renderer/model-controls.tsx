import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import {
  Brain,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AvailableModel,
  LoginProvider,
  ModelSelection,
  ProviderLoginState,
  RuntimeSnapshot
} from '../shared/desktop-api'

const thinkingLabels: Record<string, string> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高'
}

function modelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`
}

function parseModel(value?: string): ModelSelection | null {
  if (!value) return null
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 1)
  }
}

function thinkingLabel(level?: string): string {
  if (!level) return '默认'
  return thinkingLabels[level] ?? level
}

function isLoginActive(state: ProviderLoginState): boolean {
  return state.status !== 'idle' && state.status !== 'failed'
}

type ModelControlsProps = {
  runtime: RuntimeSnapshot
  models: AvailableModel[]
  providers: LoginProvider[]
  loginState: ProviderLoginState
  catalogError: string | null
  modelsLoaded: boolean
  onSnapshot: (snapshot: RuntimeSnapshot) => void
  onRefreshModels: () => Promise<boolean>
  onRefreshProviders: () => Promise<boolean>
}

export function ModelControls({
  runtime,
  models,
  providers,
  loginState,
  catalogError,
  modelsLoaded,
  onSnapshot,
  onRefreshModels,
  onRefreshProviders
}: ModelControlsProps): React.JSX.Element {
  const [modelOpen, setModelOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)
  const effectiveSelection =
    runtime.pendingModelSelection ?? parseModel(runtime.model)
  const selectedModel = effectiveSelection
    ? models.find(
        (model) =>
          model.provider === effectiveSelection.provider &&
          model.id === effectiveSelection.modelId
      )
    : undefined
  const effectiveThinking =
    runtime.pendingModelSelection?.thinkingLevel ?? runtime.thinkingLevel
  const busy = runtime.isStreaming || runtime.queuedMessageCount > 0
  const ready = runtime.status === 'ready'

  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers]
  )
  const groupedModels = useMemo(() => {
    const groups = new Map<string, AvailableModel[]>()
    for (const model of models) {
      const group = groups.get(model.provider)
      if (group) group.push(model)
      else groups.set(model.provider, [model])
    }
    return [...groups]
  }, [models])
  const currentModelMissing = Boolean(
    modelsLoaded &&
    runtime.model &&
    !models.some(
      (model) => modelKey(model.provider, model.id) === runtime.model
    )
  )

  const selectModel = async (model: AvailableModel): Promise<void> => {
    setControlError(null)
    const thinkingLevel =
      model.thinking?.defaultLevel ?? model.thinking?.efforts[0]
    const result = await window.desktop.selectModel({
      provider: model.provider,
      modelId: model.id,
      ...(thinkingLevel ? { thinkingLevel } : {})
    })
    if (result.ok) {
      onSnapshot(result.data)
      setModelOpen(false)
    } else {
      setControlError(result.error.message)
    }
  }

  const selectThinking = async (level: string): Promise<void> => {
    if (!effectiveSelection) return
    setControlError(null)
    if (busy) {
      const result = await window.desktop.selectModel({
        ...effectiveSelection,
        thinkingLevel: level
      })
      if (result.ok) onSnapshot(result.data)
      else setControlError(result.error.message)
      return
    }
    const result = await window.desktop.setThinkingLevel(level)
    if (result.ok) {
      const state = await window.desktop.getRuntimeState()
      if (state.ok) onSnapshot(state.data)
    } else {
      setControlError(result.error.message)
      const state = await window.desktop.getRuntimeState()
      if (state.ok) onSnapshot(state.data)
    }
  }

  const cancelPending = async (): Promise<void> => {
    const result = await window.desktop.cancelPendingModelSelection()
    if (result.ok) onSnapshot(result.data)
    else setControlError(result.error.message)
  }

  const modelButtonLabel = selectedModel?.name ?? runtime.model ?? '选择模型'
  const thinkingUnsupported = selectedModel
    ? !selectedModel.reasoning
      ? '不支持'
      : !selectedModel.thinking
        ? '自动'
        : null
    : '不支持'
  const currentThinkingUnsupported = Boolean(
    selectedModel?.thinking &&
    effectiveThinking &&
    !selectedModel.thinking.efforts.includes(effectiveThinking)
  )

  return (
    <>
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 px-1">
        <Popover.Root
          open={modelOpen || currentModelMissing}
          onOpenChange={setModelOpen}
        >
          <Popover.Trigger asChild>
            <button
              aria-label="选择模型"
              className="composer-control max-w-[19rem]"
              disabled={!ready || runtime.isAuthenticating}
              type="button"
            >
              <span className="truncate">{modelButtonLabel}</span>
              {runtime.pendingModelSelection && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                  下次使用
                </span>
              )}
              <ChevronDown className="shrink-0" size={14} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              className="popover-panel w-[25rem] max-w-[calc(100vw-2rem)]"
              sideOffset={6}
            >
              <Command label="模型选择器">
                <div className="command-search">
                  <Search size={15} />
                  <Command.Input
                    aria-label="搜索模型"
                    placeholder="搜索 Provider 或模型"
                  />
                </div>
                <Command.List className="max-h-80 overflow-y-auto p-1.5">
                  <Command.Empty className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
                    没有匹配的模型
                  </Command.Empty>
                  {groupedModels.map(([providerId, providerModels]) => (
                    <Command.Group
                      heading={
                        providerNames.has(providerId)
                          ? `${providerNames.get(providerId)} · ${providerId}`
                          : providerId
                      }
                      key={providerId}
                    >
                      {providerModels.map((model) => {
                        const selected =
                          effectiveSelection?.provider === model.provider &&
                          effectiveSelection.modelId === model.id
                        return (
                          <Command.Item
                            className="command-item"
                            key={modelKey(model.provider, model.id)}
                            onSelect={() => void selectModel(model)}
                            value={`${providerNames.get(providerId) ?? ''} ${providerId} ${model.name} ${model.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{model.name}</p>
                              <p className="truncate text-[11px] text-[var(--text-muted)]">
                                {model.id}
                              </p>
                            </div>
                            {selected && <Check size={15} />}
                          </Command.Item>
                        )
                      })}
                    </Command.Group>
                  ))}
                </Command.List>
              </Command>
              {catalogError && (
                <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-amber-700">
                  <span>{catalogError}</span>
                  <button
                    className="shrink-0 underline underline-offset-2"
                    onClick={() => void onRefreshModels()}
                    type="button"
                  >
                    重试
                  </button>
                </div>
              )}
              <button
                className="flex w-full items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-selected)]"
                onClick={() => {
                  setModelOpen(false)
                  setProviderOpen(true)
                }}
                type="button"
              >
                <Plus size={15} />
                添加 Provider
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              aria-label="选择推理强度"
              className="composer-control"
              disabled={
                !ready ||
                runtime.isAuthenticating ||
                thinkingUnsupported !== null
              }
              title={
                currentThinkingUnsupported ? '当前档位已不受支持' : undefined
              }
              type="button"
            >
              <Brain size={14} />
              <span>
                {thinkingUnsupported ?? thinkingLabel(effectiveThinking)}
              </span>
              {thinkingUnsupported === null && <ChevronDown size={14} />}
            </button>
          </Popover.Trigger>
          {selectedModel?.thinking && (
            <Popover.Portal>
              <Popover.Content
                align="start"
                className="popover-panel min-w-40 p-1.5"
                sideOffset={6}
              >
                {selectedModel.thinking.efforts.map((level) => (
                  <Popover.Close asChild key={level}>
                    <button
                      className="command-item w-full"
                      onClick={() => void selectThinking(level)}
                      type="button"
                    >
                      <span className="flex-1 text-left">
                        {thinkingLabel(level)}
                      </span>
                      {effectiveThinking === level && <Check size={15} />}
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          )}
        </Popover.Root>

        {runtime.pendingModelSelection && (
          <button
            className="text-[11px] text-[var(--text-secondary)] underline underline-offset-2"
            onClick={() => void cancelPending()}
            type="button"
          >
            取消下次切换
          </button>
        )}
        {(controlError || currentThinkingUnsupported) && (
          <span className="text-[11px] text-amber-700">
            {controlError ?? '当前档位已不受支持'}
          </span>
        )}
      </div>

      <ProviderLoginDialog
        loginState={loginState}
        onLoginSuccess={async () => {
          await Promise.all([onRefreshModels(), onRefreshProviders()])
          setProviderOpen(false)
          setModelOpen(true)
        }}
        onOpenChange={(open) => {
          if (!open && isLoginActive(loginState)) {
            void window.desktop.cancelProviderLogin()
          }
          setProviderOpen(open)
        }}
        onRefreshProviders={onRefreshProviders}
        open={providerOpen}
        providers={providers}
      />
    </>
  )
}

function ProviderLoginDialog({
  open,
  onOpenChange,
  providers,
  loginState,
  onRefreshProviders,
  onLoginSuccess
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: LoginProvider[]
  loginState: ProviderLoginState
  onRefreshProviders: () => Promise<boolean>
  onLoginSuccess: () => Promise<void>
}): React.JSX.Element {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null
  )
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (open) void onRefreshProviders()
  }, [onRefreshProviders, open])

  const startLogin = async (providerId: string): Promise<void> => {
    setSelectedProviderId(providerId)
    setLocalError(null)
    const result = await window.desktop.loginProvider(providerId)
    if (result.ok) {
      await onLoginSuccess()
    } else if (!/已取消/u.test(result.error.message)) {
      setLocalError(result.error.message)
    }
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setLocalError(null)
      setSelectedProviderId(null)
    }
    onOpenChange(nextOpen)
  }

  const active = isLoginActive(loginState)
  const showProviderList = !active && !selectedProviderId && !localError

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-panel">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                添加 Provider
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--text-muted)]">
                凭据由 OMP 保存，Desktop 不保存 Token 副本。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭 Provider 登录"
                className="icon-control"
                type="button"
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          {showProviderList ? (
            <Command className="min-h-0 flex-1" label="Provider 列表">
              <div className="command-search mx-4 mt-4 rounded-lg border border-[var(--border)]">
                <Search size={15} />
                <Command.Input
                  aria-label="搜索 Provider"
                  placeholder="搜索 Provider 名称或 ID"
                />
              </div>
              <Command.List className="max-h-[25rem] overflow-y-auto p-4">
                <Command.Empty className="py-10 text-center text-sm text-[var(--text-muted)]">
                  没有匹配的 Provider
                </Command.Empty>
                {providers.map((provider) => (
                  <Command.Item
                    className="command-item mb-1"
                    disabled={!provider.available}
                    key={provider.id}
                    onSelect={() => void startLogin(provider.id)}
                    value={`${provider.name} ${provider.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{provider.name}</p>
                      <p className="truncate text-[11px] text-[var(--text-muted)]">
                        {provider.id}
                      </p>
                    </div>
                    {!provider.available && (
                      <span className="text-[11px] text-[var(--text-muted)]">
                        当前不可用
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          ) : (
            <div className="p-5">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-panel)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {active && (
                    <LoaderCircle className="animate-spin" size={16} />
                  )}
                  <span>
                    {localError ??
                      loginState.message ??
                      (loginState.status === 'failed'
                        ? '授权失败'
                        : '正在登录')}
                  </span>
                </div>
                {loginState.instructions && (
                  <p className="mt-3 text-xs leading-5 whitespace-pre-wrap text-[var(--text-secondary)]">
                    {loginState.instructions}
                  </p>
                )}
              </div>

              {loginState.input && (
                <ProviderLoginInput
                  input={loginState.input}
                  key={loginState.input.id}
                  onError={setLocalError}
                />
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {loginState.canReopenBrowser && (
                  <button
                    className="secondary-button"
                    onClick={() => void window.desktop.reopenProviderLoginUrl()}
                    type="button"
                  >
                    <RotateCcw size={14} />
                    重新打开
                  </button>
                )}
                {(localError || loginState.status === 'failed') && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setLocalError(null)
                      setSelectedProviderId(null)
                    }}
                    type="button"
                  >
                    返回 Provider 列表
                  </button>
                )}
                {active && (
                  <button
                    className="secondary-button"
                    onClick={() => onOpenChange(false)}
                    type="button"
                  >
                    取消登录
                  </button>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ProviderLoginInput({
  input,
  onError
}: {
  input: NonNullable<ProviderLoginState['input']>
  onError: (message: string) => void
}): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)

  const submit = async (): Promise<void> => {
    if (!inputValue) return
    const value = inputValue
    setInputValue('')
    setShowInput(false)
    const result = await window.desktop.respondExtensionUi(input.id, { value })
    if (!result.ok) onError(result.error.message)
  }

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="text-xs font-medium" htmlFor="provider-login-input">
        {input.message}
      </label>
      <div className="mt-2 flex items-center rounded-lg border border-[var(--border)] bg-white focus-within:border-[var(--text-muted)]">
        <input
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
          id="provider-login-input"
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={input.placeholder}
          type={showInput ? 'text' : 'password'}
          value={inputValue}
        />
        <button
          aria-label={showInput ? '隐藏内容' : '显示内容'}
          className="icon-control mr-1"
          onClick={() => setShowInput((value) => !value)}
          type="button"
        >
          {showInput ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <button
        className="primary-button mt-3"
        disabled={!inputValue}
        type="submit"
      >
        提交
      </button>
    </form>
  )
}
