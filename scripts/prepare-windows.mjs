import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'win32') throw new Error('Execute este preparo no Windows x64.');
const provenance = {
  name: 'FFmpeg 9.0.2 / BtbN win64 GPL',
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-03-18-14/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-9.0.zip',
  sha256: '7b5087f26c532ccb8cb17a7bef2ff1ab40aeeb60cc13e7ec14e46b56df1abc49',
  source: 'https://github.com/FFmpeg/FFmpeg/tree/46d8f462ee',
  buildRecipes: 'https://github.com/BtbN/FFmpeg-Builds',
};
const base = path.resolve('packaging/windows'); const cache = path.join(base,'cache');
await mkdir(cache,{ recursive: true }); await mkdir(path.join(base,'bin'),{ recursive: true });
const archive = path.join(cache,'ffmpeg.zip');
let bytes; try { bytes = await readFile(archive); } catch { /* First build. */ }
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== provenance.sha256) {
  const response = await fetch(provenance.url); if (!response.ok) throw new Error(`FFmpeg download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.sha256) throw new Error('Checksum FFmpeg divergente.');
  await writeFile(archive,bytes);
}
const extracted = path.join(cache,'extracted');
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${extracted.replaceAll("'","''")}' -Force`],{ stdio: 'inherit' });
const entries = await readdir(extracted,{ withFileTypes: true }); const folder = entries.find(entry => entry.isDirectory());
if (!folder) throw new Error('Estrutura do FFmpeg inesperada.');
const source = path.join(extracted,folder.name);
for (const tool of ['ffmpeg.exe','ffprobe.exe']) await cp(path.join(source,'bin',tool),path.join(base,'bin',tool));
// Keep the distributor's complete documentation, notices and source/build instructions.
await mkdir(path.join(base,'licenses'),{ recursive: true });
for (const entry of await readdir(source,{ withFileTypes: true })) if (entry.name !== 'bin') await cp(path.join(source,entry.name),path.join(base,'licenses',entry.name),{ recursive: true });
await writeFile(path.join(base,'licenses','ffmpeg-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log('FFmpeg/ffprobe verificados e preparados.');
