import { build } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { electronPath } from './electron-path.mjs';
await build({ entryPoints: ['src/main/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: 'dist/main/main.cjs', external: ['electron'] });
await build({ entryPoints: ['src/main/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: 'dist/main/preload.cjs', external: ['electron'] });
await copyFile('src/downloads/torrent-worker.py','dist/torrent-worker.py');
const server = await createServer();
await server.listen();
const child = spawn(await electronPath(), ['.'], { stdio: 'inherit', env: Object.fromEntries(Object.entries({ ...process.env, CINESSD_DEV_URL: 'http://127.0.0.1:5173' }).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')) });
async function stop() { child.kill(); await server.close(); }
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
