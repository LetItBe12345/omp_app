import log from 'electron-log/main'
import { performance } from 'node:perf_hooks'

const processStartedAt = Date.now() - performance.now()

export function initializeLogger(): void {
  log.initialize()
  log.transports.file.level = 'info'
  log.transports.console.level =
    process.env['NODE_ENV'] === 'development' ? 'debug' : 'info'
  log.info('日志已初始化', { path: log.transports.file.getFile().path })
  recordMainPerformance('process_start', processStartedAt)
}

export function recordMainPerformance(
  event: string,
  timestamp = Date.now()
): void {
  log.info('performance', {
    event,
    timestamp,
    elapsedMs: Math.max(0, timestamp - processStartedAt)
  })
}

export { log }
