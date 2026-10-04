import { existsSync } from 'node:fs';
import path from 'node:path';

export function mediaTool(name: 'ffmpeg'|'ffprobe') {
  const override = process.env[`CINESSD_${name.toUpperCase()}`];
  if (override) return override;
  if (process.platform !== 'win32') return name;
  const packaged = path.join(process.resourcesPath ?? '', 'bin',`${name}.exe`);
  return existsSync(packaged) ? packaged : path.resolve('packaging/windows/bin',`${name}.exe`);
}
export function torrentWorker() {
  const bundled = path.join(process.resourcesPath ?? '', 'bin','torrent','umbra-torrent.exe');
  if (process.platform === 'win32' && existsSync(bundled)) return bundled;
  return path.resolve('packaging/windows/bin/torrent/umbra-torrent.exe');
}
