import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { ErrorBoundary } from './error-boundary'
import './styles.css'

const timeOrigin = performance.timeOrigin

function reportPerformance(
  event: 'dom_ready' | 'renderer_ready',
  now = performance.now()
): void {
  window.desktop.reportPerformance({
    event,
    timestamp: timeOrigin + now,
    elapsedMs: now
  })
}

reportPerformance('dom_ready')

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name !== 'first-paint' && entry.name !== 'first-contentful-paint')
      continue
    window.desktop.reportPerformance({
      event:
        entry.name === 'first-paint' ? 'first_paint' : 'first_contentful_paint',
      timestamp: timeOrigin + entry.startTime,
      elapsedMs: entry.startTime
    })
  }
  observer.disconnect()
})

observer.observe({ type: 'paint', buffered: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    reportPerformance('renderer_ready')
    window.desktop.rendererReady()
  })
})
