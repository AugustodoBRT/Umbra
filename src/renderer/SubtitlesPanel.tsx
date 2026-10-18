import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Captions, Check, Languages, Settings2, X } from 'lucide-react';
import type { PlayerState, MediaTrack } from '../shared/types';
import { defaultSubtitleAppearance, type SubtitleAppearance } from '../shared/subtitles';
import { sourceLanguages } from '../shared/sourceDetails';

export function subtitleLanguage(track: MediaTrack) {
  return sourceLanguages(track.language ?? '',true)[0] ?? { code: 'und',label: 'Idioma não informado' };
}

const formats: Record<string,string> = { subrip: 'SRT',srt: 'SRT',webvtt: 'VTT',vtt: 'VTT',ass: 'ASS',ssa: 'SSA',hdmv_pgs_subtitle: 'PGS',dvd_subtitle: 'DVD',dvb_subtitle: 'DVB' };

export function SubtitlesPanel({ state,appearance,onAppearance,onSelect,onDelay,onClose }: {
  state: PlayerState;
  appearance: SubtitleAppearance;
  onAppearance: (value: SubtitleAppearance) => void;
  onSelect: (id: number | 'no') => void;
  onDelay: (value: number) => void;
  onClose: () => void;
}) {
  const [tab,setTab] = useState<'tracks'|'appearance'>('tracks');
  const id = useId();
  const firstTab = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstTab.current?.focus(); },[]);
  const tracks = state.tracks.filter(track => track.type === 'subtitle');
  const selected = tracks.find(track => track.id === state.subtitle);
  const groups = new Map<string,{ code: string; label: string; tracks: MediaTrack[] }>();
  for (const track of tracks) {
    const language = subtitleLanguage(track);
    if (!groups.has(language.code)) groups.set(language.code,{ ...language,tracks: [] });
    groups.get(language.code)!.tracks.push(track);
  }
  const languages = [...groups.values()].sort((a,b) => a.label.localeCompare(b.label,'pt-BR'));
  const active = selected ? groups.get(subtitleLanguage(selected).code) : undefined;
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    const index = buttons.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1-index : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
  };
  const styled = state.engine === 'mpv' && selected && ['ass','ssa','hdmv_pgs_subtitle','dvd_subtitle','dvb_subtitle','xsub'].includes(selected.codec);

  return <section className="subtitle-settings" role="dialog" aria-label="Legendas">
    <div className="subtitle-settings-heading">
      <span><Captions size={20}/><strong>Legendas</strong></span>
      <button className="icon-button" aria-label="Fechar painel de legendas" onClick={onClose}><X size={18}/></button>
    </div>
    <div className="subtitle-tabs" role="tablist" aria-label="Opções de legenda" onKeyDown={tabKeys}>
      <button ref={firstTab} id={`${id}-tracks`} role="tab" aria-selected={tab === 'tracks'} aria-controls={`${id}-content`} tabIndex={tab === 'tracks' ? 0 : -1} onClick={() => setTab('tracks')}><Languages size={16}/>Idioma e faixa</button>
      <button id={`${id}-appearance`} role="tab" aria-selected={tab === 'appearance'} aria-controls={`${id}-content`} tabIndex={tab === 'appearance' ? 0 : -1} onClick={() => setTab('appearance')}><Settings2 size={16}/>Aparência</button>
    </div>
    <div id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={`subtitle-tab-content subtitle-${tab}`}>
      {tab === 'tracks' ? <>
        <div className="subtitle-picker">
          <div className="subtitle-language-column">
            <h3>Idiomas</h3>
            <div className="subtitle-options" role="group" aria-label="Idiomas de legenda">
              <button className="subtitle-language" aria-pressed={!selected} onClick={() => onSelect('no')}><span>Desativada</span>{!selected && <Check size={15}/>}</button>
              {languages.map(language => <button key={language.code} className="subtitle-language" aria-pressed={active?.code === language.code} onClick={() => onSelect(language.tracks.find(track => track.id === state.subtitle)?.id ?? language.tracks[0].id)}><span>{language.label}</span>{active?.code === language.code ? <i className="subtitle-active-dot"/> : <small>{language.tracks.length}</small>}</button>)}
            </div>
          </div>
          <div className="subtitle-variant-column">
            <h3>Faixas disponíveis</h3>
            <div className="subtitle-options" role="group" aria-label="Faixas de legenda">
              {active ? active.tracks.map((track,index) => <button key={track.id} className="subtitle-variant" aria-pressed={track.id === state.subtitle} onClick={() => onSelect(track.id)}>
                <span><strong>{track.title || active.label}</strong><small>Faixa {index+1}{track.codec ? ` · ${formats[track.codec] ?? track.codec.toUpperCase()}` : ''}</small></span>
                {track.id === state.subtitle && <Check size={16}/>}
              </button>) : <div className="subtitle-empty"><Captions size={28}/><p>{tracks.length ? 'Escolha um idioma para ativar a legenda.' : 'Este vídeo não tem legendas disponíveis.'}</p></div>}
            </div>
          </div>
        </div>
        <p className="subtitle-panel-note">{selected ? 'Legenda ativa. Você pode ajustar o visual na aba Aparência.' : 'As faixas disponíveis neste vídeo aparecem aqui.'}</p>
      </> : <div className="subtitle-appearance-form">
        <div className="subtitle-preview" style={{ color: appearance.color,fontSize: Math.min(appearance.fontSize,32),backgroundColor: appearance.background === 'black' ? '#000' : appearance.background === 'translucent' ? '#000a' : '#ffffff05',textShadow: appearance.outline ? '1px 1px 2px #000,-1px -1px 2px #000' : 'none' }}>Seu cinema, do seu jeito.</div>
        <div className="subtitle-appearance-grid">
          <label className="subtitle-range">Tamanho<output>{appearance.fontSize} px</output><input type="range" aria-label="Tamanho da legenda" min="16" max="56" value={appearance.fontSize} onChange={event => onAppearance({ ...appearance,fontSize: Number(event.target.value) })}/></label>
          <label className="subtitle-range">Altura<output>{appearance.bottom}%</output><input type="range" aria-label="Altura da legenda" min="2" max="35" value={appearance.bottom} onChange={event => onAppearance({ ...appearance,bottom: Number(event.target.value) })}/></label>
          <label className="subtitle-color">Cor do texto<input type="color" aria-label="Cor da legenda" value={appearance.color} onChange={event => onAppearance({ ...appearance,color: event.target.value })}/></label>
          <label>Fundo<select aria-label="Fundo da legenda" value={appearance.background} onChange={event => onAppearance({ ...appearance,background: event.target.value as SubtitleAppearance['background'] })}><option value="none">Sem fundo</option><option value="translucent">Translúcido</option><option value="black">Preto</option></select></label>
          <label className="subtitle-outline"><input type="checkbox" checked={appearance.outline} onChange={event => onAppearance({ ...appearance,outline: event.target.checked })}/>Contorno escuro</label>
          {state.engine === 'mpv' && <label className="subtitle-range subtitle-delay">Sincronização<output>{(state.subtitleDelay ?? 0).toFixed(1)} s</output><input type="range" aria-label="Sincronização da legenda" min="-10" max="10" step=".1" value={state.subtitleDelay ?? 0} onChange={event => onDelay(Number(event.target.value))}/></label>}
        </div>
        <div className="subtitle-appearance-footer"><small>Salvo automaticamente.{styled && ' Esta faixa preserva o estilo original.'}</small><button className="text-button" onClick={() => onAppearance({ ...defaultSubtitleAppearance })}>Restaurar padrão</button></div>
      </div>}
    </div>
  </section>;
}
