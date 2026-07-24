type CommandLine = {
  appendSwitch(name: string, value?: string): void
}

export function configureLinuxFileChooser(
  commandLine: CommandLine,
  platform = process.platform
): void {
  if (platform !== 'linux') return

  // Portal v3 在部分 Ubuntu/GNOME 环境中首次显示较慢。Electron 支持在
  // portal 低于 v4 时退回 GTK/KDE；v4 及以上仍使用 portal。
  commandLine.appendSwitch('xdg-portal-required-version', '4')
}
