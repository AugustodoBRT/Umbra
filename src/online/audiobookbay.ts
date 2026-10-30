export interface AbbEntry { path: string; title: string; poster?: string }
export interface AbbDetail { infoHash: string; trackers: string[]; size: number; format?: string; bitrate?: string }
const entities: Record<string,string> = { '&amp;': '&','&#038;': '&','&#38;': '&','&quot;': '"','&#039;': "'",'&#39;': "'",'&#8217;': '’','&#8216;': '‘','&#8211;': '–','&lt;': '<','&gt;': '>' };
const clean = (value: string) => value.replace(/<[^>]*>/g,'').replace(/&(?:amp|quot|lt|gt|#0?38|#0?39|#8217|#8216|#8211);/g,match => entities[match.replace('&#0','&#')] ?? match).replace(/\s+/g,' ').trim();
const units: Record<string,number> = { B: 1,KB: 1024,MB: 1024**2,GB: 1024**3,TB: 1024**4 };
// Detail pages use /abss/<slug>/ or /audio-books/<slug>/ depending on the mirror.
const post = /<a[^>]+href="((?:https?:\/\/[^/"]+)?\/(?:abss|audio-books)\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
export function abbPath(value: string,base: string) {
  try { const url = new URL(value,base); return /^\/(?:abss|audio-books)\//.test(url.pathname) && url.host === new URL(base).host ? url.pathname : undefined; } catch { return undefined; }
}
export function abbDomain(value: string) {
  const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) throw new Error('Informe o endereço do AudiobookBay, por exemplo audiobookbay.lu.');
  return `${url.protocol}//${url.host}/`;
}
export function abbSearchURL(base: string,query: string) { return query.trim() ? `${base}?s=${encodeURIComponent(query.trim())}` : base; }
export function parseAbbList(html: string,base: string): AbbEntry[] {
  const matches = [...html.matchAll(post)]; const entries: AbbEntry[] = []; const seen = new Set<string>();
  const titled = matches.filter(match => /rel="bookmark"/i.test(match[0]));
  const used = titled.length ? titled : matches;
  for (const [index,match] of used.entries()) {
    const path = abbPath(match[1],base); const title = clean(match[2]);
    if (!path || !title || seen.has(path)) continue; seen.add(path);
    const block = html.slice(match.index! + match[0].length,used[index+1]?.index ?? match.index! + match[0].length + 4000);
    const cover = block.match(/<img[^>]+src="([^"]+\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/i)?.[1];
    let poster: string | undefined; if (cover) try { const url = new URL(cover,base); if (['http:','https:'].includes(url.protocol)) poster = url.href; } catch { /* A broken cover does not hide the book. */ }
    entries.push({ path,title,poster });
  }
  return entries.slice(0,50);
}
const text = (html: string) => clean(html.replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi,' ').replace(/<[^>]*>/g,' '));
export function parseAbbDetail(html: string): AbbDetail {
  const index = html.search(/info\s*hash/i);
  const infoHash = (index >= 0 ? html.slice(index,index+400).match(/\b([a-f\d]{40})\b/i)?.[1] : undefined) ?? html.match(/xt=urn:btih:([a-f\d]{40})/i)?.[1];
  if (!infoHash) throw new Error('Esta página do AudiobookBay não informou o hash do torrent.');
  // Trackers are listed one per table cell; matching the whole cell avoids glued-together URLs elsewhere on the page.
  const trackers = [...new Set([...html.matchAll(/<td[^>]*>\s*((?:udp|https?):\/\/[^<\s]+)\s*<\/td>/gi)].map(match => clean(match[1])).filter(url => /announce/i.test(url) || url.startsWith('udp://')))].slice(0,30);
  const plain = text(html); const size = plain.match(/File\s*Size\s*:?\s*([\d.,]+)\s*(B|KB|MB|GB|TB)s?\b/i);
  return { infoHash: infoHash.toLowerCase(),trackers,size: size ? Math.round(parseFloat(size[1].replace(/,/g,'')) * (units[size[2].toUpperCase()] ?? 1)) : 0,format: plain.match(/\bFormat\s*:\s*([A-Za-z0-9]{2,5})\b/)?.[1]?.toUpperCase(),bitrate: plain.match(/\bBitrate\s*:\s*(\d+\s*Kbps|Variable)/i)?.[1] };
}
// Titles look like "Dune - Frank Herbert [M4B]"; the part after the first dash is the author.
export function splitAbbTitle(title: string) {
  const [name,...rest] = title.replace(/\s*\[[^\]]*\]\s*/g,' ').split(/\s+[-–]\s+/);
  return { name: name.trim() || title,authors: rest.length ? [rest.join(' - ').trim()] : [] };
}
export const abbItemId = (path: string) => `abb:${btoa(path).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
export function abbItemPath(id: string) {
  if (!id.startsWith('abb:')) throw new Error('Título do AudiobookBay inválido.');
  const path = atob(id.slice(4).replace(/-/g,'+').replace(/_/g,'/'));
  if (!/^\/(?:abss|audio-books)\/[^\s]+$/.test(path)) throw new Error('Título do AudiobookBay inválido.');
  return path;
}
