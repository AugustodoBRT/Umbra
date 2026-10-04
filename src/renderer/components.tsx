import { useEffect, useRef, type ReactNode } from 'react';
import { X, Star, Play, Film, Tv, Heart, HardDrive } from 'lucide-react';
import type { Work, MediaFile } from '../shared/types';
export const bytes = (n: number) => n >= 1e12 ? `${(n/1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n/1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n/1e6).toFixed(0)} MB` : n >= 1000 ? `${(n/1000).toFixed(0)} KB` : `${n} B`;
export const time = (n: number) => `${Math.floor(n/3600) ? `${Math.floor(n/3600)}:` : ''}${Math.floor(n/60)%60 < 10 && n >= 3600 ? '0' : ''}${Math.floor(n/60)%60}:${String(Math.floor(n%60)).padStart(2,'0')}`;
export const minutes = (n: number) => n ? `${Math.round(n/60)} min` : 'Duração indisponível';
export const asset = (value?: string) => value ? `cinessd://asset/${value}` : undefined;
export const thumbnail = (file?: MediaFile) => file ? asset(`Biblioteca/miniaturas/${file.id}.jpg`) : undefined;
export const watched = (work: Work) => work.watched ?? (work.personal.watched || work.files.some(x => x.completed));
export function Artwork({ work, landscape = false, className = '' }: { work: Work; landscape?: boolean; className?: string }) {
  const src = asset(landscape ? work.metadata.backdrop ?? work.metadata.poster : work.metadata.poster) ?? thumbnail(work.files[0]);
  const hue = [...work.id].reduce((n,c) => n+c.charCodeAt(0),0) % 360;
  return <div className={`artwork ${landscape ? 'landscape' : ''} ${className}`} style={{ '--poster-hue': hue } as React.CSSProperties}>
    <div className="poster-pattern"/><span className="poster-type">{work.kind === 'series' ? 'SÉRIE' : 'CINEMA'} / {work.year ?? 'LOCAL'}</span><div className="poster-name">{work.title}</div><span className="poster-line">DA SUA BIBLIOTECA</span>
    {src && <img src={src} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }}/>}<div className="artwork-shade"/>
  </div>;
}
export function Card({ work, onOpen, compact = false }: { work: Work; onOpen: (work: Work) => void; compact?: boolean }) {
  return <button className={`media-card ${compact ? 'compact-card' : ''}`} onClick={() => onOpen(work)} aria-label={`Ver detalhes de ${work.title}`}>
    <div className="card-art"><Artwork work={work} landscape={compact}/>{work.personal.favorite && <span className="card-favorite"><Heart size={13} fill="currentColor"/></span>}{!work.available && <span className="card-unavailable">Arquivo ausente</span>}<span className="card-play"><Play size={23} fill="currentColor"/></span>{work.progress > 0 && <div className="card-progress"><span style={{ width: `${Math.min(100,work.progress*100)}%` }}/></div>}</div>
    <div className="card-info"><strong>{work.title}</strong><div><span>{work.year ?? 'Ano a identificar'}{work.kind === 'series' ? ' · Série' : ''}</span>{work.personal.rating !== null ? <span className="own-score"><Star size={12} fill="currentColor"/>{work.personal.rating.toFixed(1)}</span> : work.metadata.imdb?.value != null ? <span className="card-rating">IMDb {work.metadata.imdb.value.toFixed(1)}</span> : null}</div></div>
  </button>;
}
export function Empty({ icon = <Film size={30}/>, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{action}</div>; }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current!; el.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')?.focus();
    function handle(event: KeyboardEvent) {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== el) return;
      if (event.key === 'Escape') { event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(x => x.offsetParent !== null);
      const first = elements[0],last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown',handle,true);
    return () => { document.removeEventListener('keydown',handle,true); previous?.focus(); };
  },[]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}><button className="icon-button modal-close" onClick={onClose} aria-label="Fechar"><X size={21}/></button>{children}</div></div>;
}
export function SourceScore({ name, value, votes, date }: { name: string; value?: number | null; votes?: number | null; date?: string }) { return <div className="source-score"><span className={name === 'IMDb' ? 'imdb-logo' : name === 'TMDB' ? 'tmdb-logo' : 'muted'}>{name}</span><strong>{value != null ? value.toFixed(1) : '—'}<small>/10</small></strong><span className="score-votes">{votes != null ? `${Intl.NumberFormat('pt-BR').format(votes)} votos` : 'Indisponível'}</span>{date && <span className="score-date">{new Date(date).toLocaleDateString('pt-BR')}</span>}</div>; }
