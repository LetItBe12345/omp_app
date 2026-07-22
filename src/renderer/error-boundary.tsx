import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    window.desktop.log({
      level: 'error',
      message: 'Renderer 渲染失败',
      context: {
        name: error.name,
        componentStackAvailable: Boolean(info.componentStack)
      }
    })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface-app)] p-8">
        <section className="max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            界面加载失败
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            错误已写入本地日志。可以重新加载界面后继续。
          </p>
          <button
            className="mt-5 rounded-lg bg-[var(--text-primary)] px-4 py-2 text-sm text-white"
            type="button"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </section>
      </main>
    )
  }
}
