import type { CommandLine } from 'electron'

export function configureLinuxInputMethod(
  commandLine: Pick<CommandLine, 'appendSwitch'>,
  platform = process.platform,
  sessionType = process.env['XDG_SESSION_TYPE'],
  environment: NodeJS.ProcessEnv = process.env
): 'unchanged' | 'wayland' | 'xim' {
  if (platform !== 'linux') return 'unchanged'
  if (sessionType === 'wayland') {
    commandLine.appendSwitch('enable-wayland-ime')
    commandLine.appendSwitch('wayland-text-input-version', '3')
    return 'wayland'
  }
  if (
    sessionType === 'x11' &&
    environment['GTK_IM_MODULE']?.toLowerCase() === 'ibus'
  ) {
    environment['GTK_IM_MODULE'] = 'xim'
    return 'xim'
  }
  return 'unchanged'
}
