import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, realpath, readFile, open, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { relativePath } from '../library/paths';
import { Credentials } from '../storage/credentials';
import type { BoundSource, RawSource } from '../online/addons';
import { transportURL } from '../online/addons';
import type { DownloadJob } from '../shared/online';

export const safeName = (value: string) => {
  let name = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/^[. ]+/,'').replace(/[. ]+$/,'').slice(0,140).replace(/[. ]+$/,'');
  if (!name || /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(name)) name = `Título ${name || 'sem nome'}`;
  return name;
};
export function destination(item: BoundSource['item'],video: BoundSource['video']) {
  const name = safeName(item.name); const year = item.year.match(/^\d{4}/)?.[0]; const folder = `${name}${year ? ` (${year})` : ''}`;
  if (item.type === 'movie') return { relative: path.join('Filmes',folder),prefix: folder };
  if (!video) throw new Error('Escolha um episódio antes de baixar.');
  const season = String(video.season).padStart(2,'0'),episode = String(video.episode).padStart(2,'0');
  return { relative: path.join('Series',folder,`Temporada ${season}`),prefix: `${name.slice(0,110)}${year ? ` (${year})` : ''} - S${season}E${episode}` };
}
interface StoredJob extends DownloadJob { raw: RawSource; libraryId: string; filePrefix: string; resume?: string; partial?: string }
interface ActiveDownload { id: string; child?: ChildProcess; controller?: AbortController; done: Promise<void> }
const storedSchema = z.object({ version: z.literal(1),jobs: z.array(z.object({ id: z.string().uuid(),title: z.string(),itemName: z.string(),sourceName: z.string(),season: z.number().optional(),episode: z.number().optional(),state: z.enum(['queued','metadata','downloading','paused','completed','error','cancelled']),downloaded: z.number(),total: z.number(),speed: z.number(),peers: z.number(),root: z.string(),directory: z.string(),fileName: z.string(),error: z.string().optional(),createdAt: z.string(),raw: z.object({ url: z.string().optional(),infoHash: z.string().optional(),fileIdx: z.number().optional(),sources: z.array(z.string()).optional(),behaviorHints: z.object({ filename: z.string().optional(),proxyHeaders: z.object({ request: z.record(z.string(),z.string()).optional() }).optional() }).optional() }),libraryId: z.string().uuid(),filePrefix: z.string(),resume: z.string().optional(),partial: z.string().optional() })).max(10000) });

