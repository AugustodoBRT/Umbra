import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, Maximize, Minimize2, X, ChevronDown, LoaderCircle } from 'lucide-react';
import type { PlayerState } from '../shared/types';
import { time } from './components';
import { Brand } from './Brand';
type Run = <T>(action: () => Promise<T>,message?: string) => Promise<T|undefined>;
const streamType = 'video/mp4; codecs="avc1.4d402a, mp4a.40.2"';
export function Player({ state,run }: { state: PlayerState; run: Run }) {
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(state); latest.current = state;
  const [minimized,setMinimized] = useState(false),[loading,setLoading] = useState(true),[error,setError] = useState(''),[seek,setSeek] = useState<number>();
  const control = (action: string,value?: number|string) => void run(() => window.cine.control(action,value));
  useEffect(() => {
    const element = video.current!; const source = state.source;
    if (!source) return;
    let alive = true; const abort = new AbortController(); let objectURL = '';
    setLoading(true); setError('');
    const failed = () => { if (alive) { setError('Não foi possível reproduzir este vídeo. Confira o arquivo e o FFmpeg nas configurações.'); void window.cine.playbackReport(source.token,latest.current.position,false,true); } };
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
          if (!MediaSource.isTypeSupported(streamType)) throw new Error('Codec indisponível.');
          const buffer = media.addSourceBuffer(streamType);
          const append = (value: Uint8Array) => new Promise<void>((resolve,reject) => {
            const done = () => { buffer.removeEventListener('error',bad); resolve(); };
            const bad = () => { buffer.removeEventListener('updateend',done); reject(new Error('Vídeo inválido.')); };
            buffer.addEventListener('updateend',done,{ once: true }); buffer.addEventListener('error',bad,{ once: true });
            buffer.appendBuffer(new Uint8Array(value));
          });
          const response = await fetch(source.url,{ signal: abort.signal });
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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,select,textarea') || minimized) return;
      if (event.code === 'Space') { event.preventDefault(); control('pause'); }
      if (event.key === 'Escape') { if (state.fullscreen) control('fullscreen'); else setMinimized(true); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); control('seek',Math.max(0,Math.min(state.duration,state.position+(event.key === 'ArrowRight' ? 10 : -10)))); }
    };
    document.addEventListener('keydown',key); return () => document.removeEventListener('keydown',key);
  },[state.position,state.paused,state.fullscreen,minimized]);
  const commitSeek = () => { if (seek !== undefined) control('seek',seek); setSeek(undefined); };
  return <section className={`embedded-player ${minimized ? 'minimized' : ''}`} aria-label="Reprodução no Umbra">
    <header className="embedded-player-heading"><Brand symbolOnly/><span><small>AGORA EM SESSÃO</small><strong>{state.title}</strong></span><button className="icon-button" aria-label={minimized ? 'Expandir player' : 'Minimizar player'} onClick={() => setMinimized(!minimized)}>{minimized ? <Maximize size={18}/> : <ChevronDown size={20}/>}</button><button className="icon-button" aria-label="Encerrar reprodução" onClick={() => control('stop')}><X size={20}/></button></header>
    <div className="embedded-video-stage"><video ref={video} autoPlay={!state.paused} playsInline crossOrigin="anonymous" aria-label="Vídeo em reprodução" onClick={() => control('pause')} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onCanPlay={() => setLoading(false)} onEnded={() => { if (state.source) void window.cine.playbackReport(state.source.token,state.duration,true); }}>
      {state.source?.subtitleUrl && <track key={state.source.subtitleUrl} kind="subtitles" label="Legenda selecionada" default/>}
    </video>{loading && !error && <div className="video-loading" role="status"><LoaderCircle className="spin" size={30}/><span>Preparando sua sessão…</span></div>}{error && <div className="video-error" role="alert">{error}</div>}</div>
    <footer className="embedded-player-controls"><div className="video-timeline"><span>{time(seek ?? state.position)}</span><input type="range" aria-label="Posição de reprodução" min="0" max={state.duration || 1} step=".1" value={seek ?? state.position} onChange={event => setSeek(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek}/><span>{time(state.duration)}</span></div><div className="video-control-row"><button className="button secondary play-pause" aria-label={state.paused ? 'Reproduzir' : 'Pausar'} onClick={() => control('pause')}>{state.paused ? <Play size={19}/> : <Pause size={19}/>}</button><label className="video-volume"><Volume2 size={18}/><input type="range" aria-label="Volume" min="0" max="100" value={state.volume} onChange={event => control('volume',Number(event.target.value))}/></label><label>Velocidade<select aria-label="Velocidade" value={state.speed} onChange={event => control('speed',Number(event.target.value))}>{[.5,.75,1,1.25,1.5,2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label><label>Áudio<select aria-label="Faixa de áudio" value={state.audio} disabled={!state.tracks.some(track => track.type === 'audio')} onChange={event => control('audio',event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Automático</option>{state.tracks.filter(track => track.type === 'audio').map(track => <option key={track.id} value={track.id}>{track.language || `Áudio ${track.id}`} {track.title}</option>)}</select></label><label>Legenda<select aria-label="Faixa de legenda" value={state.subtitle} onChange={event => control('subtitle',event.target.value === 'no' ? 'no' : Number(event.target.value))}><option value="no">Desativada</option>{state.tracks.filter(track => track.type === 'subtitle').map(track => <option key={track.id} value={track.id}>{track.language || track.title || `Legenda ${track.id}`}</option>)}</select></label><button className="icon-button" aria-label="Tela cheia do player" onClick={() => { setMinimized(false); control('fullscreen'); }}>{state.fullscreen ? <Minimize2 size={20}/> : <Maximize size={20}/>}</button></div></footer>
  </section>;
}
