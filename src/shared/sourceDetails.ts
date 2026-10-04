import type { SourceDetails, SourceLanguage } from './online';

// Languages in a release name are hints, not a probe of the video's tracks.
const definitions = [
  ['pt-BR','Português (Brasil)','BR','pt-br|ptbr|pob|brazilian|portugu[eê]s brasileiro'],
  ['pt','Português','PT','pt|por|portuguese|portugu[eê]s'],
  ['en','Inglês','GB','en|eng|english|ingl[eê]s'],
  ['es','Espanhol','ES','es|spa|spanish|espanhol'],
  ['es-419','Espanhol (Latino)','MX','es-419|latino|latin spanish'],
  ['ja','Japonês','JP','ja|jpn|japanese|japon[eê]s'],
  ['ko','Coreano','KR','ko|kor|korean|coreano'],
  ['zh','Chinês','CN','zh|zho|chi|chinese|mandarin|chin[eê]s'],
  ['fr','Francês','FR','fr|fra|fre|french|franc[eê]s'],
  ['de','Alemão','DE','de|deu|ger|german|alem[aã]o'],
  ['it','Italiano','IT','it|ita|italian|italiano'],
  ['ru','Russo','RU','ru|rus|russian|russo'],
  ['hi','Hindi','IN','hi|hin|hindi'],
  ['ta','Tâmil','IN','ta|tam|tamil|t[aâ]mil'],
  ['te','Telugu','IN','te|tel|telugu'],
  ['pl','Polonês','PL','pl|pol|polish|polon[eê]s'],
  ['nl','Holandês','NL','nl|nld|dut|dutch|holand[eê]s'],
  ['ar','Árabe','SA','ar|ara|arabic|[aá]rabe'],
  ['tr','Turco','TR','tr|tur|turkish|turco'],
  ['uk','Ucraniano','UA','uk|ukr|ukrainian|ucraniano'],
  ['sv','Sueco','SE','sv|swe|swedish|sueco'],
  ['da','Dinamarquês','DK','da|dan|danish|dinamarqu[eê]s'],
  ['fi','Finlandês','FI','fi|fin|finnish|finland[eê]s'],
  ['no','Norueguês','NO','no|nor|nob|norwegian|noruegu[eê]s'],
  ['el','Grego','GR','el|ell|gre|greek|grego'],
  ['he','Hebraico','IL','he|heb|hebrew|hebraico'],
  ['fa','Persa','IR','fa|fas|per|persian|persa'],
  ['vi','Vietnamita','VN','vi|vie|vietnamese|vietnamita'],
  ['id','Indonésio','ID','id|ind|indonesian|indon[eé]sio'],
  ['ms','Malaio','MY','ms|msa|may|malay|malaio'],
  ['th','Tailandês','TH','th|tha|thai|tailand[eê]s'],
  ['cs','Tcheco','CZ','cs|ces|cze|czech|tcheco'],
  ['sk','Eslovaco','SK','sk|slk|slo|slovakian|slovak|eslovaco'],
  ['sl','Esloveno','SI','sl|slv|slovenian|esloveno'],
  ['hu','Húngaro','HU','hu|hun|hungarian|h[uú]ngaro'],
  ['ro','Romeno','RO','ro|ron|rum|romanian|romeno'],
  ['bg','Búlgaro','BG','bg|bul|bulgarian|b[uú]lgaro'],
  ['sr','Sérvio','RS','sr|srp|serbian|s[eé]rvio'],
  ['hr','Croata','HR','hr|hrv|croatian|croata'],
  ['lt','Lituano','LT','lt|lit|lithuanian|lituano'],
  ['lv','Letão','LV','lv|lav|latvian|let[aã]o'],
  ['et','Estoniano','EE','et|est|estonian|estoniano']
] as const;
const names = new Intl.DisplayNames(['pt-BR'],{ type: 'language' });
const regions = new Intl.DisplayNames(['pt-BR'],{ type: 'region' });
const flagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
export function sourceLanguages(input: string, codes = false): SourceLanguage[] {
  let remaining = input.slice(0,5000); const result = new Map<string,SourceLanguage>();
  const add = (entry: SourceLanguage) => { if (result.size < 50) result.set(entry.code,entry); };
  for (const flag of remaining.match(flagPattern) ?? []) {
    const country = [...flag].map(c => String.fromCharCode(c.codePointAt(0)! - 0x1F1E6 + 65)).join('');
    const definition = definitions.find(d => d[2] === country);
    // A flag for India cannot distinguish Hindi, Tamil, Telugu, etc.
    if (country === 'IN') add({ code: 'region-IN',label: 'Índia · idioma não especificado',country });
    else if (country === 'US') add({ code: 'en',label: 'Inglês',country: 'US' });
    else if (country === 'TW') add({ code: 'zh-TW',label: 'Chinês (Taiwan)',country });
    else if (definition) add({ code: definition[0],label: definition[1],country });
    else add({ code: `region-${country}`,label: `${regions.of(country) ?? country} · idioma não especificado`,country });
  }
  remaining = remaining.replace(flagPattern,' ');
  for (const [code,label,country,aliases] of definitions) {
    const alternatives = codes ? aliases : aliases.split('|').filter(alias => alias.length > 3).join('|');
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${alternatives})(?=$|[^\\p{L}\\p{N}])`,'giu');
    if (pattern.test(remaining)) { add({ code,label,country }); remaining = remaining.replace(pattern,' '); }
  }
  if (codes && !result.size) {
    const code = input.trim().replace(/_/g,'-');
    if (/^[a-z]{2,3}(?:-[a-z\d]{2,8})?$/i.test(code) && !/^(und|mul|zxx)$/i.test(code)) {
      try { add({ code,label: names.of(code) ?? code }); } catch { /* Unrecognized language remains unspecified. */ }
    }
  }
  return [...result.values()];
}
const unique = (entries: SourceLanguage[]) => [...new Map(entries.map(entry => [entry.code,entry])).values()].slice(0,50);
export function sourceDetails(stream: { name?: unknown; description?: unknown; title?: unknown; subtitles?: unknown; behaviorHints?: { filename?: unknown; videoSize?: unknown } }): SourceDetails {
  const string = (value: unknown) => typeof value === 'string' ? value.slice(0,5000) : '';
  const description = string(stream.description ?? stream.title),filename = string(stream.behaviorHints?.filename) || description.split('\n')[0];
  const text = `${string(stream.name)}\n${filename}\n${description}`;
  const quality: string[] = [];
  for (const [pattern,label] of [
    [/\b(?:2160p|4k|uhd)\b/i,'4K'],[/\b1080[pi]\b/i,'1080p'],[/\b720p\b/i,'720p'],[/\b480p\b/i,'480p'],
    [/\b(?:blu[- .]?ray|b[rd]rip|bdrip)\b/i,'BluRay'],[/\bweb[- .]?dl\b/i,'WEB-DL'],[/\bwebrip\b/i,'WEBRip'],[/\bremux\b/i,'REMUX'],
    [/\bav1\b/i,'AV1'],[/\b(?:x265|h[ .]?265|hevc)\b/i,'HEVC'],[/\b(?:x264|h[ .]?264|avc)\b/i,'H.264'],
    [/\b(?:dolby[ .]?vision|dovi|dv)\b/i,'Dolby Vision'],[/\bhdr10\+?(?=\W|$)/i,'HDR10'],[/\bhdr\b/i,'HDR'],[/\bsdr\b/i,'SDR'],
    [/\batmos\b/i,'Atmos'],[/\bopus\b/i,'Opus'],[/\beac3\b/i,'EAC3'],[/\baac\b/i,'AAC'],[/\bdts\b/i,'DTS'],[/\b5[ .]1\b/i,'5.1'],[/\b7[ .]1\b/i,'7.1']
  ] as [RegExp,string][]) if (pattern.test(text)) quality.push(label);
  const audio: SourceLanguage[] = [],subtitles: SourceLanguage[] = [],general: string[] = [];
  for (const line of description.split('\n')) {
    const tagged = line.match(/^\s*(?:🔊|🎧|💬)?\s*(audio|[aá]udios?|legendas?|subtitles?|subs)\s*[:=\-]\s*(.*)$/iu);
    if (tagged) (/[aá]udio/i.test(tagged[1]) ? audio : subtitles).push(...sourceLanguages(tagged[2],true));
    else general.push(line);
  }
  let linkedSubtitles = false;
  if (Array.isArray(stream.subtitles)) for (const subtitle of stream.subtitles.slice(0,100)) {
    if (!subtitle || typeof subtitle !== 'object' || typeof subtitle.lang !== 'string') continue;
    const languages = sourceLanguages(subtitle.lang,true); subtitles.push(...languages); if (languages.length) linkedSubtitles = true;
  }
  const announced = general.join('\n');
  const size = description.match(/(?:💾\s*)?\b(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
  const videoSize = stream.behaviorHints?.videoSize;
  let formattedSize = size ? `${size[1].replace('.',',')} ${size[2].toUpperCase()}` : '';
  if (!formattedSize && typeof videoSize === 'number' && Number.isFinite(videoSize) && videoSize > 0) {
    const unit = Math.min(4,Math.floor(Math.log(videoSize)/Math.log(1024)));
    formattedSize = `${(videoSize/1024**unit).toLocaleString('pt-BR',{ maximumFractionDigits: 2 })} ${['B','KB','MB','GB','TB'][Math.max(0,unit)]}`;
  }
  const seeders = description.match(/(?:👤\s*|\b(?:seeders?|sementes)\s*[:=]\s*)(\d+)/iu);
  return { filename: filename.slice(0,1000),quality,size: formattedSize,seeders: seeders ? Number(seeders[1]) : null,audio: unique(audio),subtitles: unique(subtitles),languages: unique(sourceLanguages(announced)),audioNote: /\bdual[ ._-]?audio\b/i.test(text) ? 'Áudio duplo anunciado' : /\bmulti[ ._-]?audio\b/i.test(text) ? 'Múltiplos áudios anunciados' : /\b(?:dubbed|dublado)\b/i.test(text) ? 'Dublagem anunciada' : '',subtitleNote: /\bmulti[ ._-]?(?:subs|subtitles)\b/i.test(text) ? 'Múltiplas legendas anunciadas' : '',linkedSubtitles };
}
export function readableSourceText(value: string) {
  return value.replace(flagPattern,flag => sourceLanguages(flag).map(lang => lang.label).join(', '))
    .replace(/👤\s*/gu,'Pessoas compartilhando: ').replace(/💾\s*/gu,'Tamanho: ').replace(/⚙️?\s*/gu,'Provedor: ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').trim();
}
