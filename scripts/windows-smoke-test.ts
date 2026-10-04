import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
if (process.platform !== 'win32') throw new Error('Este teste exige Windows.');
const resources = path.resolve('release/win-unpacked/resources/bin');
const worker = path.join(resources,'torrent/umbra-torrent.exe');
execFileSync(worker,['--check'],{ stdio: 'inherit',windowsHide: true });
const directory = mkdtempSync(path.join(tmpdir(),'umbra-worker-'));
try {
  const source = path.join(directory,'source'),target = path.join(directory,'target'); writeFileSync(source,'novo'); writeFileSync(target,'existente');
  const result = spawnSync(worker,['--publish'],{ input: JSON.stringify({ source,target })+'\n',encoding: 'utf8',windowsHide: true });
  assert.notEqual(result.status,0); assert.equal(readFileSync(target,'utf8'),'existente'); assert.equal(readFileSync(source,'utf8'),'novo');
} finally { rmSync(directory,{ recursive: true,force: true }); }
process.env.UMBRA_PACKAGED_EXECUTABLE = path.resolve('release/win-unpacked/Umbra.exe');
process.env.CINESSD_FFMPEG = path.join(resources,'ffmpeg.exe'); process.env.CINESSD_FFPROBE = path.join(resources,'ffprobe.exe');
await import('./player-desktop-test');
