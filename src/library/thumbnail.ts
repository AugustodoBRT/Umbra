import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mediaTool } from '../runtime/tools';
export async function makeThumbnail(file: string, target: string, duration: number, signal: AbortSignal) {
  const temporary = `${target}.${randomUUID()}.jpg`;
  try {
    await new Promise<void>((resolve,reject) => {
      const child = spawn(mediaTool('ffmpeg'),['-nostdin','-v','error','-ss',String(Math.min(60,duration/3)),'-i',file,'-frames:v','1','-vf','scale=960:-2','-update','1',temporary],{ signal,windowsHide: true,stdio: 'ignore' });
      const timer = setTimeout(() => child.kill('SIGKILL'),20000);
      child.on('error',error => { clearTimeout(timer); reject(error); });
      child.on('exit',code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Miniatura indisponível.')); });
    });
    signal.throwIfAborted(); await rename(temporary,target);
  } catch (error) { await rm(temporary,{ force: true }).catch(() => {}); if (signal.aborted) throw error; }
}
