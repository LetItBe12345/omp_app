import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AvailableModel,
  ProviderLoginState,
  RuntimeSnapshot
} from '../../src/shared/desktop-api'
import { ModelControls } from '../../src/renderer/model-controls'

const models: AvailableModel[] = [
  {
    provider: 'test',
    id: 'fake-model',
    name: 'Fake Model',
    reasoning: true,
    thinking: { efforts: ['medium', 'high'], defaultLevel: 'medium' }
  },
  {
    provider: 'test',
    id: 'reasoning-next',
    name: 'Reasoning Next',
    reasoning: true,
    thinking: { efforts: ['low', 'high'], defaultLevel: 'high' }
  }
]

const runtime: RuntimeSnapshot = {
  status: 'ready',
  isStreaming: false,
  queuedMessageCount: 0,
  model: 'test/fake-model',
  thinkingLevel: 'medium'
}

function renderControls({
  loginState = { status: 'idle' },
  modelList = models,
  providerList = [
    { id: 'browser', name: 'Browser Login', available: true },
    { id: 'disabled', name: 'Disabled', available: false }
  ],
  runtimeState = runtime,
  catalogError = null
}: {
  loginState?: ProviderLoginState
  modelList?: AvailableModel[]
  providerList?: Array<{ id: string; name: string; available: boolean }>
  runtimeState?: RuntimeSnapshot
  catalogError?: string | null
} = {}) {
  const onSnapshot = vi.fn()
  const onRefreshModels = vi.fn().mockResolvedValue(true)
  const onRefreshProviders = vi.fn().mockResolvedValue(true)
  const view = render(
    <ModelControls
      catalogError={catalogError}
      loginState={loginState}
      models={modelList}
      modelsLoaded
      onRefreshModels={onRefreshModels}
      onRefreshProviders={onRefreshProviders}
      onSnapshot={onSnapshot}
      providers={providerList}
      runtime={runtimeState}
    />
  )
  return { ...view, onSnapshot, onRefreshModels, onRefreshProviders }
}

