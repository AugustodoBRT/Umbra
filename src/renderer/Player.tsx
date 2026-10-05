import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, Maximize, Minimize2, X, ChevronDown, LoaderCircle, Captions } from 'lucide-react';
import type { PlayerState } from '../shared/types';
import { defaultSubtitleAppearance, type SubtitleAppearance } from '../shared/subtitles';
import { time } from './components';
import { Brand } from './Brand';
type Run = <T>(action: () => Promise<T>,message?: string) => Promise<T|undefined>;
const streamType = 'video/mp4; codecs="avc1.4d402a, mp4a.40.2"';
export function Player({ state,run,subtitleAppearance }: { state: PlayerState; run: Run; subtitleAppearance: SubtitleAppearance }) {
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLElement>(null);
  const controls = useRef<HTMLElement>(null);
  const nativeSurface = useRef<HTMLDivElement>(null);
  const native = state.engine === 'mpv';
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingAppearance = useRef<SubtitleAppearance | undefined>(undefined);
  const latest = useRef(state); latest.current = state;
  const [minimized,setMinimized] = useState(false),[loading,setLoading] = useState(true),[error,setError] = useState(''),[seek,setSeek] = useState<number>();
  const [controlsVisible,setControlsVisible] = useState(true);
  const [appearanceOpen,setAppearanceOpen] = useState(false);
  const [appearance,setAppearance] = useState(subtitleAppearance);
  const saveAppearance = () => {
    clearTimeout(saveTimer.current); saveTimer.current = undefined;
    const value = pendingAppearance.current; pendingAppearance.current = undefined;
    if (value) void run(() => window.cine.subtitleAppearance(value));
  };
  const changeAppearance = (value: SubtitleAppearance) => {
    setAppearance(value); pendingAppearance.current = value;
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(saveAppearance,400);
  };
  useEffect(() => { if (!pendingAppearance.current) setAppearance(subtitleAppearance); },[subtitleAppearance]);
  useEffect(() => () => saveAppearance(),[]);
  const control = (action: string,value?: number|string) => void run(() => window.cine.control(action,value));
  const fullscreen = state.fullscreen && !minimized;
  const revealControls = () => {
    clearTimeout(hideTimer.current); setControlsVisible(true);
    if (!fullscreen || loading || error || appearanceOpen) return;
    hideTimer.current = setTimeout(() => setControlsVisible(false),2500);
  };
  const hideControls = () => { clearTimeout(hideTimer.current); if (fullscreen && !appearanceOpen && !loading && !error) setControlsVisible(false); };
  const toggleFullscreen = () => { setMinimized(false); control('fullscreen'); };
  const minimize = () => { if (fullscreen) control('fullscreen'); setMinimized(!minimized); };
  useEffect(() => {
    revealControls(); return () => clearTimeout(hideTimer.current);
  },[fullscreen,loading,error,appearanceOpen]);
  useEffect(() => {
    const element = video.current; const source = state.source;
    if (!element || !source || native) return;
    let alive = true; const abort = new AbortController(); let objectURL = '';
    setLoading(true); setError('');
    const failed = () => { if (alive && latest.current.active && latest.current.source?.token === source.token) { setError('Não foi possível reproduzir este vídeo. Confira o arquivo e o FFmpeg nas configurações.'); void window.cine.playbackReport(source.token,latest.current.position,false,true); } };
    element.addEventListener('error',failed);
    const activateCue = () => {
      if (alive && latest.current.paused && element.currentTime === 0 && element.readyState >= 2 && element.textTracks[0]?.cues?.length) {
        element.currentTime = Math.max(.001,element.buffered.length ? element.buffered.start(0)+.001 : .001);
      }
    };
    element.addEventListener('loadeddata',activateCue);
    const loaded = () => {
      if (source.mode === 'file') element.currentTime = source.start;
      const track = element.querySelector('track');
      if (track && source.subtitleUrl) { track.addEventListener('load',activateCue,{ once: true }); track.src = source.subtitleUrl; track.track.mode = 'showing'; }
      if (latest.current.paused) element.pause();
    };
    element.addEventListener('loadedmetadata',loaded);
    if (source.mode === 'file') element.src = source.url;
    else {
      const media = new MediaSource(); objectURL = URL.createObjectURL(media); element.src = objectURL;
      media.addEventListener('sourceopen',() => {
        void (async () => {
          if (!alive || abort.signal.aborted) return;
          if (!MediaSource.isTypeSupported(streamType)) throw new Error('Codec indisponível.');
          const buffer = media.addSourceBuffer(streamType);
          const append = (value: Uint8Array) => new Promise<void>((resolve,reject) => {
            const done = () => { buffer.removeEventListener('error',bad); resolve(); };
            const bad = () => { buffer.removeEventListener('updateend',done); reject(new Error('Vídeo inválido.')); };
            buffer.addEventListener('updateend',done,{ once: true }); buffer.addEventListener('error',bad,{ once: true });
            buffer.appendBuffer(new Uint8Array(value));
          });
          const response = await fetch(source.url,{ signal: abort.signal });
          if (response.status === 204) return;
          if (!response.ok || !response.body) throw new Error('Vídeo indisponível.');
          const reader = response.body.getReader();
          while (alive) {
            while (alive && buffer.buffered.length && buffer.buffered.end(buffer.buffered.length-1)-element.currentTime > 20) await new Promise(resolve => setTimeout(resolve,150));
            if (!alive) break;
            const { done,value } = await reader.read();
            if (done) { if (media.readyState === 'open') media.endOfStream(); break; }
            await append(value);
            if (!latest.current.paused && element.paused) void element.play().catch(() => {});
            if (element.currentTime > 30 && buffer.buffered.length && buffer.buffered.start(0) < element.currentTime-20) {
              await new Promise<void>(resolve => { buffer.addEventListener('updateend',() => resolve(),{ once: true }); buffer.remove(0,element.currentTime-20); });
            }
          }
        })().catch(() => { if (alive && !abort.signal.aborted) failed(); });
      },{ once: true });
    }
    const timer = setInterval(() => {
      if (!alive || element.readyState < 2) return;
      const position = element.currentTime+(source.mode === 'stream' ? source.start : 0);
      void window.cine.playbackReport(source.token,Math.min(state.duration,position),false).catch(() => {});
    },500);
    return () => { alive = false; abort.abort(); clearInterval(timer); element.removeEventListener('error',failed); element.removeEventListener('loadedmetadata',loaded); element.removeEventListener('loadeddata',activateCue); element.pause(); element.removeAttribute('src'); element.load(); if (objectURL) URL.revokeObjectURL(objectURL); };
  },[state.source?.token]);
  useEffect(() => { if (!video.current) return; video.current.volume = state.volume/100; video.current.playbackRate = state.speed; if (state.paused) video.current.pause(); else void video.current.play().catch(() => {}); },[state.paused,state.volume,state.speed,state.source?.token]);
  useEffect(() => { if(native){setLoading(!!state.loading);setError(state.error ?? '');} },[native,state.loading,state.error]);
  useEffect(() => {
    if(!native || !nativeSurface.current) return;
    const surface=nativeSurface.current;let previous='',frame=0;
    const sync=() => {
      const rect=surface.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
      const x=Math.max(0,rect.x),y=Math.max(0,rect.y);
      const bounds={x,y,width:Math.max(1,Math.min(rect.width,innerWidth-x)),height:Math.max(1,Math.min(rect.height,innerHeight-y)),scale:devicePixelRatio,visible:!state.error&&document.visibilityState==='visible'&&!!hit&&(hit===surface||surface.contains(hit))};
      const signature=JSON.stringify(bounds);if(signature===previous)return;previous=signature;
      void window.cine.playerBounds(bounds).catch(() => {});
    };
    const schedule=() => {cancelAnimationFrame(frame);frame=requestAnimationFrame(sync);};
    const observer=new ResizeObserver(schedule);observer.observe(surface);window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);
    // Also hide the native child when a library modal covers a minimized player.
    const timer=setInterval(sync,250);schedule();
    return () => {clearInterval(timer);cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);if(previous)void window.cine.playerBounds({...JSON.parse(previous),visible:false}).catch(() => {});};
  },[native,minimized,fullscreen,controlsVisible,appearanceOpen,state.loading,state.error]);
  useEffect(() => {
    if(!native) return;
    return window.cine.onEvent(event => {
      if(event.type!=='player-input')return;
      if(event.action==='move')revealControls();
      else if(event.action==='leave')hideControls();
      else if(event.action==='fullscreen')toggleFullscreen();
      else if(event.action==='minimize'){if(fullscreen)control('fullscreen');else minimize();}
      else if(event.action==='pause'){revealControls();control('pause');}
      else if(event.action==='forward'||event.action==='back'){revealControls();control('seek',Math.max(0,Math.min(state.duration,state.position+(event.action==='forward'?10:-10))));}
    });
  },[native,fullscreen,minimized,loading,error,appearanceOpen,state.position,state.duration]);
  useEffect(() => {
    const element = video.current;
    if(!element)return;
    const positionCaptions = () => {
      const overlayBottom = fullscreen && controlsVisible ? ((controls.current?.offsetHeight ?? 0)+16)/Math.max(1,element.clientHeight)*100 : 0;
      const line = Math.max(10,100-Math.max(appearance.bottom,overlayBottom));
      for (const track of element.textTracks) for (const entry of track.cues ?? []) {
        const cue = entry as VTTCue;
        cue.snapToLines = false; cue.lineAlign = 'end'; cue.line = line;
      }
    };
    positionCaptions(); element.addEventListener('load',positionCaptions,true); window.addEventListener('resize',positionCaptions);
    return () => { element.removeEventListener('load',positionCaptions,true); window.removeEventListener('resize',positionCaptions); };
  },[fullscreen,controlsVisible,state.source?.token,appearance.bottom]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F11') { event.preventDefault(); toggleFullscreen(); return; }
      if (event.key === 'Escape' && appearanceOpen) { event.preventDefault(); setAppearanceOpen(false); saveAppearance(); return; }
      if (event.key === 'Escape' && fullscreen) { event.preventDefault(); control('fullscreen'); return; }
      if (event.key === 'Tab' && fullscreen && !controlsVisible) {
        event.preventDefault(); revealControls(); requestAnimationFrame(() => controls.current?.querySelector('button')?.focus()); return;
      }
      if ((event.target as HTMLElement)?.matches('input,select,textarea') || minimized) return;
      revealControls();
      if (event.code === 'Space') { event.preventDefault(); control('pause'); }
      if (event.key === 'Escape') { if (state.fullscreen) control('fullscreen'); else setMinimized(true); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); control('seek',Math.max(0,Math.min(state.duration,state.position+(event.key === 'ArrowRight' ? 10 : -10)))); }
    };
    document.addEventListener('keydown',key); return () => document.removeEventListener('keydown',key);
  },[state.position,state.paused,state.fullscreen,minimized,controlsVisible,loading,error,appearanceOpen]);
  const commitSeek = () => { if (seek !== undefined) control('seek',seek); setSeek(undefined); };
  return <section ref={player} className={`embedded-player ${native ? 'native-player' : ''} ${minimized ? 'minimized' : ''} ${fullscreen ? 'fullscreen' : ''} ${fullscreen && !controlsVisible ? 'controls-hidden' : ''} ${appearanceOpen ? 'appearance-open' : ''}`} aria-label="Reprodução no Umbra" onPointerEnter={revealControls} onPointerMove={revealControls} onPointerDown={revealControls} onPointerLeave={hideControls} onFocusCapture={revealControls}>
    <style data-subtitle-appearance>{`.embedded-video-stage video::cue { font-size: ${appearance.fontSize}px; color: ${appearance.color}; background-color: ${appearance.background === 'black' ? '#000' : appearance.background === 'translucent' ? '#000a' : 'transparent'}; text-shadow: ${appearance.outline ? '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 4px #000' : 'none'}; }`}</style>
    <header className="embedded-player-heading" aria-hidden={fullscreen && !controlsVisible} inert={fullscreen && !controlsVisible}><Brand symbolOnly/><span><small>AGORA EM SESSÃO</small><strong>{state.title}</strong></span><button className="icon-button" aria-label={minimized ? 'Expandir player' : 'Minimizar player'} onClick={minimize}>{minimized ? <Maximize size={18}/> : <ChevronDown size={20}/>}</button><button className="icon-button" aria-label="Encerrar reprodução" onClick={() => control('stop')}><X size={20}/></button></header>
    <div className="embedded-video-stage">{native ? <div ref={nativeSurface} className="native-video-surface" aria-label="Vídeo em reprodução"/> : <video ref={video} autoPlay={!state.paused} playsInline crossOrigin="anonymous" aria-label="Vídeo em reprodução" onClick={() => control('pause')} onDoubleClick={toggleFullscreen} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onCanPlay={() => setLoading(false)} onEnded={() => { if (state.source) void window.cine.playbackReport(state.source.token,state.duration,true); }}>
      {state.source?.subtitleUrl && <track key={state.source.subtitleUrl} kind="subtitles" label="Legenda selecionada" default/>}
    </video>}{loading && !error && <div className="video-loading" role="status"><LoaderCircle className="spin" size={30}/><span>Preparando sua sessão…</span></div>}{error && <div className="video-error" role="alert">{error}</div>}</div>
    <footer ref={controls} className="embedded-player-controls" aria-hidden={fullscreen && !controlsVisible} inert={fullscreen && !controlsVisible}>
      {appearanceOpen && <section className="subtitle-settings" aria-label="Aparência da legenda">
        <div className="subtitle-settings-heading"><strong>A sua legenda</strong><button className="icon-button" aria-label="Fechar ajustes de legenda" onClick={() => { setAppearanceOpen(false); saveAppearance(); }}><X size={18}/></button></div>
        <label>Tamanho <output>{appearance.fontSize} px</output><input type="range" aria-label="Tamanho da legenda" min="16" max="56" value={appearance.fontSize} onChange={event => changeAppearance({ ...appearance,fontSize: Number(event.target.value) })}/></label>
        <label className="subtitle-color">Cor do texto<input type="color" aria-label="Cor da legenda" value={appearance.color} onChange={event => changeAppearance({ ...appearance,color: event.target.value })}/></label>
        <label>Fundo<select aria-label="Fundo da legenda" value={appearance.background} onChange={event => changeAppearance({ ...appearance,background: event.target.value as SubtitleAppearance['background'] })}><option value="none">Sem fundo</option><option value="translucent">Translúcido</option><option value="black">Preto</option></select></label>
        <label className="subtitle-outline"><input type="checkbox" checked={appearance.outline} onChange={event => changeAppearance({ ...appearance,outline: event.target.checked })}/>Contorno escuro</label>
        <label>Altura <output>{appearance.bottom}%</output><input type="range" aria-label="Altura da legenda" min="2" max="35" value={appearance.bottom} onChange={event => changeAppearance({ ...appearance,bottom: Number(event.target.value) })}/></label>
        <div className="subtitle-preview" style={{ color: appearance.color,fontSize: Math.min(appearance.fontSize,32),backgroundColor: appearance.background === 'black' ? '#000' : appearance.background === 'translucent' ? '#000a' : 'transparent',textShadow: appearance.outline ? '1px 1px 2px #000,-1px -1px 2px #000' : 'none' }}>Seu cinema, do seu jeito.</div>
        {native && <label>Sincronização<output>{(state.subtitleDelay ?? 0).toFixed(1)} s</output><input type="range" aria-label="Sincronização da legenda" min="-10" max="10" step=".1" value={state.subtitleDelay ?? 0} onChange={event => control('subtitleDelay',Number(event.target.value))}/></label>}
        <small>Salvo para as próximas sessões. {native ? 'Legendas ASS preservam o estilo original; legendas em imagem preservam a aparência.' : 'Ajustes para legendas de texto.'}</small>
        <button className="button secondary" onClick={() => changeAppearance({ ...defaultSubtitleAppearance })}>Restaurar padrão</button>
      </section>}
      <div className="video-timeline"><span>{time(seek ?? state.position)}</span><input type="range" aria-label="Posição de reprodução" min="0" max={state.duration || 1} step=".1" value={seek ?? state.position} onChange={event => setSeek(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek}/><span>{time(state.duration)}</span></div><div className="video-control-row"><button className="button secondary play-pause" aria-label={state.paused ? 'Reproduzir' : 'Pausar'} onClick={() => control('pause')}>{state.paused ? <Play size={19}/> : <Pause size={19}/>}</button><label className="video-volume"><Volume2 size={18}/><input type="range" aria-label="Volume" min="0" max="100" value={state.volume} onChange={event => control('volume',Number(event.target.value))}/></label><label>Velocidade<select aria-label="Velocidade" value={state.speed} onChange={event => control('speed',Number(event.target.value))}>{[.5,.75,1,1.25,1.5,2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label><label>Áudio<select aria-label="Faixa de áudio" value={state.audio} disabled={!state.tracks.some(track => track.type === 'audio')} onChange={event => control('audio',event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Automático</option>{state.tracks.filter(track => track.type === 'audio').map(track => <option key={track.id} value={track.id}>{track.language || `Áudio ${track.id}`} {track.title}</option>)}</select></label><label>Legenda<select aria-label="Faixa de legenda" value={state.subtitle} onChange={event => control('subtitle',event.target.value === 'no' ? 'no' : Number(event.target.value))}><option value="no">Desativada</option>{state.tracks.filter(track => track.type === 'subtitle').map(track => <option key={track.id} value={track.id}>{track.language || track.title || `Legenda ${track.id}`}</option>)}</select></label><button className="icon-button" aria-label="Ajustar legenda" aria-expanded={appearanceOpen} onClick={() => { setMinimized(false); setAppearanceOpen(!appearanceOpen); if (appearanceOpen) saveAppearance(); }}><Captions size={20}/></button><button className="icon-button" aria-label="Tela cheia do player" onClick={toggleFullscreen}>{state.fullscreen ? <Minimize2 size={20}/> : <Maximize size={20}/>}</button></div></footer>
  </section>;
}
