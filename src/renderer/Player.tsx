import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Play, Pause, Volume2, Maximize, Minimize2, X, ChevronDown, LoaderCircle, Captions, Headphones } from 'lucide-react';
import type { PlayerBounds, PlayerState } from '../shared/types';
import type { SubtitleAppearance } from '../shared/subtitles';
import { SubtitlesPanel, subtitleLanguage } from './SubtitlesPanel';
import { time } from './components';
import { Brand } from './Brand';
type Run = <T>(action: () => Promise<T>,message?: string) => Promise<T|undefined>;
const streamType = 'video/mp4; codecs="avc1.4d402a, mp4a.40.2"';
export function Player({ state,run,subtitleAppearance }: { state: PlayerState; run: Run; subtitleAppearance: SubtitleAppearance }) {
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLElement>(null);
  const controls = useRef<HTMLElement>(null);
  const subtitleButton = useRef<HTMLButtonElement>(null);
  const nativeSurface = useRef<HTMLDivElement>(null);
  const native = state.engine === 'mpv';
  const audioOnly = state.mediaType === 'audio';
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingAppearance = useRef<SubtitleAppearance | undefined>(undefined);
  const latest = useRef(state); latest.current = state;
  const [minimized,setMinimized] = useState(false),[loading,setLoading] = useState(true),[error,setError] = useState(''),[seek,setSeek] = useState<number>();
  const [controlsVisible,setControlsVisible] = useState(true);
  const [subtitlesOpen,setSubtitlesOpen] = useState(false);
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
  const selectedSubtitle = state.tracks.find(track => track.type === 'subtitle' && track.id === state.subtitle);
  const subtitleLabel = selectedSubtitle ? subtitleLanguage(selectedSubtitle).label : 'Desativada';
  const closeSubtitles = (focus = false) => {
    setSubtitlesOpen(false); saveAppearance();
    if (focus) requestAnimationFrame(() => subtitleButton.current?.focus());
  };
  const revealControls = () => {
    clearTimeout(hideTimer.current); setControlsVisible(true);
    if (audioOnly || !fullscreen || loading || error || subtitlesOpen) return;
    hideTimer.current = setTimeout(() => setControlsVisible(false),2500);
  };
  const hideControls = () => { clearTimeout(hideTimer.current); if (!audioOnly && fullscreen && !subtitlesOpen && !loading && !error) setControlsVisible(false); };
  const toggleFullscreen = () => { setMinimized(false); control('fullscreen'); };
  const minimize = () => { closeSubtitles(); if (fullscreen) control('fullscreen'); setMinimized(!minimized); };
  useEffect(() => {
    revealControls(); return () => clearTimeout(hideTimer.current);
  },[fullscreen,loading,error,subtitlesOpen]);
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
      const overlays=[...player.current!.querySelectorAll(fullscreen && controlsVisible ? '.embedded-player-heading,.embedded-player-controls,.subtitle-settings' : '.subtitle-settings')];
      const bounds: PlayerBounds={x,y,width:Math.max(1,Math.min(rect.width,innerWidth-x)),height:Math.max(1,Math.min(rect.height,innerHeight-y)),scale:devicePixelRatio,visible:!audioOnly&&!state.error&&document.visibilityState==='visible'&&!!hit&&(hit===surface||surface.contains(hit)||overlays.some(overlay=>overlay.contains(hit))),overlays:[]};
      for(const element of overlays){
        const overlay=element.getBoundingClientRect();
        const left=Math.max(x,overlay.left),top=Math.max(y,overlay.top),right=Math.min(x+bounds.width,overlay.right),bottom=Math.min(y+bounds.height,overlay.bottom);
        if(right>left && bottom>top) bounds.overlays!.push({x:left-x,y:top-y,width:right-left,height:bottom-top});
      }
      const signature=JSON.stringify(bounds);if(signature===previous)return;previous=signature;
      void window.cine.playerBounds(bounds).catch(() => {});
    };
    const schedule=() => {cancelAnimationFrame(frame);frame=requestAnimationFrame(sync);};
    const observer=new ResizeObserver(schedule);observer.observe(surface);for(const element of player.current!.querySelectorAll('.embedded-player-heading,.embedded-player-controls,.subtitle-settings'))observer.observe(element);window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);
    // Also hide the native child when a library modal covers a minimized player.
    const timer=setInterval(sync,250);schedule();
    return () => {clearInterval(timer);cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);};
  },[native,audioOnly,minimized,fullscreen,controlsVisible,subtitlesOpen,state.loading,state.error]);
  useEffect(()=>()=>{if(native)void window.cine.playerBounds({x:0,y:0,width:1,height:1,scale:devicePixelRatio,visible:false}).catch(()=>{});},[native]);
  useEffect(() => {
    if(!native) return;
    return window.cine.onEvent(event => {
      if(event.type!=='player-input')return;
      if(event.action==='move')revealControls();
      else if(event.action==='leave'){if(!fullscreen)hideControls();}
      else if(event.action==='fullscreen')toggleFullscreen();
      else if(event.action==='minimize'){if(fullscreen)control('fullscreen');else minimize();}
      else if(event.action==='pause'){if(subtitlesOpen)closeSubtitles();revealControls();control('pause');}
      else if(event.action==='forward'||event.action==='back'){revealControls();control('seek',Math.max(0,Math.min(state.duration,state.position+(event.action==='forward'?10:-10))));}
    });
  },[native,fullscreen,minimized,loading,error,subtitlesOpen,state.position,state.duration]);
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
      if (event.defaultPrevented) return;
      if (event.key === 'F11') { event.preventDefault(); toggleFullscreen(); return; }
      if (event.key === 'Escape' && subtitlesOpen) { event.preventDefault(); closeSubtitles(true); return; }
      if (event.key === 'Escape' && fullscreen) { event.preventDefault(); control('fullscreen'); return; }
      if (event.key === 'Tab' && fullscreen && !controlsVisible) {
        event.preventDefault(); revealControls(); requestAnimationFrame(() => controls.current?.querySelector('button')?.focus()); return;
      }
      if ((event.target as HTMLElement)?.matches('input,select,textarea,button,a,[contenteditable=true]') || minimized) return;
      revealControls();
      if (event.code === 'Space') { event.preventDefault(); control('pause'); }
      if (event.key === 'Escape') { if (state.fullscreen) control('fullscreen'); else setMinimized(true); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); control('seek',Math.max(0,Math.min(state.duration,state.position+(event.key === 'ArrowRight' ? 10 : -10)))); }
    };
    document.addEventListener('keydown',key); return () => document.removeEventListener('keydown',key);
  },[state.position,state.paused,state.fullscreen,minimized,controlsVisible,loading,error,subtitlesOpen]);
  const commitSeek = () => { if (seek !== undefined) control('seek',seek); setSeek(undefined); };
  const className = `embedded-player ${audioOnly ? 'audio-player' : ''} ${native ? 'native-player' : ''} ${minimized ? 'minimized' : ''} ${fullscreen ? 'fullscreen' : ''} ${fullscreen && !controlsVisible ? 'controls-hidden' : ''} ${subtitlesOpen ? 'subtitles-open' : ''}`;
  const pointerEvents = {
    onPointerEnter: revealControls,onPointerMove: revealControls,onPointerLeave: hideControls,onFocusCapture: revealControls,
    onPointerDown: (event: PointerEvent<HTMLElement>) => { revealControls(); if (subtitlesOpen && !(event.target as Element).closest('.subtitle-settings,.subtitle-trigger')) closeSubtitles(); }
  };
  const heading = <header className="embedded-player-heading" aria-hidden={fullscreen && !controlsVisible} inert={fullscreen && !controlsVisible}><Brand symbolOnly/><span><small>{audioOnly ? 'OUVINDO AUDIOBOOK' : 'AGORA EM SESSÃO'}</small><strong>{state.title}</strong></span><button className="icon-button" aria-label={minimized ? 'Expandir player' : 'Minimizar player'} onClick={minimize}>{minimized ? <Maximize size={18}/> : <ChevronDown size={20}/>}</button><button className="icon-button" aria-label="Encerrar reprodução" onClick={() => control('stop')}><X size={20}/></button></header>;
  const footer = <footer ref={controls} className="embedded-player-controls" aria-hidden={fullscreen && !controlsVisible} inert={fullscreen && !controlsVisible}>
      {subtitlesOpen && <SubtitlesPanel state={state} appearance={appearance} onAppearance={changeAppearance} onSelect={id => control('subtitle',id)} onDelay={value => control('subtitleDelay',value)} onClose={() => closeSubtitles(true)}/>}
      <div className="video-timeline"><span>{time(seek ?? state.position)}</span><input type="range" aria-label="Posição de reprodução" min="0" max={state.duration || 1} step=".1" value={seek ?? state.position} onChange={event => setSeek(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek}/><span>{time(state.duration)}</span></div><div className="video-control-row"><button className="button secondary play-pause" aria-label={state.paused ? 'Reproduzir' : 'Pausar'} onClick={() => control('pause')}>{state.paused ? <Play size={19}/> : <Pause size={19}/>}</button><label className="video-volume"><Volume2 size={18}/><input type="range" aria-label="Volume" min="0" max="100" value={state.volume} onChange={event => control('volume',Number(event.target.value))}/></label><label>Velocidade<select aria-label="Velocidade" value={state.speed} onChange={event => control('speed',Number(event.target.value))}>{[.5,.75,1,1.25,1.5,2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label><label>Áudio<select aria-label="Faixa de áudio" value={state.audio} disabled={!state.tracks.some(track => track.type === 'audio')} onChange={event => control('audio',event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Automático</option>{state.tracks.filter(track => track.type === 'audio').map(track => <option key={track.id} value={track.id}>{track.language || `Áudio ${track.id}`} {track.title}</option>)}</select></label>{!audioOnly && <button ref={subtitleButton} className={`subtitle-trigger ${selectedSubtitle ? 'active' : ''}`} aria-label="Legendas" aria-haspopup="dialog" aria-expanded={subtitlesOpen} title={`Legendas: ${subtitleLabel}`} onClick={() => { setMinimized(false); if (subtitlesOpen) closeSubtitles(); else setSubtitlesOpen(true); }}><Captions size={20}/><span>{subtitleLabel}</span>{selectedSubtitle && <i className="subtitle-active-dot"/>}</button>}<button className="icon-button" aria-label="Tela cheia do player" onClick={toggleFullscreen}>{state.fullscreen ? <Minimize2 size={20}/> : <Maximize size={20}/>}</button></div></footer>;
  return <section ref={player} className={className} aria-label="Reprodução no Umbra" {...pointerEvents}>
      <style data-subtitle-appearance>{`.embedded-video-stage video::cue { font-size: ${appearance.fontSize}px; color: ${appearance.color}; background-color: ${appearance.background === 'black' ? '#000' : appearance.background === 'translucent' ? '#000a' : 'transparent'}; text-shadow: ${appearance.outline ? '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 4px #000' : 'none'}; }`}</style>
      {heading}
      <div className="embedded-video-stage">{audioOnly && <div className="audiobook-art" aria-label="Audiobook em reprodução"><Headphones size={52}/><strong>{state.title}</strong><span>Seu tempo de ouvir.</span></div>}{native ? <div ref={nativeSurface} className="native-video-surface" aria-label="Vídeo em reprodução"/> : <video ref={video} autoPlay={!state.paused} playsInline crossOrigin="anonymous" aria-label="Vídeo em reprodução" onClick={() => control('pause')} onDoubleClick={toggleFullscreen} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onCanPlay={() => setLoading(false)} onEnded={() => { if (state.source) void window.cine.playbackReport(state.source.token,state.duration,true); }}>
      {state.source?.subtitleUrl && <track key={state.source.subtitleUrl} kind="subtitles" label="Legenda selecionada" default/>}
    </video>}{loading && !error && <div className="video-loading" role="status"><LoaderCircle className="spin" size={30}/><span>Preparando sua sessão…</span></div>}{error && <div className="video-error" role="alert">{error}</div>}</div>
      {footer}
  </section>;
}
