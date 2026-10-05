import { spawn,type ChildProcess } from 'node:child_process';
import { mkdtemp,readdir,lstat,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { Store } from '../storage/store';
import type { MediaTrack,PlayerState,PlayerBounds } from '../shared/types';
import type { SubtitleAppearance } from '../shared/subtitles';
import { existingPath } from '../library/paths';
import { emptyPlayer } from './embedded';
import { MpvIPC } from './mpv-ipc';

interface Options { mpv: string; host: string; parent: () => string; appearance: () => SubtitleAppearance; input: (action: string) => void; headless?: boolean }
export class NativePlayer {
  state: PlayerState = emptyPlayer();
  private store?: Store;
  private session?: string;
  private watched=0; private position=0; private tick=0; private saved=0;
  private process?: ChildProcess; private surface?: ChildProcess; private ipc?: MpvIPC;
  private directory=''; private generation=0; private timer?: NodeJS.Timeout;
  private starting=false; private stopping?: Promise<void>; private bounds?: PlayerBounds;
  private lastInput=0;
  private codec='';
  private ignorePointerUntil=0;
  constructor(private changed: (value: PlayerState) => void,private options: Options) {}
  private publish() { this.changed({ ...this.state,tracks: [...this.state.tracks] }); }
  setFullscreen(fullscreen: boolean) { if(this.state.active && this.state.fullscreen!==fullscreen){this.state.fullscreen=fullscreen;this.publish();} }
  boundsChanged(bounds: PlayerBounds) {
    // Native resize events may synthesize pointer movement at a stationary cursor.
    // Do not let those events immediately reveal controls that just hid.
    this.ignorePointerUntil=performance.now()+250;
    this.bounds=bounds;
    this.surface?.stdin?.write(`bounds ${Math.round(bounds.x*bounds.scale)} ${Math.round(bounds.y*bounds.scale)} ${Math.max(1,Math.round(bounds.width*bounds.scale))} ${Math.max(1,Math.round(bounds.height*bounds.scale))} ${bounds.visible ? 1 : 0}\n`);
  }
  private save(ended=false) {
    if(!this.store || this.store.closed || !this.session || !this.state.fileId) return;
    const descriptor=(type: MediaTrack['type'],id: string|number) => {
      if(id==='no') return JSON.stringify({ off: true });
      const track=this.state.tracks.find(track => track.type===type && (id==='auto' || track.id===id));
      return track ? JSON.stringify({ language: track.language ?? '',title: track.title ?? '' }) : undefined;
    };
    try { this.store.progress(this.state.fileId,this.session,this.state.position,this.state.duration,this.watched,ended,descriptor('audio',this.state.audio),descriptor('subtitle',this.state.subtitle)); }
    catch { this.state.error='Não foi possível salvar o progresso. Verifique sua biblioteca.'; }
  }
  private sample() {
    const now=performance.now(), elapsed=Math.min(2,(now-this.tick)/1000), advance=this.state.position-this.position;
    if(!this.state.paused && advance>0 && advance<elapsed*this.state.speed+2) this.watched+=Math.min(elapsed,advance/this.state.speed);
    this.tick=now;this.position=this.state.position;
    if(Date.now()-this.saved>=3000){this.saved=Date.now();this.save();}
    this.publish();
  }
  private event(event: any,generation: number) {
    if(generation!==this.generation || !this.state.active) return;
    if(event.event==='property-change') {
      const value=event.data;
      if(event.name==='time-pos' && Number.isFinite(value)) this.state.position=Math.max(0,Math.min(value,this.state.duration));
      else if(event.name==='duration' && Number.isFinite(value) && value>0) this.state.duration=value;
      else if(event.name==='pause' && typeof value==='boolean') this.state.paused=value;
      else if(event.name==='paused-for-cache' && typeof value==='boolean') this.state.loading=value;
      else if(event.name==='video-params' && value) this.state.video={ width:value.w,height:value.h,codec:this.codec,pixelFormat:value['hw-pixelformat'] ?? value.pixelformat ?? '',hardware:this.state.video?.hardware ?? 'no' };
      else if(event.name==='hwdec-current' && typeof value==='string' && this.state.video) this.state.video.hardware=value;
      else if(event.name==='track-list' && Array.isArray(value)) this.state.tracks=value.filter(x => x.type==='audio'||x.type==='sub').map(x => ({ id:x.id,type:x.type==='sub'?'subtitle':'audio',codec:x.codec ?? '',language:x.lang,title:x.title }));
    } else if(event.event==='client-message' && event.args?.[0]==='umbra-input') {
      const action=event.args[1];
      if(['move','leave','fullscreen','minimize','pause','forward','back','stop'].includes(action)) {
        if(['move','leave'].includes(action) && performance.now()<this.ignorePointerUntil) return;
        if(action==='move' && Date.now()-this.lastInput<100) return;
        this.lastInput=Date.now();this.options.input(action);
      }
    } else if(event.event==='end-file') {
      if(event.reason==='eof'){this.state.position=this.state.duration;void this.stop();}
      else if(event.reason==='error'){this.state.error='Não foi possível reproduzir este arquivo com mpv.';this.state.loading=false;this.state.paused=true;this.publish();}
    }
  }
  async play(store: Store,id: string,restart=false) {
    if(this.starting) throw new Error('O player está sendo iniciado.');
    this.starting=true;
    try {
      await this.stop();await store.assertDisk(); const file=store.file(id);
      if(!file.available || !store.sources().some(source => source==='.'||file.path.startsWith(`${source}/`))) throw new Error('Este vídeo não está disponível em uma pasta autorizada.');
      const absolute=await existingPath(store.root,file.path);
      this.codec=file.videoCodec;
      this.store=store;this.session=store.startSession(id);this.watched=0;
      const start=restart||file.completed ? 0 : Math.min(file.position,Math.max(0,file.duration-.1));
      this.state={ ...emptyPlayer(),engine:'mpv',active:true,fileId:id,title:path.basename(file.path),position:start,duration:file.duration,paused:true,loading:true,subtitleDelay:store.setting(`subtitleDelay:${id}`,0) };
      this.publish();const generation=++this.generation;
      this.directory=await mkdtemp(path.join(tmpdir(),'umbra-mpv-'));
      let handle='';
      if(!this.options.headless) {
        this.surface=spawn(this.options.host,[this.options.parent()],{ windowsHide:true,stdio:['pipe','pipe','pipe'] });
        this.surface.stderr?.on('data',() => {});
        const lines=createInterface({ input:this.surface.stdout! });
        handle=await new Promise<string>((resolve,reject) => {
          const timer=setTimeout(() => reject(new Error('A superfície de vídeo não respondeu.')),5000);
          lines.once('line',line => {clearTimeout(timer);/^\d+$/.test(line) ? resolve(line) : reject(new Error('Superfície de vídeo inválida.'));});
          this.surface!.once('error',error => {clearTimeout(timer);reject(error);});
          this.surface!.once('exit',() => {clearTimeout(timer);reject(new Error('Não foi possível criar o vídeo dentro da janela.'));});
        });
        lines.close(); if(this.bounds) this.boundsChanged(this.bounds);
      }
      const address=process.env.CINESSD_MPV_IPC || (process.platform==='win32' ? `\\\\.\\pipe\\umbra-mpv-${randomUUID()}` : path.join(this.directory,'ipc'));
      const args=['--no-config','--idle=yes','--pause=yes','--no-terminal','--load-scripts=no','--ytdl=no','--osc=no','--input-default-bindings=no','--input-vo-keyboard=yes','--sub-auto=no','--audio-file-auto=no','--cache=no','--demuxer-max-bytes=64MiB','--demuxer-max-back-bytes=16MiB','--hwdec=auto','--audio-channels=auto','--keep-open=no','--input-ipc-server='+address];
      if(this.options.headless) args.push('--vo=null','--ao=null');
      else {args.push('--wid='+handle,'--vo=gpu-next,gpu');if(process.platform==='linux') args.push('--gpu-api=opengl','--gpu-context=x11egl');}
      if(process.env.CINESSD_MPV_AUDIO) args.push('--ao='+process.env.CINESSD_MPV_AUDIO);
      this.process=spawn(this.options.mpv,args,{ windowsHide:true,stdio:['ignore','ignore','pipe'] });
      let logs=''; this.process.stderr?.on('data',chunk => {logs=(logs+chunk).slice(-3000);});this.process.on('error',() => {});
      this.ipc=new MpvIPC();
      try {await this.ipc.connect(address,() => !!this.process?.pid && this.process.exitCode===null && this.process.signalCode===null);}
      catch(error){throw new Error(`Não foi possível iniciar mpv. ${logs||String(error)}`);}
      this.ipc.on('event',event => this.event(event,generation));
      this.ipc.on('closed',() => {if(generation===this.generation && this.state.active){this.state.error='O motor mpv foi encerrado inesperadamente.';this.state.paused=true;this.publish();}});
      const bindings=['SPACE pause','MBTN_LEFT pause','MBTN_LEFT_DBL fullscreen','F11 fullscreen','ESC minimize','RIGHT forward','LEFT back','MOUSE_MOVE move','MOUSE_LEAVE leave'].map(value => {const [key,action]=value.split(' ');return `${key} script-message umbra-input ${action}`;}).join('\n');
      await this.ipc.command('define-section','umbra',bindings,'force');await this.ipc.command('enable-section','umbra','allow-hide-cursor+allow-vo-dragging');
      let index=0;for(const name of ['time-pos','duration','pause','paused-for-cache','video-params','track-list','hwdec-current']) await this.ipc.command('observe_property',++index,name);
      const connection=this.ipc;
      let cleanupLoaded=()=>{};
      const loaded=new Promise<void>((resolve,reject) => {
        const timer=setTimeout(() => reject(new Error(`O vídeo demorou demais para abrir. ${logs}`)),20000);
        const listener=(event: any) => {if(event.event==='file-loaded')resolve();else if(event.event==='end-file' && event.reason==='error')reject(new Error('mpv não conseguiu abrir este vídeo.'));};
        const closed=()=>reject(new Error('mpv foi encerrado ao abrir o vídeo.'));
        connection.on('event',listener);connection.once('closed',closed);
        cleanupLoaded=()=>{clearTimeout(timer);connection.off('event',listener);connection.off('closed',closed);};
      });
      try {await Promise.all([loaded,connection.command('loadfile',absolute)]);}finally{cleanupLoaded();}
      const stem=path.basename(absolute,path.extname(absolute));
      for(const entry of (await readdir(path.dirname(absolute))).slice(0,10000)) {
        if(!entry.startsWith(stem+'.') || !/\.(srt|vtt|ass|ssa|sup)$/i.test(entry)) continue;
        const subtitle=path.join(path.dirname(absolute),entry),info=await lstat(subtitle);
        if(info.isFile()&&!info.isSymbolicLink()&&info.size<=8_000_000&&await realpath(subtitle)===subtitle) await this.ipc.command('sub-add',subtitle,'auto',entry);
      }
      const tracks=await this.ipc.command('get_property','track-list');this.event({event:'property-change',name:'track-list',data:tracks},generation);
      const preferences=store.playbackPreferences(id);
      for(const type of ['audio','subtitle'] as const) {
        let selected: number|string=type==='audio'?'auto':'no';
        try {const saved=JSON.parse(preferences?.[type]??'null'),track=this.state.tracks.find(track => track.type===type&&(track.language??'')===saved?.language&&(track.title??'')===saved?.title);if(track&&!saved?.off)selected=track.id;}catch{}
        await this.ipc.command('set_property',type==='audio'?'aid':'sid',selected);this.state[type]=selected;
      }
      await this.subtitleAppearance(this.options.appearance());
      await this.ipc.command('set_property','sub-delay',this.state.subtitleDelay ?? 0);
      if(start>0) await this.ipc.command('seek',start,'absolute+exact');
      await this.ipc.command('set_property','volume',this.state.volume);await this.ipc.command('set_property','pause',false);
      this.state.paused=false;this.state.loading=false;this.position=start;this.tick=performance.now();this.saved=Date.now();
      this.timer=setInterval(() => this.sample(),500);this.publish();
    } catch(error) {await this.stop();throw error;}finally{this.starting=false;}
  }
  async subtitleAppearance(value: SubtitleAppearance) {
    if(!this.ipc) return;
    for(const [name,setting] of Object.entries({'sub-font-size':value.fontSize,'sub-scale-by-window':false,'sub-color':value.color,'sub-back-color':value.background==='black'?'#FF000000':value.background==='translucent'?'#AA000000':'#00000000','sub-border-size':value.outline?1.5:0,'sub-shadow-offset':value.outline?1:0,'sub-pos':100-value.bottom,'sub-ass-override':'no'})) await this.ipc.command('set_property',name,setting);
  }
  async control(action: string,value?: number|string) {
    if(action==='stop'){await this.stop();return;}
    if(!this.state.active||!this.ipc) throw new Error('Abra um vídeo antes de usar os controles.');
    if(action==='fullscreen'){this.setFullscreen(!this.state.fullscreen);return;}
    if(action==='seek'){await this.ipc.command('seek',value,'absolute+exact');this.state.position=Number(value);this.position=Number(value);this.tick=performance.now();}
    else if(action==='pause'){this.state.paused=!this.state.paused;await this.ipc.command('set_property','pause',this.state.paused);}
    else if(action==='volume'||action==='speed'){await this.ipc.command('set_property',action,value);this.state[action]=Number(value);}
    else if(action==='audio'||action==='subtitle') {
      if(typeof value==='number'&&!this.state.tracks.some(track => track.type===(action==='audio'?'audio':'subtitle')&&track.id===value)) throw new Error('Faixa não encontrada neste vídeo.');
      if(action==='audio'&&value==='no') throw new Error('Selecione uma faixa de áudio.');
      await this.ipc.command('set_property',action==='audio'?'aid':'sid',value);this.state[action]=value!;
    } else if(action==='subtitleDelay'){await this.ipc.command('set_property','sub-delay',value);this.state.subtitleDelay=Number(value);this.store?.setSetting(`subtitleDelay:${this.state.fileId}`,Number(value));}
    else throw new Error('Controle inválido.');
    this.save();this.publish();
  }
  async checkpoint(){if(this.store && this.state.active){await this.store.assertDisk();this.save();if(this.state.error) throw new Error(this.state.error);}}
  async stop() {
    if(this.stopping) return this.stopping;
    const operation=(async () => {
      ++this.generation;if(this.timer) clearInterval(this.timer);this.timer=undefined;
      if(this.ipc && this.state.active) {try{const position=await this.ipc.command('get_property','time-pos');if(Number.isFinite(position))this.state.position=position;}catch{}}
      this.save(true);
      const ipc=this.ipc,process=this.process,surface=this.surface;this.ipc=undefined;this.process=undefined;this.surface=undefined;
      if(process?.pid && process.exitCode===null && process.signalCode===null) {
        const exited=once(process,'exit').catch(() => {});try{await ipc?.command('quit');}catch{} const timer=setTimeout(() => process.kill('SIGKILL'),2000);await exited;clearTimeout(timer);
      }
      ipc?.close();
      if(surface?.pid && surface.exitCode===null && surface.signalCode===null){const exited=once(surface,'exit').catch(() => {});surface.stdin?.end('quit\n');const timer=setTimeout(() => surface.kill('SIGKILL'),1000);await exited;clearTimeout(timer);}
      if(this.directory) await rm(this.directory,{recursive:true,force:true});this.directory='';
      this.store=undefined;this.session=undefined;this.state=emptyPlayer();this.publish();
    })();this.stopping=operation;try{await operation;}finally{this.stopping=undefined;}
  }
}
