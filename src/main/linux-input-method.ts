import type { CommandLine } from 'electron'

export function configureLinuxInputMethod(
  commandLine: Pick<CommandLine, 'appendSwitch'>,
  platform = process.platform,
  sessionType = process.env['XDG_SESSION_TYPE']
): void {
  if (platform !== 'linux' || sessionType !== 'wayland') return
  commandLine.appendSwitch('enable-wayland-ime')
  commandLine.appendSwitch('wayland-text-input-version', '3')
}
