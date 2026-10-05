import { execFileSync } from 'node:child_process';
import { mkdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
if (!['linux','win32'].includes(process.platform)) throw new Error('A superfície mpv suporta Linux X11/XWayland e Windows.');
const build = path.resolve('.local/player-host-build');
execFileSync('cmake',['-S','packaging/player-host','-B',build],{ stdio: 'inherit' });
execFileSync('cmake',['--build',build,'--config','Release'],{ stdio: 'inherit' });
await mkdir('dist/bin',{ recursive: true });
await copyFile(path.join(build,process.platform === 'win32' ? 'Release/umbra-player-host.exe' : 'umbra-player-host'),path.resolve('dist/bin',process.platform === 'win32' ? 'umbra-player-host.exe' : 'umbra-player-host'));
if(process.platform==='win32'){
  await mkdir('packaging/windows/bin',{recursive:true});
  await copyFile('dist/bin/umbra-player-host.exe','packaging/windows/bin/umbra-player-host.exe');
}
