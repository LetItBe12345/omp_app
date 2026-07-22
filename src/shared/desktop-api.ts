export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type RendererLogEntry = {
  level: LogLevel
  message: string
  context?: Record<string, boolean | number | string | null>
}

export type PerformanceEntry = {
  event:
    'dom_ready' | 'first_paint' | 'first_contentful_paint' | 'renderer_ready'
  timestamp: number
  elapsedMs: number
}

export type DesktopApi = {
  openExternal(url: string): Promise<boolean>
  log(entry: RendererLogEntry): void
  reportPerformance(entry: PerformanceEntry): void
  rendererReady(): void
}

export const IPC_CHANNELS = {
  log: 'desktop:log',
  openExternal: 'desktop:open-external',
  performance: 'desktop:performance',
  rendererReady: 'desktop:renderer-ready'
} as const
