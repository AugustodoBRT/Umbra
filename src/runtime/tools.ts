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
export function mpvTool() {
  if(process.env.CINESSD_MPV) return process.env.CINESSD_MPV;
  if(process.platform!=='win32') return 'mpv';
  const packaged=path.join(process.resourcesPath ?? '', 'bin','mpv','mpv.exe');
  return existsSync(packaged) ? packaged : path.resolve('packaging/windows/bin/mpv/mpv.exe');
}
export function playerHost() {
  if(process.env.CINESSD_PLAYER_HOST) return process.env.CINESSD_PLAYER_HOST;
  const name=process.platform==='win32' ? 'umbra-player-host.exe' : 'umbra-player-host';
  const packaged=path.join(process.resourcesPath ?? '', 'bin',name);
  if(existsSync(packaged)) return packaged;
  return path.join(__dirname,'../bin',name);
}