export class Downloads {
  private jobs: StoredJob[] = [];
  private active?: ActiveDownload;
  private closing = false;
  private checking = false;
  private timer?: NodeJS.Timeout;
  private persistChain = Promise.resolve();
  private lastPersist = 0;
  private initialized = false;
  available = false;
  constructor(private credentials: Credentials,private worker: string,private changed: () => void,private complete: (root: string) => void,private python = process.env.CINESSD_PYTHON || (process.platform === 'linux' ? '/usr/bin/python' : 'python')) {}
  static async torrentAvailable(python = process.env.CINESSD_PYTHON || (process.platform === 'linux' ? '/usr/bin/python' : 'python')) {
    return await new Promise<boolean>(resolve => { const child = spawn(python,['-c','import libtorrent; assert hasattr(libtorrent,"session")'],{ stdio: 'ignore' }); child.on('error',() => resolve(false)); child.on('exit',code => resolve(code === 0)); setTimeout(() => { child.kill(); resolve(false); },3000).unref(); });
  }
  async initialize() {
    this.available = this.worker.endsWith('.exe') ? await new Promise<boolean>(resolve => {
      const child = spawn(this.worker,['--check'],{ windowsHide: true,stdio: 'ignore' });
      child.on('error',() => resolve(false)); child.on('exit',code => resolve(code === 0)); setTimeout(() => { child.kill(); resolve(false); },5000).unref();
    }) : await Downloads.torrentAvailable(this.python);
    const saved = await this.credentials.loadDocument('downloads');
    this.jobs = saved === null ? [] : storedSchema.parse(saved).jobs;
    this.initialized = true;
    for (const job of this.jobs) { job.speed = 0; job.peers = 0; if (['metadata','downloading','queued'].includes(job.state)) { job.state = 'paused'; job.error = 'Download interrompido ao fechar. Clique em Retomar.'; } }
    this.timer = setInterval(() => { void this.checkDisk(); },2000);
  }
  list(): DownloadJob[] { return this.jobs.map(({ raw,libraryId,filePrefix,resume,partial,...publicJob }) => ({ ...publicJob })).reverse(); }
  assertNoPendingWork(root: string,title: string,originalTitle: string | undefined,paths: string[],series: boolean) {
    const names = [title,originalTitle].filter(Boolean).map(name => name!.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase());
    const directories = series ? [...new Set(paths.filter(file => /^(series|séries)\//i.test(file)).map(file => file.split('/').slice(0,2).join('/')))] : [];
    const pending = this.jobs.some(job => job.root === root && !['completed','cancelled'].includes(job.state) && (
      names.includes(job.itemName.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()) ||
      paths.includes(relativePath(root,path.join(job.directory,job.fileName))) ||
      directories.some(directory => relativePath(root,job.directory).startsWith(`${directory}/`))));
    if (pending) throw new Error('Cancele os downloads pendentes deste título na tela Downloads antes de excluí-lo.');
  }
  async forgetRemovedFiles(root: string,paths: string[]) {
    const removed = this.jobs.filter(job => job.root === root && job.state === 'completed' && paths.includes(relativePath(root,path.join(job.directory,job.fileName))));
    if (!removed.length) return;
    this.jobs = this.jobs.filter(job => !removed.includes(job));
    await this.persist(); this.publish();
  }
  private publish(save = false) { this.changed(); if (save || Date.now()-this.lastPersist > 5000) { this.lastPersist = Date.now(); void this.persist().catch(() => { const job = this.jobs.find(j => j.id === this.active?.id); if (job) { job.error = 'Não foi possível salvar a fila neste computador.'; this.changed(); } }); } }
  private persist() {
    const value = JSON.parse(JSON.stringify({ version: 1,jobs: this.jobs }));
    const task = this.persistChain.then(() => this.credentials.saveDocument('downloads',value));
    this.persistChain = task.catch(() => {}); return task;
  }
  private async assertRoot(job: Pick<StoredJob,'root'|'libraryId'>) {
    if (await realpath(job.root) !== job.root) throw new Error('A pasta de download mudou. Reconecte o SSD.');
    const manifest = JSON.parse(await readFile(path.join(job.root,'Biblioteca','biblioteca.json'),'utf8'));
    if (manifest.id !== job.libraryId) throw new Error('O SSD de destino foi trocado. Reconecte a biblioteca original.');
  }
  async enqueue(sources: BoundSource[],root: string,libraryId: string) {
    if (!this.initialized) throw new Error('A fila salva não pôde ser recuperada. Os arquivos foram preservados.');
    await this.assertRoot({ root,libraryId });
    const planned = sources.map(source => {
      if (source.raw.infoHash && !this.available) throw new Error('O motor de torrents não está disponível. Confira a tela de Downloads.');
      const target = destination(source.item,source.video); const directory = path.join(root,target.relative); relativePath(root,directory);
      const filePrefix = safeName(target.prefix);
      return { id: randomUUID(),title: source.video ? `${source.item.name} · T${source.video.season} E${source.video.episode}` : source.item.name,itemName: source.item.name,sourceName: `${source.summary.addonName} · ${source.summary.name}`,season: source.video?.season,episode: source.video?.episode,state: 'queued' as const,downloaded: 0,total: 0,speed: 0,peers: 0,root,directory,fileName: '',error: undefined,createdAt: new Date().toISOString(),raw: source.raw,libraryId,filePrefix };
    });
    for (const job of planned) {
      if ([...this.jobs,...planned.filter(j => j.id !== job.id)].some(j => j.root === root && j.directory === job.directory && j.filePrefix === job.filePrefix && !['error','cancelled'].includes(j.state))) throw new Error(`Este título já está na fila ou foi baixado: ${job.title}.`);
    }
    this.jobs.push(...planned);
    try { await this.persist(); } catch (error) { this.jobs = this.jobs.filter(j => !planned.includes(j as typeof planned[number])); throw error; }
    this.publish(); this.pump();
  }
  private pump() {
    if (this.active || this.closing) return;
    const job = this.jobs.find(j => j.state === 'queued'); if (!job) return;
    const running: ActiveDownload = { id: job.id,done: Promise.resolve() }; this.active = running;
    running.done = this.run(job,running).catch(error => { if (!['paused','cancelled'].includes(job.state)) { job.state = 'error'; job.error = error.message; } }).finally(async () => {
      if (job.state === 'completed') { job.resume = undefined; job.raw = {}; }
      job.speed = 0; job.peers = 0; this.publish(true); if (job.state === 'completed') this.complete(job.root);
      if (this.active === running) this.active = undefined; this.pump();
    });
  }
  private async run(job: StoredJob,running: NonNullable<Downloads['active']>) {
    try { await this.assertRoot(job); } catch { throw new Error('A pasta de destino está indisponível. Reconecte o SSD e retome o download.'); }
    const relative = relativePath(job.root,job.directory);
    let directory = job.root;
    for (const component of relative.split(path.sep)) {
      directory = path.join(directory,component);
      try { await mkdir(directory); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      const actual = await realpath(directory); relativePath(job.root,actual);
      if (actual !== directory) throw new Error('A pasta de destino contém um link. Escolha outra pasta.');
    }
    if (['paused','cancelled'].includes(job.state)) return;
    if (job.raw.infoHash) await this.torrent(job,running); else await this.http(job,running);
  }
  private async torrent(job: StoredJob,running: NonNullable<Downloads['active']>) {
    const hash = z.string().regex(/^[a-f\d]{40}$/i).parse(job.raw.infoHash);
    const magnet = new URL('magnet:?'); magnet.searchParams.set('xt',`urn:btih:${hash}`);
    for (const source of job.raw.sources ?? []) if (source.startsWith('tracker:')) {
      const tracker = source.slice(8); if (/^(https?|udp|wss?):\/\//.test(tracker)) magnet.searchParams.append('tr',tracker);
    }
    job.state = 'metadata'; this.publish(true);
    await new Promise<void>((resolve,reject) => {
      const child = spawn(this.worker.endsWith('.exe') ? this.worker : this.python,this.worker.endsWith('.exe') ? [] : ['-u',this.worker],{ windowsHide: true,stdio: ['pipe','pipe','ignore'] }); running.child = child;
      let buffer = ''; let completed = false; let failure: string | undefined;
      child.on('error',() => reject(new Error('Não foi possível iniciar o motor de torrents.')));
      child.stdin?.on('error',() => {});
      child.stdout?.on('data',chunk => {
        buffer += chunk.toString(); if (buffer.length > 16_000_000) { child.kill(); failure = 'Resposta inválida do motor de torrents.'; return; }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
          try {
            const event = JSON.parse(line);
            if (event.event === 'status' && !['paused','cancelled'].includes(job.state)) { job.state = event.state === 'metadata' ? 'metadata' : 'downloading'; for (const key of ['downloaded','total','speed','peers'] as const) if (Number.isFinite(event[key]) && event[key] >= 0) job[key] = event[key]; this.publish(); }
            if (event.event === 'file' && path.basename(event.fileName) === event.fileName) { job.fileName = event.fileName; this.publish(true); }
            if (event.event === 'resume' && typeof event.data === 'string' && event.data.length < 12_000_000) { job.resume = event.data; this.publish(true); }
            if (event.event === 'complete') completed = true;
            if (event.event === 'error') failure = typeof event.message === 'string' ? event.message : 'Falha no torrent.';
          } catch { /* Ignore malformed worker output. */ }
        }
      });
      child.on('exit',code => {
        if (completed) { job.state = 'completed'; job.error = undefined; resolve(); }
        else if (['paused','cancelled'].includes(job.state)) resolve();
        else reject(new Error(failure ?? (code === 0 ? 'Download interrompido. Retome para continuar.' : 'O motor de torrents encerrou antes de concluir.')));
      });
      child.stdin!.write(`${JSON.stringify({ id: job.id,directory: job.directory,filePrefix: job.filePrefix,magnet: magnet.href,fileIdx: job.raw.fileIdx,resume: job.resume,season: job.season,episode: job.episode })}\n`);
    });
  }
  private async publishFile(source: string,target: string) {
    await new Promise<void>((resolve,reject) => {
      const child = spawn(this.worker.endsWith('.exe') ? this.worker : this.python,this.worker.endsWith('.exe') ? ['--publish'] : ['-u',this.worker,'--publish'],{ windowsHide: true,stdio: ['pipe','ignore','ignore'] });
      child.on('error',() => reject(new Error('Não foi possível concluir o arquivo.')));
      child.stdin?.on('error',() => {}); child.stdin!.end(`${JSON.stringify({ source,target })}\n`);
      child.on('exit',code => code === 0 ? resolve() : reject(new Error('O arquivo de destino já existe ou não foi possível concluir o download.')));
    });
  }
  private async http(job: StoredJob,running: NonNullable<Downloads['active']>) {
    const url = transportURL(job.raw.url ?? '');
    const hinted = job.raw.behaviorHints?.filename ?? decodeURIComponent(url.pathname);
    const extension = hinted.match(/\.(mkv|mp4|avi|webm|m4v|mov|ts|m2ts)$/i)?.[0]?.toLowerCase() ?? '.mp4';
    job.fileName = `${job.filePrefix}${extension}`;
    const target = path.join(job.directory,job.fileName); const partial = path.join(job.directory,`.cinessd-${job.id}.partial`);
    try { await access(target); throw new Error('O vídeo de destino já existe. Ele foi preservado.'); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    running.controller = new AbortController();
    let offset = 0; try { offset = (await stat(partial)).size; } catch { /* New download. */ }
    const headers = new Headers(job.raw.behaviorHints?.proxyHeaders?.request ?? {}); headers.set('Accept-Encoding','identity'); if (offset) headers.set('Range',`bytes=${offset}-`);
    let response: Response;
    try { response = await fetch(url,{ headers,signal: running.controller.signal }); } catch { throw new Error('Não foi possível abrir esta fonte de download.'); }
    if (response.status === 416 && offset > 0 && response.headers.get('content-range') === `bytes */${offset}`) { await this.assertRoot(job); await this.publishFile(partial,target); job.downloaded = offset; job.total = offset; job.state = 'completed'; return; }
    if (!response.ok || !response.body) throw new Error('Esta fonte não permitiu baixar o arquivo. Tente outra opção.');
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (/mpegurl|dash\+xml/.test(contentType)) { await response.body.cancel(); throw new Error('Esta fonte usa transmissão adaptativa. Escolha um torrent ou um arquivo de vídeo direto.'); }
    if (contentType.includes('text/') || contentType.includes('application/json')) { await response.body.cancel(); throw new Error('A fonte retornou uma página de erro em vez do vídeo.'); }
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) !== offset) { await response.body.cancel(); throw new Error('A fonte retornou um intervalo inválido para retomar o arquivo.'); }
      job.total = Number(range[3]);
    } else { offset = 0; job.total = Number(response.headers.get('content-length')) || 0; }
    const handle = await open(partial,constants.O_WRONLY | constants.O_CREAT | (offset ? constants.O_APPEND : constants.O_TRUNC) | (constants.O_NOFOLLOW ?? 0),0o600);
    job.state = 'downloading'; job.downloaded = offset; job.error = undefined; this.publish(true);
    const reader = response.body.getReader(); let tick = Date.now(),bytes = offset;
    try {
      while (true) {
        const { done,value } = await reader.read(); if (done) break;
        let written = 0; while (written < value.length) { const result = await handle.write(value,written,value.length-written); if (!result.bytesWritten) throw new Error('Falha ao gravar o arquivo.'); written += result.bytesWritten; }
        job.downloaded += value.length;
        if (Date.now()-tick >= 500) { job.speed = (job.downloaded-bytes)*1000/(Date.now()-tick); tick = Date.now(); bytes = job.downloaded; this.publish(); }
      }
      await handle.sync();
    } catch { if (!['paused','cancelled'].includes(job.state)) throw new Error('A transferência foi interrompida. Retome o download para continuar.'); return; }
    finally { await handle.close(); reader.releaseLock(); }
    if (['paused','cancelled'].includes(job.state)) return;
    if (job.total && job.downloaded !== job.total) throw new Error('O download terminou incompleto. Retome para continuar.');
    await this.assertRoot(job); await this.publishFile(partial,target); job.total ||= job.downloaded; job.state = 'completed'; job.error = undefined;
  }
  async control(action: 'pause'|'resume'|'cancel',id: string) {
    const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('Download não encontrado.');
    if (job.state === 'completed') throw new Error('Este download já está concluído.');
    if (action === 'resume') { if (job.state === 'cancelled') throw new Error('Este download foi cancelado. Escolha a fonte novamente.'); if (['queued','metadata','downloading'].includes(job.state)) return; await this.assertRoot(job); job.state = 'queued'; job.error = undefined; await this.persist(); this.publish(); this.pump(); return; }
    job.state = action === 'pause' ? 'paused' : 'cancelled'; job.speed = 0;
    const active = this.active;
    if (active?.id === id) { active.controller?.abort(); active.child?.stdin?.write('{"action":"stop"}\n'); const timer = setTimeout(() => active.child?.kill(),6000); try { await active.done; } finally { clearTimeout(timer); } }
    if (action === 'cancel') { job.resume = undefined; job.raw = {}; }
    await this.persist(); this.publish();
  }
  private async checkDisk() {
    if (!this.active || this.checking) return; this.checking = true;
    try { const job = this.jobs.find(j => j.id === this.active?.id); if (!job) return; try { await this.assertRoot(job); } catch { job.error = 'O SSD ficou indisponível. Reconecte e retome o download.'; await this.control('pause',job.id); } }
    finally { this.checking = false; }
  }
  async close() {
    if (!this.initialized) return;
    this.closing = true; if (this.timer) clearInterval(this.timer);
    if (this.active) await this.control('pause',this.active.id);
    await this.persist(); await this.persistChain;
  }
  async pauseRoot(root: string) {
    const jobs = this.jobs.filter(j => j.root === root && ['queued','metadata','downloading'].includes(j.state));
    for (const job of jobs) if (job.id !== this.active?.id) job.state = 'paused';
    if (this.active && jobs.some(j => j.id === this.active!.id)) await this.control('pause',this.active.id);
    if (jobs.length) { await this.persist(); this.publish(); }
  }
}
