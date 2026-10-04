import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/storage/store';
export async function library() { const root = await mkdtemp(path.join(tmpdir(),'cinessd-test-')); await mkdir(path.join(root,'Filmes')); const store = await Store.open(root); store.addSource(path.join(root,'Filmes')); return { root,store }; }
export function media(file: string, color = 'navy', duration = 5) { execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180:r=15:d=${duration}`,'-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-c:v','mpeg4','-c:a','aac','-shortest',file]); }
export async function until(test: () => boolean | Promise<boolean>, timeout = 8000) { const end = Date.now()+timeout; while (!(await test())) { if (Date.now()>end) throw new Error('A condição de teste não foi atingida a tempo.'); await new Promise(resolve => setTimeout(resolve,40)); } }
