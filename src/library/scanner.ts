import { readdir, stat, open, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ScanProgress, MediaTrack } from '../shared/types';
import { Store } from '../storage/store';
import { extensions, identify, ignored } from './identify';
import { relativePath, existingPath, resolvePath } from './paths';
import { makeThumbnail } from './thumbnail';
import { mediaTool } from '../runtime/tools';

export const emptyScan = (): ScanProgress => ({ running: false, phase: 'done', total: 0, processed: 0, added: 0, updated: 0, missing: 0, current: '', errors: [], cancelled: false });
export async function fingerprint(file: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  const stream = createReadStream(file,{ signal });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
export function probe(file: string, signal?: AbortSignal): Promise<{ duration: number; width: number; height: number; videoCodec: string; tracks: MediaTrack[] }> {
  return new Promise((resolve,reject) => {
    const child = spawn(mediaTool('ffprobe'),['-v','error','-show_format','-show_streams','-of','json','--',file],{ signal,windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'),30000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 10_000_000) child.kill(); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(error || 'ffprobe não conseguiu inspecionar este vídeo.')); return; }
      try {
        const data = JSON.parse(output); const video = data.streams?.find((x: any) => x.codec_type === 'video' && !x.disposition?.attached_pic);
        if (!video) throw new Error('Não há faixa de vídeo.');
        resolve({ duration: Number(data.format?.duration || video.duration) || 0, width: video.width || 0, height: video.height || 0, videoCodec: video.codec_name || '', tracks: data.streams.filter((x: any) => ['audio','subtitle'].includes(x.codec_type)).map((x: any) => ({ id: x.index, type: x.codec_type, codec: x.codec_name || '', language: x.tags?.language, title: x.tags?.title })) });
      } catch (e) { reject(e); }
    });
  });
}
export class Scanner {
  state = emptyScan();
  private abort?: AbortController;
  private task?: Promise<void>;
  constructor(private changed: (value: ScanProgress) => void) {}
  private publish() { this.changed({ ...this.state, errors: [...this.state.errors] }); }
  cancel() { this.abort?.abort(); }
  async wait() { await this.task; }
  start(store: Store) {
    if (this.state.running) throw new Error('Uma varredura já está em andamento.');
    if (!store.sources().length) throw new Error('Adicione uma pasta de filmes ou séries primeiro.');
    this.abort = new AbortController();
    this.task = this.run(store,this.abort.signal);
    return this.task;
  }
  private async run(store: Store, signal: AbortSignal) {
    this.state = { ...emptyScan(), running: true, phase: 'discovering' }; this.publish();
    const discovered: string[] = []; const failedSources = new Set<string>();
    try {
      const walk = async (directory: string) => {
        signal.throwIfAborted();
        const entries = await readdir(directory,{ withFileTypes: true });
        for (const item of entries) {
          signal.throwIfAborted();
          if (ignored(item.name) || item.isSymbolicLink() || ['Biblioteca','Apps','$RECYCLE.BIN','System Volume Information'].includes(item.name)) continue;
          const file = path.join(directory,item.name);
          if (item.isDirectory()) await walk(file);
          else if (item.isFile() && extensions.has(path.extname(item.name).toLowerCase())) discovered.push(relativePath(store.root,file));
        }
      };
      for (const source of store.sources()) {
        try { await walk(await existingPath(store.root,source)); }
        catch (e: any) { if (signal.aborted) throw e; failedSources.add(source); this.state.errors.push(`${source}: ${e.message}`); }
      }
      const unique = [...new Set(discovered)]; const present = new Set(unique);
      this.state.total = unique.length; this.state.phase = 'inspecting'; this.publish();
      const rows = store.rows(); const byPath = new Map([...rows].sort((a,b) => Number(a.available)-Number(b.available)).map(x => [x.path,x]));
      const moved = new Set<string>();
      for (const relative of unique) {
        signal.throwIfAborted();
        this.state.current = relative; this.publish();
        try {
          await store.assertDisk();
          const file = await existingPath(store.root,relative); const info = await stat(file); const prior = byPath.get(relative);
          if (prior && prior.size === info.size && Math.abs(prior.mtime - info.mtimeMs) < 1) { store.markPresent(prior.id); }
          else {
            const hash = await fingerprint(file,signal);
            // Only a full content hash AND a uniquely missing old path can transfer an identity.
            const matches = rows.filter(x => x.fingerprint === hash && !present.has(x.path) && !moved.has(x.id));
            let oldId: string | undefined;
            if ((!prior || prior.fingerprint !== hash) && matches.length === 1) {
              try { await access(resolvePath(store.root,matches[0].path)); } catch (e: any) { if (e.code === 'ENOENT') oldId = matches[0].id; }
            }
            const inspection = await probe(file,signal);
            signal.throwIfAborted(); await store.assertDisk();
            const id = store.importFile({ ...inspection, path: relative, size: info.size, mtime: info.mtimeMs, fingerprint: hash, available: true, id: oldId },identify(relative));
            await makeThumbnail(file,path.join(store.directory,'miniaturas',`${id}.jpg`),inspection.duration,signal);
            if (oldId) moved.add(oldId);
            if (prior || oldId) this.state.updated++; else this.state.added++;
          }
        } catch (e: any) {
          if (signal.aborted) throw e;
          await store.assertDisk();
          this.state.errors.push(`${relative}: ${e.message}`);
        }
        this.state.processed++; this.publish();
        await new Promise(resolve => setImmediate(resolve));
      }
      await store.assertDisk(); signal.throwIfAborted();
      const missing = rows.filter(x => !present.has(x.path) && !moved.has(x.id) && ![...failedSources].some(source => source === '.' || x.path === source || x.path.startsWith(`${source}/`)));
      store.markMissing(missing.map(x => x.id)); this.state.missing = missing.length;
    } catch (e: any) { if (signal.aborted) this.state.cancelled = true; else this.state.errors.push(e.message || 'O disco ficou indisponível.'); }
    finally { this.state.running = false; this.state.phase = 'done'; this.state.current = ''; this.publish(); }
  }
}
