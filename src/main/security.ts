import type { Session, WebContents } from 'electron'
import { shell } from 'electron'
import { createContentSecurityPolicy } from './content-security-policy'
import { log } from './logger'
import { validateExternalUrl } from './external-url'

export function installSessionSecurity(
  session: Session,
  development: boolean
): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  session.setPermissionCheckHandler(() => false)

  const csp = createContentSecurityPolicy(development)

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

export function installNavigationSecurity(webContents: WebContents): void {
  webContents.on('will-navigate', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = validateExternalUrl(url)
    if (externalUrl) {
      void shell
        .openExternal(externalUrl.toString())
        .catch((error: unknown) => {
          log.error('打开外部链接失败', error)
        })
    }
    return { action: 'deny' }
  })
}