describe('ModelControls', () => {
  it('按模型默认档位提交模型和推理强度组合', async () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(await screen.findByText('Reasoning Next'))

    await waitFor(() =>
      expect(window.desktop.selectModel).toHaveBeenCalledWith({
        provider: 'test',
        modelId: 'reasoning-next',
        thinkingLevel: 'high'
      })
    )
  })

  it('模型和推理强度是相邻但独立的控件', async () => {
    renderControls()

    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent(
      'Fake Model'
    )
    fireEvent.click(screen.getByRole('button', { name: '选择推理强度' }))
    fireEvent.click(await screen.findByRole('button', { name: '高' }))

    await waitFor(() =>
      expect(window.desktop.setThinkingLevel).toHaveBeenCalledWith('high')
    )
  })

  it('模型按 Provider 和 OMP 顺序分组，并搜索所有标识字段', async () => {
    renderControls({
      modelList: [
        {
          provider: 'zeta',
          id: 'z-first',
          name: 'Zeta First',
          reasoning: false
        },
        {
          provider: 'alpha',
          id: 'a-second',
          name: 'Alpha Second',
          reasoning: false
        }
      ],
      providerList: [
        { id: 'zeta', name: 'Zeta Provider', available: true },
        { id: 'alpha', name: 'Alpha Provider', available: true }
      ],
      runtimeState: { ...runtime, model: 'zeta/z-first' }
    })

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    const first = await screen.findByRole('option', {
      name: 'Zeta First z-first'
    })
    const second = screen.getByRole('option', {
      name: 'Alpha Second a-second'
    })
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('z-first')).toBeInTheDocument()
    expect(screen.getByText('Zeta Provider · zeta')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '模型选择器' }), {
      target: { value: 'a-second' }
    })
    expect(
      await screen.findByRole('option', { name: 'Alpha Second a-second' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'Zeta First z-first' })
    ).not.toBeInTheDocument()
  })

  it('没有默认档位时选择 efforts 第一项', async () => {
    renderControls({
      modelList: [
        ...models,
        {
          provider: 'test',
          id: 'first-effort',
          name: 'First Effort',
          reasoning: true,
          thinking: { efforts: ['low', 'high'] }
        }
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(await screen.findByText('First Effort'))
    await waitFor(() =>
      expect(window.desktop.selectModel).toHaveBeenCalledWith({
        provider: 'test',
        modelId: 'first-effort',
        thinkingLevel: 'low'
      })
    )
  })

  it('显示非推理、自动推理、未知和失效档位', async () => {
    const nonReasoning = renderControls({
      modelList: [
        { provider: 'test', id: 'fast', name: 'Fast', reasoning: false }
      ],
      runtimeState: { ...runtime, model: 'test/fast' }
    })
    expect(
      screen.getByRole('button', { name: '选择推理强度' })
    ).toHaveTextContent('不支持')
    expect(screen.getByRole('button', { name: '选择推理强度' })).toBeDisabled()
    nonReasoning.unmount()

    const automatic = renderControls({
      modelList: [
        { provider: 'test', id: 'auto', name: 'Auto', reasoning: true }
      ],
      runtimeState: { ...runtime, model: 'test/auto' }
    })
    expect(
      screen.getByRole('button', { name: '选择推理强度' })
    ).toHaveTextContent('自动')
    automatic.unmount()

    renderControls({
      modelList: [
        {
          provider: 'test',
          id: 'custom',
          name: 'Custom',
          reasoning: true,
          thinking: { efforts: ['turbo'] }
        }
      ],
      runtimeState: {
        ...runtime,
        model: 'test/custom',
        thinkingLevel: 'legacy'
      }
    })
    expect(
      screen.getByRole('button', { name: '选择推理强度' })
    ).toHaveTextContent('legacy')
    expect(screen.getByText('当前档位已不受支持')).toBeInTheDocument()
  })

  it('全部已知 Thinking 档位使用中文标签', async () => {
    renderControls({
      modelList: [
        {
          provider: 'test',
          id: 'all-levels',
          name: 'All Levels',
          reasoning: true,
          thinking: {
            efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
          }
        }
      ],
      runtimeState: {
        ...runtime,
        model: 'test/all-levels',
        thinkingLevel: 'minimal'
      }
    })

    expect(
      screen.getByRole('button', { name: '选择推理强度' })
    ).toHaveTextContent('最低')
    fireEvent.click(screen.getByRole('button', { name: '选择推理强度' }))
    for (const label of ['最低', '低', '中', '高', '超高', '最高']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('显示并取消最后一次待切换配置', async () => {
    renderControls({
      runtimeState: {
        ...runtime,
        isStreaming: true,
        pendingModelSelection: {
          provider: 'test',
          modelId: 'reasoning-next',
          thinkingLevel: 'high'
        }
      }
    })

    expect(screen.getByText('下次使用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent(
      'Reasoning Next'
    )
    fireEvent.click(screen.getByRole('button', { name: '取消下次切换' }))
    await waitFor(() =>
      expect(window.desktop.cancelPendingModelSelection).toHaveBeenCalled()
    )
  })

  it('登录成功且模型列表不变时仍打开完整模型选择器', async () => {
    vi.mocked(window.desktop.loginProvider).mockResolvedValueOnce({
      ok: true,
      data: undefined
    })
    const view = renderControls()

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '添加 Provider' })
    )
    fireEvent.click(await screen.findByText('Browser Login'))

    await waitFor(() => expect(view.onRefreshModels).toHaveBeenCalled())
    expect(
      await screen.findByRole('combobox', { name: '模型选择器' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Fake Model fake-model' })
    ).toBeInTheDocument()
  })

  it('Provider 输入默认遮挡，并通过 Extension UI 响应回传', async () => {
    let finishLogin:
      ((value: { ok: true; data: undefined }) => void) | undefined
    vi.mocked(window.desktop.loginProvider).mockReturnValue(
      new Promise((resolve) => {
        finishLogin = resolve
      })
    )
    const view = renderControls()

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '添加 Provider' })
    )
    fireEvent.click(await screen.findByText('Browser Login'))
    expect(window.desktop.loginProvider).toHaveBeenCalledWith('browser')

    view.rerender(
      <ModelControls
        catalogError={null}
        loginState={{
          status: 'waiting-input',
          providerId: 'browser',
          input: {
            id: 'input-1',
            message: '输入授权码',
            placeholder: 'authorization code'
          }
        }}
        models={models}
        modelsLoaded
        onRefreshModels={view.onRefreshModels}
        onRefreshProviders={view.onRefreshProviders}
        onSnapshot={view.onSnapshot}
        providers={[{ id: 'browser', name: 'Browser Login', available: true }]}
        runtime={{ ...runtime, isAuthenticating: true }}
      />
    )

    const input = await screen.findByLabelText('输入授权码')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.change(input, { target: { value: 'secret-code' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() =>
      expect(window.desktop.respondExtensionUi).toHaveBeenCalledWith(
        'input-1',
        { value: 'secret-code' }
      )
    )
    finishLogin?.({ ok: true, data: undefined })
  })

  it('登录说明按纯文本显示，进度只保留最新一条，Esc 执行取消', async () => {
    vi.mocked(window.desktop.loginProvider).mockReturnValueOnce(
      new Promise(() => undefined)
    )
    const view = renderControls()
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '添加 Provider' })
    )
    fireEvent.click(await screen.findByText('Browser Login'))

    view.rerender(
      <ModelControls
        catalogError={null}
        loginState={{
          status: 'opening-browser',
          providerId: 'browser',
          message: '无法打开系统浏览器',
          instructions: '请访问 [授权页面](链接已隐藏)',
          canReopenBrowser: true
        }}
        models={models}
        modelsLoaded
        onRefreshModels={view.onRefreshModels}
        onRefreshProviders={view.onRefreshProviders}
        onSnapshot={view.onSnapshot}
        providers={[{ id: 'browser', name: 'Browser Login', available: true }]}
        runtime={{ ...runtime, isAuthenticating: true }}
      />
    )
    expect(
      screen.getByText('请访问 [授权页面](链接已隐藏)')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }))
    expect(window.desktop.reopenProviderLoginUrl).toHaveBeenCalled()

    view.rerender(
      <ModelControls
        catalogError={null}
        loginState={{
          status: 'progress',
          providerId: 'browser',
          message: '最新进度'
        }}
        models={models}
        modelsLoaded
        onRefreshModels={view.onRefreshModels}
        onRefreshProviders={view.onRefreshProviders}
        onSnapshot={view.onSnapshot}
        providers={[{ id: 'browser', name: 'Browser Login', available: true }]}
        runtime={{ ...runtime, isAuthenticating: true }}
      />
    )
    expect(screen.getByText('最新进度')).toBeInTheDocument()
    expect(screen.queryByText('无法打开系统浏览器')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(window.desktop.cancelProviderLogin).toHaveBeenCalled()
    )
  })
})
