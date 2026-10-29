import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface BookLink { url: string; name: string; format?: string; external: boolean; manifest?: boolean }
export interface OPDSBook { type: 'book'|'audiobook'; narrators: string[]; id: string; name: string; description: string; year: string; authors: string[]; poster?: string; links: BookLink[] }
export interface OPDSFeed { name: string; books: OPDSBook[]; navigation: { name: string; url: string }[]; search?: { url: string; openSearch: boolean }; next?: string }
const array = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
const plain = (v: any): string => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0,10000) : v && typeof v === 'object' ? plain(v['#text'] ?? v.name ?? v.en ?? Object.values(v)[0]) : '';
const strip = (v: any) => plain(v).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const rels = (v: any) => array(v).flatMap(x => typeof x === 'string' ? x.split(/\s+/) : []);
export function bookURL(value: unknown,base: string): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 12000) return;
  try { const url = new URL(value,base); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return; url.hash = ''; return url.href; } catch { return; }
}
export function parseXML(value: string): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(value) || XMLValidator.validate(value) !== true) throw new Error('O catálogo XML é inválido.');
  return new XMLParser({ ignoreAttributes: false,attributeNamePrefix: '',removeNSPrefix: true,parseTagValue: false,parseAttributeValue: false }).parse(value);
}
export function bookFormat(type: string,url: string) {
  const types: Record<string,string> = { 'application/epub+zip': 'epub','application/pdf': 'pdf','application/x-mobipocket-ebook': 'mobi','application/vnd.amazon.ebook': 'azw3','application/x-fictionbook+xml': 'fb2','application/vnd.comicbook+zip': 'cbz','application/vnd.comicbook-rar': 'cbr','text/plain': 'txt' };
  return types[type.split(';')[0].trim()] ?? new URL(url).pathname.match(/\.(epub|pdf|mobi|azw3|fb2|cbz|cbr|txt)$/i)?.[1]?.toLowerCase();
}
export function audioFormat(type: string,url: string) {
  const extension = new URL(url).pathname.match(/\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav)$/i)?.[1]?.toLowerCase();
  const types: Record<string,string> = { 'audio/mpeg': 'mp3','audio/mp3': 'mp3','audio/mp4': 'm4b','audio/aac': 'aac','audio/ogg': 'ogg','audio/opus': 'opus','audio/flac': 'flac','audio/x-flac': 'flac','audio/wav': 'wav','audio/x-wav': 'wav' };
  return extension ?? types[type.split(';')[0].trim().toLowerCase()];
}
export function audioManifest(body: string,base: string): BookLink[] {
  const data = JSON.parse(body);
  if (!Array.isArray(data.readingOrder) || !data.readingOrder.length || data.readingOrder.length > 1000) throw new Error('O manifesto não informou partes de áudio compatíveis.');
  if (data.readingOrder.some((link: any) => link?.properties?.encrypted)) throw new Error('Esta fonte exige um aplicativo de leitura com DRM. Abra o acesso na fonte.');
  return data.readingOrder.flatMap((link: any,index: number) => {
    const url = bookURL(link?.href,base); if (!url) return [];
    const format = audioFormat(plain(link.type),url); if (!format) return [];
    return [{ url,format,name: strip(link.title) || `Parte ${index+1}`,external: false }];
  });
}
export function parseOPDS(body: string,base: string): OPDSFeed {
  const xml = body.trimStart().startsWith('<'); const data = xml ? parseXML(body).feed : JSON.parse(body);
  if (!data || (xml ? !data.title : !data.metadata?.title || !['publications','navigation','groups'].some(key => Array.isArray(data[key])))) throw new Error('Este link não é um catálogo OPDS de livros.');
  const links = (v: any) => array(v).map(link => ({ ...link,url: bookURL(link.href,base),rels: rels(link.rel) })).filter(link => link.url);
  const feedLinks = links(xml ? data.link : data.links);
  const search = feedLinks.find(link => link.rels.includes('search'));
  const groups = xml ? [] : array(data.groups).slice(0,30);
  const entries = xml ? array(data.entry) : [...array(data.publications),...groups.flatMap(g => array(g.publications))];
  const navigation = xml ? entries.flatMap(entry => links(entry.link).filter(link => !link.rels.some((r: string) => r.startsWith('http://opds-spec.org/acquisition')) && /atom\+xml|opds\+json/.test(link.type ?? '') && (!link.rels.length || link.rels.includes('subsection'))).map(link => ({ name: strip(entry.title),url: link.url! }))) : [...array(data.navigation),...groups.flatMap(g => array(g.navigation))].flatMap(link => { const url = bookURL(link.href,base); return url && /opds\+json|atom\+xml/.test(link.type ?? '') ? [{ name: strip(link.title),url }] : []; });
  const books = entries.slice(0,250).flatMap((entry): OPDSBook[] => {
    const metadata = xml ? entry : entry.metadata; if (!metadata) return [];
    const entryLinks = links(xml ? entry.link : entry.links);
    const acquisitions: BookLink[] = entryLinks.flatMap(link => {
      if (!link.rels.some((rel: string) => ['acquisition','download','borrow','buy','subscribe','preview'].includes(rel) || rel.startsWith('http://opds-spec.org/acquisition'))) return [];
      const format = audioFormat(plain(link.type),link.url!) ?? bookFormat(plain(link.type),link.url!);
      const manifest = plain(link.type).split(';')[0] === 'application/audiobook+json';
      const direct = link.rels.some((rel: string) => ['acquisition','download','http://opds-spec.org/acquisition','http://opds-spec.org/acquisition/open-access'].includes(rel)) && !!format;
      return [{ url: link.url!,name: strip(link.title) || (direct ? format!.toUpperCase() : 'Abrir na fonte'),format,manifest,external: !direct }];
    });
    const name = strip(xml ? entry.title : metadata.title); if (!name || !acquisitions.length) return [];
    const poster = xml ? entryLinks.find(link => link.rels.some((rel: string) => /opds-spec.org\/image/.test(rel)))?.url : bookURL(array(entry.images)[0]?.href,base);
    const identifier = plain(xml ? entry.id : metadata.identifier);
    const declaredAudio = /audiobook/i.test(plain(metadata['@type'])+' '+plain(metadata.type));
    const audiobookLinks = acquisitions.filter(link => link.manifest || (link.format && /^(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav)$/.test(link.format)) || (declaredAudio && !link.format));
    const bookLinks = acquisitions.filter(link => !audiobookLinks.includes(link));
    const common = { id: identifier || acquisitions[0].url,name,description: strip(xml ? entry.content ?? entry.summary : metadata.description),year: plain(xml ? entry.issued ?? entry.published : metadata.published).slice(0,4),authors: array(xml ? entry.author : metadata.author).map(author => strip(author?.name ?? author)).filter(Boolean).slice(0,30),narrators: array(metadata.narrator).map(person => strip(person?.name ?? person)).filter(Boolean).slice(0,30),poster };
    return [...(bookLinks.length ? [{ ...common,type: 'book' as const,links: bookLinks.slice(0,30) }] : []),...(audiobookLinks.length ? [{ ...common,type: 'audiobook' as const,links: audiobookLinks.slice(0,30) }] : [])];
  });
  return { name: strip(xml ? data.title : data.metadata.title),books,navigation: navigation.slice(0,50),search: search ? { url: search.url!,openSearch: /opensearchdescription/.test(search.type ?? '') } : undefined,next: feedLinks.find(link => link.rels.includes('next'))?.url };
}
export function openSearchTemplate(body: string,base: string) {
  const data = parseXML(body).OpenSearchDescription;
  const url = array(data?.Url).find(link => /atom\+xml|opds\+json/.test(link.type ?? '') && typeof link.template === 'string');
  if (!url) throw new Error('A fonte não anunciou um formato de busca de livros compatível.');
  return bookURL(url.template,base);
}
export function searchURL(template: string,query: string) {
  // URL normalizes URI-template braces; restore them before expanding OpenSearch terms.
  const expanded = template.replace(/%7B/gi,'{').replace(/%7D/gi,'}');
  const hasTerms = /\{(?:searchTerms\??|query)\}/.test(expanded) || /\{[?&][^{}]*\bquery\b[^{}]*\}/.test(expanded);
  if (!hasTerms) throw new Error('O modelo de busca desta fonte não é compatível.');
  // OPDS 2 uses RFC 6570 query expansions, e.g. search{?query,title,author}.
  const url = expanded.replace(/\{([?&])([^{}]+)\}/g,(_match,operator: string,names: string) => {
    const values = names.split(',').flatMap(name => name === 'query' ? [`query=${encodeURIComponent(query)}`] : []);
    return values.length ? `${operator}${values.join('&')}` : '';
  }).replace(/\{(?:searchTerms\??|query)\}/g,encodeURIComponent(query)).replace(/\{(?:count|count\?)\}/g,'100').replace(/\{(?:startIndex|startPage)\??\}/g,'1').replace(/\{[^{}]+\?\}/g,'');
  if (/\{/.test(url)) throw new Error('A fonte exige parâmetros de busca que ainda não são compatíveis.');
  return url;
}
