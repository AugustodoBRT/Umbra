import { useState } from 'react';
import { Download, LoaderCircle, Headphones, Captions, Languages, HardDrive, Users, Globe2, ChevronDown } from 'lucide-react';
import type { OnlineSource, SourceLanguage } from '../shared/online';
import { readableSourceText, sourceDetails } from '../shared/sourceDetails';

const flags = import.meta.glob('./flags/*.svg',{ eager: true,query: '?url',import: 'default' }) as Record<string,string>;
function LanguageList({ languages }: { languages: SourceLanguage[] }) {
  const [expanded,setExpanded] = useState(false);
  return <div className="source-language-list">{(expanded ? languages : languages.slice(0,4)).map(language => {
    const flag = language.country && flags[`./flags/${language.country.toLowerCase()}.svg`];
    return <span className="source-language" key={language.code}>{flag ? <img src={flag} alt="" className="source-flag"/> : <Globe2 size={12} aria-hidden="true"/>}{language.label}</span>;
  })}{languages.length > 4 && <button className="source-language-more" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Mostrar menos' : `+${languages.length-4} idiomas`}</button>}</div>;
}
export function SourceCard({ source, busy, movie, onChoose }: { source: OnlineSource; busy: boolean; movie: boolean; onChoose: () => void }) {
  const details = source.details ?? sourceDetails({ name: source.name,description: source.description });
  const heading = readableSourceText(source.name.split('\n')[0]) || source.addonName;
  return <article className="download-source source-card" aria-label={`Fonte ${heading}`}>
    <div className="source-card-header">
      <div className="source-card-title"><span className="eyebrow">{source.addonName}</span><h3>{heading}</h3></div>
      <span className={`source-transport ${source.transport}`}>{source.transport === 'torrent' ? 'Torrent' : 'Arquivo online'}</span>
    </div>
    <div className="source-quality-tags">{details.quality.length ? details.quality.map(label => <span key={label}>{label}</span>) : <span className="unspecified">Qualidade não informada</span>}</div>
    <div className="source-file-name" title={details.filename}>{readableSourceText(details.filename) || 'Nome do arquivo não informado'}</div>
    <div className="source-file-stats">
      <span><HardDrive size={14} aria-hidden="true"/>{details.size || 'Tamanho não informado'}</span>
      {details.seeders !== null && <span title="Quantidade anunciada pelo complemento; pode mudar."><Users size={14} aria-hidden="true"/>{details.seeders.toLocaleString('pt-BR')} compartilhando</span>}
      {source.provider && <span><Globe2 size={14} aria-hidden="true"/>{source.provider}</span>}
    </div>
    <table className="source-tracks" aria-label="Áudio, legendas e idiomas da fonte"><tbody>
      <tr><th scope="row"><span><Headphones size={15} aria-hidden="true"/>Áudio</span></th><td>{details.audio.length ? <LanguageList languages={details.audio}/> : <span className="source-not-informed">{details.audioNote || 'Não informado'}</span>}{details.audio.length > 0 && details.audioNote && <small>{details.audioNote}</small>}</td></tr>
      <tr><th scope="row"><span><Captions size={15} aria-hidden="true"/>Legendas</span></th><td>{details.subtitles.length ? <LanguageList languages={details.subtitles}/> : <span className="source-not-informed">{details.subtitleNote || 'Não informado'}</span>}{details.linkedSubtitles && <small>Oferecidas separadamente pela fonte · não confirma legendas dentro do vídeo</small>}</td></tr>
      {details.languages.length > 0 && <tr><th scope="row"><span><Languages size={15} aria-hidden="true"/>Idiomas anunciados</span></th><td><LanguageList languages={details.languages}/><small>A fonte não distingue se são de áudio ou de legenda.</small></td></tr>}
    </tbody></table>
    <div className="source-card-footer">
      <details className="source-original"><summary><ChevronDown size={14} aria-hidden="true"/>Informações originais</summary><p>{readableSourceText(source.description) || 'O complemento não forneceu uma descrição.'}</p></details>
      <button className="button primary" disabled={busy} onClick={onChoose}>{busy ? <LoaderCircle size={16} className="spin"/> : <Download size={16}/>} {movie ? 'Baixar filme' : 'Usar para a temporada'}</button>
    </div>
  </article>;
}
