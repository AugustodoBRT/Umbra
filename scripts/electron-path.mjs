import { existsSync } from 'node:fs';
// Reuse Arch's existing runtime. Other environments use the pinned npm runtime.
export async function electronPath() {
  if (process.env.CINESSD_ELECTRON) return process.env.CINESSD_ELECTRON;
  if (process.platform === 'linux' && existsSync('/usr/bin/electron')) return '/usr/bin/electron';
  return (await import('electron')).default;
}
