import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
if (process.platform !== 'win32') throw new Error('Este teste exige Windows.');
const resources = path.resolve('release/win-unpacked/resources/bin');
const worker = path.join(resources,'torrent/umbra-torrent.exe');
execFileSync(path.join(resources,'mpv/mpv.exe'),['--version'],{stdio:'inherit',windowsHide:true});
execFileSync(worker,['--check'],{ stdio: 'inherit',windowsHide: true });
const directory = mkdtempSync(path.join(tmpdir(),'umbra-worker-'));
try {
  const source = path.join(directory,'Vídeo — ação.partial'),target = path.join(directory,'Vídeo — ação.mp4'); writeFileSync(source,'novo'); writeFileSync(target,'existente');
  const env = { ...process.env,PYTHONIOENCODING: 'cp1252' };
  const result = spawnSync(worker,['--publish'],{ input: JSON.stringify({ source,target })+'\n',encoding: 'utf8',windowsHide: true,env });
  assert.notEqual(result.status,0); assert.equal(readFileSync(target,'utf8'),'existente'); assert.equal(readFileSync(source,'utf8'),'novo');
  const completed = path.join(directory,'Concluído — ação.mp4');
  const published = spawnSync(worker,['--publish'],{ input: JSON.stringify({ source,target: completed })+'\n',encoding: 'utf8',windowsHide: true,env });
  assert.equal(published.status,0,published.stdout+published.stderr);
  assert.equal(readFileSync(completed,'utf8'),'novo'); assert.equal(existsSync(source),false); assert.equal(readFileSync(target,'utf8'),'existente');
} finally { rmSync(directory,{ recursive: true,force: true }); }
process.env.UMBRA_PACKAGED_EXECUTABLE = path.resolve('release/win-unpacked/Umbra.exe');
process.env.CINESSD_FFMPEG = path.join(resources,'ffmpeg.exe'); process.env.CINESSD_FFPROBE = path.join(resources,'ffprobe.exe');
await import('./player-desktop-test');
await import('./online-desktop-test');
