import { spawn } from 'node:child_process';
import { electronPath } from './electron-path.mjs';
const child = spawn(await electronPath(), ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')) });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
