import path from 'node:path';
export interface Identity { title: string; year: number | null; kind: 'movie' | 'episode'; season: number | null; episodes: number[] }
export const extensions = new Set(['.mkv','.mp4','.avi','.mov','.m4v','.webm','.mpg','.mpeg','.ts','.m2ts','.wmv']);
export function ignored(name: string) { return name.startsWith('.') || /^(?:sample|samples|extras?|featurettes?|trailers?|bonus|amostras?|bastidores|lost\+found)$/i.test(name) || /(?:^|[. _-])(?:sample|trailer)(?:[. _-]|$)/i.test(name) || /\.(?:part|tmp|crdownload)$/i.test(name); }
function clean(value: string) { return value.replace(/[._]/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\b(?:2160p|1080[pi]|720p|480p|4k|uhd|bluray|blu-ray|brrip|bdrip|web[- ]?dl|webrip|hdtv|dvdrip|x26[45]|h[ .]?26[45]|hevc|avc|av1|aac|ac3|eac3|dts|truehd|atmos|remux|hdr10?|dolby vision|10bit|8bit|dual|dubbed|dublado|legendado|proper|repack)\b.*$/i, '').replace(/\s*-\s*$/, '').replace(/[()[\]]/g, '').replace(/\s+/g, ' ').trim(); }
export function identify(relative: string): Identity {
  const base = path.basename(relative, path.extname(relative));
  const match = base.match(/(?:s(\d{1,2})e(\d{1,3})((?:e\d{1,3})*)|(\d{1,2})x(\d{1,3})((?:x\d{1,3})*))/i);
  const explicitYear = base.match(/[\[(]((?:19|20)\d{2})[\])]/);
  const yearMatch = explicitYear ?? base.match(/(?:^|[ ._(\[])((?:19|20)\d{2})(?=$|[ ._)\]])/);
  let prefix = base.slice(0, match?.index ?? yearMatch?.index ?? base.length);
  if (explicitYear?.index !== undefined && explicitYear.index < prefix.length) prefix = prefix.slice(0, explicitYear.index);
  if (!clean(prefix) || /^(?:episode|epis[oó]dio|filme|movie|video)$/i.test(clean(prefix))) {
    const folders = relative.split('/').slice(0, -1).filter(x => !/^(?:season|temporada|s)\s*\d+$/i.test(x));
    prefix = folders.at(-1) ?? base;
  }
  const folderYear = explicitYear ? null : prefix.match(/\b((?:19|20)\d{2})\b/);
  if (folderYear) prefix = prefix.slice(0, folderYear.index);
  return { title: clean(prefix) || clean(base) || 'Sem título', year: Number(yearMatch?.[1] ?? folderYear?.[1]) || null, kind: match ? 'episode' : 'movie', season: match ? Number(match[1] ?? match[4]) : null, episodes: match ? [Number(match[2] ?? match[5]), ...[...(match[3] ?? match[6]).matchAll(/[ex](\d+)/gi)].map(x => Number(x[1]))] : [] };
}
export function normalize(value: string) { return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
