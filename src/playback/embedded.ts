import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, type ReadStream } from 'node:fs';
import { readdir, stat, lstat, realpath } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { MediaFile, MediaTrack, PlayerState } from '../shared/types';
import type { Store } from '../storage/store';
import { existingPath } from '../library/paths';
import { mediaTool } from '../runtime/tools';

export const emptyPlayer = (): PlayerState => ({ active: false,fileId: null,title: '',position: 0,duration: 0,paused: false,volume: 80,speed: 1,tracks: [],audio: 'auto',subtitle: 'no',fullscreen: false });
const bitmap = new Set(['hdmv_pgs_subtitle','dvd_subtitle','dvb_subtitle','xsub']);
const mime = 'video/mp4';
export class EmbeddedPlayer {
  state = emptyPlayer();
  private store?: Store;
  private file?: MediaFile;
  private absolute = '';
  private session?: string;
  private watched = 0;
  private lastTick = 0;
  private lastSave = 0;
  private starting = false;
  private external = new Map<number,string>();
  private converters = new Set<ChildProcess>();
  private files = new Set<ReadStream>();
  constructor(private changed: (state: PlayerState) => void) {}
  private publish() { this.changed({ ...this.state,tracks: [...this.state.tracks] }); }
  async play(store: Store,id: string,restart = false) {
    if (this.starting) throw new Error('O player está sendo iniciado.');
    this.starting = true;
    try {
      await this.stop(); await store.assertDisk();
      const file = store.file(id);
      if (!file.available || !store.sources().some(source => source === '.' || file.path.startsWith(`${source}/`))) throw new Error('Este vídeo não está disponível em uma pasta autorizada.');
      this.absolute = await existingPath(store.root,file.path); this.file = file; this.store = store;
      const tracks = [...file.tracks];
      const stem = path.basename(this.absolute,path.extname(this.absolute));
      for (const entry of (await readdir(path.dirname(this.absolute))).slice(0,10000)) {
        if (!entry.startsWith(`${stem}.`) || !/\.(srt|vtt|ass|ssa)$/i.test(entry)) continue;
        const absolute = path.join(path.dirname(this.absolute),entry);
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8_000_000 || await realpath(absolute) !== absolute) continue;
        const trackId = 100000+this.external.size;
        this.external.set(trackId,absolute);
        tracks.push({ id: trackId,type: 'subtitle',codec: path.extname(entry).slice(1),title: entry });
      }
      this.session = store.startSession(id); this.watched = 0; this.lastTick = performance.now(); this.lastSave = Date.now();
      this.state = { ...emptyPlayer(),active: true,fileId: id,title: path.basename(file.path),position: restart || file.completed ? 0 : Math.min(file.position,Math.max(0,file.duration-.1)),duration: file.duration,tracks };
      const preferences = store.playbackPreferences(id);
      for (const [type,key] of [['audio','audio'],['subtitle','subtitle']] as const) {
        try {
          const saved = JSON.parse(preferences?.[key] ?? 'null');
          const track = tracks.find(track => track.type === type && (track.language ?? '') === saved?.language && (track.title ?? '') === saved?.title);
          if (track && !saved?.off) this.state[key] = track.id;
        } catch { /* Older preferences may use another format. */ }
      }
      this.source(); this.publish();
    } catch (error) { await this.stop(); throw error; }
    finally { this.starting = false; }
  }
  private source() {
    this.killConverters();
    for (const stream of this.files) stream.destroy();
    const file = this.file!;
    const audio = this.state.tracks.filter(track => track.type === 'audio');
    const subtitle = this.state.tracks.find(track => track.type === 'subtitle' && track.id === this.state.subtitle);
    const native = /\.(mp4|m4v|mov)$/i.test(file.path) && file.videoCodec === 'h264' && audio.length <= 1 && audio.every(track => track.codec === 'aac') && !bitmap.has(subtitle?.codec ?? '');
    const token = randomUUID();
    this.state.source = { token,mode: native ? 'file' : 'stream',url: `cinessd://media/${token}/${native ? 'file.mp4' : 'stream.mp4'}`,start: this.state.position,subtitleUrl: subtitle && !bitmap.has(subtitle.codec) ? `cinessd://media/${token}/subtitle/${subtitle.id}.vtt` : undefined };
    this.lastTick = performance.now();
  }
  async control(action: string,value?: number|string) {
    if (action === 'stop') { await this.stop(); return; }
    if (!this.state.active) throw new Error('Abra um vídeo antes de usar os controles.');
    if (action === 'pause') this.state.paused = !this.state.paused;
    else if (action === 'seek') { this.save(false); this.state.position = Math.max(0,Math.min(Number(value),Math.max(0,this.state.duration-.05))); this.source(); }
    else if (action === 'volume') this.state.volume = Number(value);
    else if (action === 'speed') this.state.speed = Number(value);
    else if (action === 'fullscreen') this.state.fullscreen = !this.state.fullscreen;
    else if (action === 'audio' || action === 'subtitle') {
      const type = action === 'audio' ? 'audio' : 'subtitle';
      if (typeof value === 'number' && !this.state.tracks.some(track => track.type === type && track.id === value)) throw new Error('Faixa não encontrada neste vídeo.');
      if (value === 'no' && action === 'audio') throw new Error('Selecione uma faixa de áudio.');
      this.state[action] = value!; this.save(false); this.source();
    } else throw new Error('Controle inválido.');
    this.publish();
  }
  async report(token: string,position: number,ended: boolean,error = false) {
    if (!this.state.active || this.state.source?.token !== token) return;
    if (error) { this.state.error = 'Não foi possível reproduzir este vídeo. Confira o arquivo e o FFmpeg em Configurações.'; this.state.paused = true; this.killConverters(); this.publish(); return; }
    const now = performance.now(); const elapsed = Math.min(2,(now-this.lastTick)/1000); this.lastTick = now;
    const next = Math.max(0,Math.min(position,this.state.duration)); const advance = next-this.state.position;
    if (!this.state.paused && advance > 0 && advance < elapsed*this.state.speed+2) this.watched += Math.min(elapsed,advance/this.state.speed);
    this.state.position = ended ? this.state.duration : next;
    if (Date.now()-this.lastSave >= 3000 || ended) { this.lastSave = Date.now(); this.save(ended); }
    if (ended) await this.stop(); else this.publish();
  }
  private descriptor(type: MediaTrack['type'],id: string|number) {
    if (id === 'no') return JSON.stringify({ off: true });
    const track = this.state.tracks.find(track => track.type === type && (id === 'auto' || track.id === id));
    return track ? JSON.stringify({ language: track.language ?? '',title: track.title ?? '' }) : undefined;
  }
  private save(ended: boolean) {
    if (!this.store || this.store.closed || !this.session || !this.state.fileId) return;
    try { this.store.progress(this.state.fileId,this.session,this.state.position,this.state.duration,this.watched,ended,this.descriptor('audio',this.state.audio),this.descriptor('subtitle',this.state.subtitle)); }
    catch { this.state.error = 'Não foi possível salvar o progresso. Verifique sua biblioteca.'; }
  }
  async checkpoint() {
    if (!this.store || !this.state.active) return;
    await this.store.assertDisk(); this.save(false);
    if (this.state.error) throw new Error(this.state.error);
  }
  private killConverters() { for (const child of this.converters) { child.stdout?.destroy(); child.kill('SIGKILL'); } }
  async stop() {
    this.save(true);
    // Release video handles before callers move or delete files, including on Windows.
    await Promise.all([...this.files].map(stream => new Promise<void>(resolve => {
      if (stream.closed) { resolve(); return; }
      stream.once('close',() => resolve()); stream.destroy();
    })).concat([...this.converters].map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('close',() => resolve()); child.stdout?.destroy(); child.kill('SIGKILL');
    }))));
    this.store = undefined; this.file = undefined; this.session = undefined; this.external.clear(); this.absolute = '';
    this.state = emptyPlayer(); this.publish();
  }
  private converter(args: string[]) {
    const child = spawn(mediaTool('ffmpeg'),['-nostdin','-hide_banner','-v','error',...args],{ windowsHide: true,stdio: ['ignore','pipe','ignore'] });
    this.converters.add(child); child.once('exit',() => this.converters.delete(child));
    child.on('error',() => { child.stdout.destroy(new Error('FFmpeg indisponível.')); });
    return child;
  }
  async response(request: Request): Promise<Response> {
    const url = new URL(request.url); const source = this.state.source;
    if (!source || !this.store || !this.state.active || !['GET','HEAD'].includes(request.method) || !url.pathname.startsWith(`/${source.token}/`)) return new Response('',{ status: 404 });
    await this.store.assertDisk();
    if (this.state.source?.token !== source.token) return new Response('',{ status: 404 });
    const headers = { 'cache-control': 'no-store','x-content-type-options': 'nosniff','access-control-allow-origin': request.headers.get('origin') === 'http://127.0.0.1:5173' ? 'http://127.0.0.1:5173' : 'cinessd://app' };
    if (url.pathname === `/${source.token}/file.mp4` && source.mode === 'file') {
      const size = (await stat(this.absolute)).size;
      const range = request.headers.get('range');
      let start = 0,end = size-1;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || !match[1] && !match[2]) return new Response('',{ status: 416,headers: { 'content-range': `bytes */${size}` } });
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end,Number(match[2])); }
        else start = Math.max(0,size-Number(match[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response('',{ status: 416,headers: { 'content-range': `bytes */${size}` } });
      }
      let body: ReadableStream | null = null;
      if (request.method !== 'HEAD') {
        const stream = createReadStream(this.absolute,{ start,end }); this.files.add(stream);
        const cancel = () => stream.destroy(); request.signal.addEventListener('abort',cancel,{ once: true });
        stream.once('close',() => { this.files.delete(stream); request.signal.removeEventListener('abort',cancel); });
        body = Readable.toWeb(stream) as ReadableStream;
      }
      return new Response(body,{ status: range ? 206 : 200,headers: { ...headers,'content-type': mime,'accept-ranges': 'bytes','content-length': String(end-start+1),...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) } });
    }
    if (url.pathname === `/${source.token}/stream.mp4` && source.mode === 'stream') {
      if (request.method === 'HEAD') return new Response(null,{ headers: { ...headers,'content-type': mime } });
      const args = ['-ss',String(source.start),'-i',this.absolute];
      const subtitle = this.state.tracks.find(track => track.id === this.state.subtitle && track.type === 'subtitle');
      const scale = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
      if (subtitle && bitmap.has(subtitle.codec)) args.push('-filter_complex',`[0:v:0][0:${subtitle.id}]overlay=eof_action=pass,${scale}[v]`,'-map','[v]');
      else args.push('-map','0:v:0');
      if (!subtitle || !bitmap.has(subtitle.codec)) args.push('-vf',scale);
      args.push('-map',this.state.audio === 'auto' ? '0:a:0?' : `0:${this.state.audio}`,'-sn','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-profile:v','main','-level:v','4.2','-g','48','-threads','2','-c:a','aac','-ac','2','-b:a','192k','-movflags','frag_keyframe+empty_moov+default_base_moof','-frag_duration','1000000','-f','mp4','pipe:1');
      const child = this.converter(args);
      const cancel = () => child.kill('SIGKILL'); request.signal.addEventListener('abort',cancel,{ once: true });
      child.once('exit',() => request.signal.removeEventListener('abort',cancel));
      return new Response(Readable.toWeb(child.stdout) as ReadableStream,{ headers: { ...headers,'content-type': mime } });
    }
    const subtitleId = url.pathname.match(new RegExp(`^/${source.token}/subtitle/(\\d+)\\.vtt$`))?.[1];
    const track = this.state.tracks.find(track => track.id === Number(subtitleId) && track.type === 'subtitle');
    if (subtitleId && track && !bitmap.has(track.codec)) {
      const external = this.external.get(track.id);
      const child = this.converter(['-i',external ?? this.absolute,'-map',external ? '0:0' : `0:${track.id}`,'-f','webvtt','pipe:1']);
      let value = ''; for await (const chunk of child.stdout) { value += chunk; if (value.length > 8_000_000) { child.kill('SIGKILL'); throw new Error('Legenda grande demais.'); } }
      if (source.mode === 'stream') value = shiftWebVTT(value,source.start);
      return new Response(value,{ headers: { ...headers,'content-type': 'text/vtt; charset=utf-8' } });
    }
    return new Response('',{ status: 404 });
  }
}
export function shiftWebVTT(value: string,offset: number) {
  const seconds = (value: string) => value.split(':').reduce((sum,part) => sum*60+Number(part),0);
  const stamp = (value: number) => { const ms = Math.max(0,Math.round(value*1000)); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; };
  return value.split(/\r?\n\r?\n/).filter(block => { const match = block.match(/(\d{2}:\d{2}(?::\d{2})?\.\d{3}) --> (\d{2}:\d{2}(?::\d{2})?\.\d{3})/); return !match || seconds(match[2]) > offset; }).map(block => block.replace(/(\d{2}:\d{2}(?::\d{2})?\.\d{3}) --> (\d{2}:\d{2}(?::\d{2})?\.\d{3})/g,(_,start,end) => `${stamp(seconds(start)-offset)} --> ${stamp(seconds(end)-offset)}`)).join('\n\n');
}
