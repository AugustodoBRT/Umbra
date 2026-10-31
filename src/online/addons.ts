import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AddonSummary, OnlineItem, OnlineSource, OnlineType, OnlineVideo, SourceResult, SeasonPlan, OnlineLocalization, CatalogResult } from '../shared/online';
import type { Credentials } from '../storage/credentials';
import type { OnlineStore } from '../storage/online';
import { parseOPDS, openSearchTemplate, searchURL, audioFormat, audioManifest } from './opds';
import { sourceDetails } from '../shared/sourceDetails';
import { RealDebrid } from './realdebrid';
import { openLibraryURL,openLibraryItemURL,openLibraryPage,openLibraryId,openLibraryKey,openLibraryPageSize,parseOpenLibrary,sameTitle } from './openlibrary';
import { abbDomain,abbPageSize, abbSearchURL, parseAbbList, parseAbbDetail, splitAbbTitle, abbItemId, abbItemPath } from './audiobookbay';

const resource = z.union([z.string(),z.object({ name: z.string(),types: z.array(z.string()).optional(),idPrefixes: z.array(z.string()).optional() })]);
const manifestSchema = z.object({ id: z.string().max(200),name: z.string().max(200),description: z.string().max(5000).default(''),resources: z.array(resource).max(30),types: z.array(z.string()).max(30),idPrefixes: z.array(z.string()).optional(),catalogs: z.array(z.object({ id: z.string().max(300),type: z.string(),name: z.string().optional(),extra: z.array(z.object({ name: z.string(),isRequired: z.boolean().optional(),options: z.array(z.string()).optional() })).optional() })).max(200).default([]) });
const opdsSchema = z.object({ search: z.string().optional(),catalogs: z.array(z.object({ id: z.string(),url: z.string() })).max(51) });
const bookLinksSchema = z.array(z.object({ addonId: z.string().uuid(),id: z.string(),detail: z.string().optional(),links: z.array(z.object({ url: z.string(),name: z.string(),format: z.string().optional(),external: z.boolean(),manifest: z.boolean().optional() })).max(30) })).max(1000);
const installedSchema = z.array(z.object({ id: z.string().uuid(),url: z.string(),enabled: z.boolean(),kind: z.enum(['stremio','opds','abb','openlibrary']).default('stremio'),opds: opdsSchema.optional(),manifest: manifestSchema })).max(50);
const debridSchema = z.object({ realDebrid: z.string().max(500),username: z.string().max(200).default('') });
type Installed = z.infer<typeof installedSchema>[number];
export interface RawSource { url?: string; infoHash?: string; fileIdx?: number; sources?: string[]; behaviorHints?: { filename?: string; proxyHeaders?: { request?: Record<string,string> } } }
export interface BoundSource { summary: OnlineSource; raw: RawSource; item: OnlineItem; video?: OnlineVideo }
const idString = z.string().min(1).max(500);
function joinChunks(chunks: Uint8Array[]) { const result = new Uint8Array(chunks.reduce((size,chunk) => size+chunk.length,0)); let offset = 0; for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; } return result; }
// AudiobookBay answers generic clients with a challenge page, so identify as a browser.
const browserHeaders = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',accept: 'text/html' };
const text = (value: unknown,limit = 10000) => typeof value === 'string' ? value.slice(0,limit) : '';
export function transportURL(value: string) {
  let source = value.trim(); if (source.startsWith('stremio://')) source = `https://${source.slice(10)}`;
  const url = new URL(source);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use um link HTTP(S), sem usuário ou senha no endereço.');
  url.hash = ''; return url;
}
export function sameSource(a: OnlineSource,b: OnlineSource) { return a.addonId === b.addonId && a.name === b.name && a.provider === b.provider && a.releaseGroup === b.releaseGroup; }
export class Addons {
  private installed: Installed[] = [];
  private references = new Map<string,BoundSource>();
  private plans = new Map<string,SeasonPlan>();
  private bookLinks: z.infer<typeof bookLinksSchema> = [];
  private bookPersist = Promise.resolve();
  private debridKey = '';
  private debridName = '';
  private images = new Map<string,string>();
  private imageIds = new Map<string,string>();
  private controller = new AbortController();
  constructor(private credentials: Pick<Credentials,'loadDocument'|'saveDocument'>,readonly store: Pick<OnlineStore,'cache'|'get'|'localization'|'saveLocalization'|'personal'|'saved'>,private translate?: (item: OnlineItem) => Promise<OnlineLocalization | null>,private runtime: { fetch?: typeof fetch; imageURL?: (url: string) => string; debridWait?: number } = {}) {}
  async initialize() {
    const saved = await this.credentials.loadDocument('addons');
    this.bookLinks = bookLinksSchema.parse(await this.credentials.loadDocument('book-links') ?? []);
    const debrid = debridSchema.safeParse(await this.credentials.loadDocument('debrid')); if (debrid.success) { this.debridKey = debrid.data.realDebrid; this.debridName = debrid.data.username; }
    this.installed = saved === null ? [{ kind: 'stremio',id: 'f60fa3c7-e121-4452-bc0b-907d580af250',url: 'https://v3-cinemeta.strem.io/manifest.json',enabled: true,manifest: manifestSchema.parse({ id: 'com.linvo.cinemeta',name: 'Cinemeta',description: 'Catálogo de filmes e séries do Stremio.',resources: ['catalog','meta'],types: ['movie','series'],idPrefixes: ['tt'],catalogs: ['movie','series'].map(type => ({ type,id: 'top',name: type === 'movie' ? 'Filmes populares' : 'Séries populares',extra: [{ name: 'search' },{ name: 'skip' },{ name: 'genre',options: ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Mystery','Romance','Sci-Fi','Thriller'] }] })) }) }] : installedSchema.parse(saved);
    let migrated = false;
    const textOnly = (addon: Installed) => /(^|\.)gutenberg\.org$/.test(new URL(addon.url).hostname);
    for (const addon of this.installed) if (addon.kind === 'opds' && textOnly(addon) && addon.manifest.types.includes('audiobook')) {
      addon.manifest.types = addon.manifest.types.filter(type => type !== 'audiobook'); addon.manifest.catalogs = addon.manifest.catalogs.filter(catalog => catalog.type !== 'audiobook'); migrated = true;
    }
    for (const addon of this.installed) if (addon.kind === 'opds' && !textOnly(addon) && !addon.manifest.types.includes('audiobook')) {
      addon.manifest.types.push('audiobook');
      addon.manifest.catalogs.push(...addon.manifest.catalogs.filter(c => c.type === 'book').map(c => ({ ...c,type: 'audiobook',name: c.id === 'root' ? 'Audiobooks' : c.name })));
      migrated = true;
    }
    for (const addon of this.installed) if (addon.kind === 'abb') for (const catalog of addon.manifest.catalogs) if (!catalog.extra?.some(extra => extra.name === 'skip')) { catalog.extra = [...(catalog.extra ?? []),{ name: 'skip' }]; migrated = true; }
    if (migrated) await this.persist();
    if (saved === null) {
      this.installed.push({ kind: 'stremio',id: '6d55f2e7-d36c-47fa-b88c-58ce883a04b3',url: 'https://torrentio.strem.fun/manifest.json',enabled: true,manifest: manifestSchema.parse({ id: 'com.stremio.torrentio.addon',name: 'Torrentio',description: 'Fontes torrent para filmes e séries. Você pode substituir a configuração padrão por um link personalizado.',resources: [{ name: 'stream',types: ['movie','series'],idPrefixes: ['tt'] }],types: ['movie','series'],catalogs: [] }) });
      await this.persist();
    }
  }
  list(): AddonSummary[] { return this.installed.map(addon => ({ id: addon.id,name: addon.manifest.name,description: addon.manifest.description,host: new URL(addon.url).host,enabled: addon.enabled,kind: addon.kind,types: addon.manifest.types,resources: addon.manifest.resources.map(r => typeof r === 'string' ? r : r.name),sourceResources: addon.manifest.resources.filter(r => (typeof r === 'string' ? r : r.name) === 'stream').map(r => typeof r === 'string' ? { types: addon.manifest.types,idPrefixes: addon.manifest.idPrefixes } : { types: r.types ?? addon.manifest.types,idPrefixes: r.idPrefixes }),catalogs: addon.manifest.catalogs.filter(c => ['movie','series','book','audiobook'].includes(c.type)).map(c => ({ id: c.id,type: c.type as OnlineType,name: c.name ?? c.id,search: !!c.extra?.some(e => e.name === 'search'),searchRequired: !!c.extra?.some(e => e.name === 'search' && e.isRequired),pagination: !!c.extra?.some(e => e.name === 'skip'),genres: c.extra?.find(e => e.name === 'genre')?.options ?? [] })) })); }
  private async persist() { await this.credentials.saveDocument('addons',this.installed); }
  private get(id: string) { const addon = this.installed.find(a => a.id === id); if (!addon) throw new Error('Complemento não encontrado.'); return addon; }
  private supports(addon: Installed,name: string,type: OnlineType,id: string) {
    if (!addon.enabled) return false;
    return addon.manifest.resources.some(resource => {
      const r = typeof resource === 'string' ? { name: resource } : resource;
      const prefixes = typeof resource === 'string' ? addon.manifest.idPrefixes : r.idPrefixes;
      return r.name === name && (r.types ?? addon.manifest.types).includes(type) && (!prefixes?.length || prefixes.some(prefix => id.startsWith(prefix)));
    });
  }
  private async document(url: string,limit = 5_000_000,headers?: Record<string,string>) {
    const signal = AbortSignal.any([this.controller.signal,AbortSignal.timeout(25000)]);
    try {
      let response = await (this.runtime.fetch ?? fetch)(url,{ signal,headers });
      // Public catalogs answer 502-504 under load; one quiet retry usually succeeds.
      if (response.status >= 500) { await new Promise(resolve => setTimeout(resolve,1500)); response = await (this.runtime.fetch ?? fetch)(url,{ signal,headers }); }
      if (!response.ok) throw new Error(response.status === 429 ? 'Limite de consultas atingido; tente novamente mais tarde.' : response.status === 401 || response.status === 403 ? 'Confira a configuração e a chave deste complemento.' : response.status >= 500 ? 'A fonte está instável no momento. Tente de novo em instantes.' : 'O complemento não respondeu à consulta.');
      if (!response.body) throw new Error('Resposta vazia do complemento.');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done,value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('A resposta do complemento excedeu o limite.'); } chunks.push(value); }
      return { body: new TextDecoder().decode(joinChunks(chunks)),url: response.url || url };
    } catch (error: any) { if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('A consulta foi interrompida ou demorou demais.'); if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('Não foi possível consultar o complemento. Verifique o link e a conexão.'); throw error; }
  }
  private async json(url: string,limit = 5_000_000) { return JSON.parse((await this.document(url,limit)).body); }
  async install(value: string) {
    const initial = transportURL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value : `https://${value.trim()}`); const candidates = [initial];
    if (!initial.pathname.endsWith('/manifest.json')) {
      const candidate = new URL(initial); candidate.pathname = `${candidate.pathname.replace(/\/(?:configure)?$/, '').replace(/\/$/,'')}/manifest.json`;
      candidates.push(candidate);
    }
    let detected: Omit<Installed,'id'|'enabled'> | undefined = /(^|\.)openlibrary\.org$/.test(initial.hostname) ? this.openLibraryAddon() : undefined;
    for (const candidate of detected ? [] : candidates) {
      try {
        const response = await this.document(candidate.href,1_000_000);
        let json: unknown; try { json = JSON.parse(response.body); } catch { /* OPDS can be XML. */ }
        const parsed = manifestSchema.safeParse(json);
        if (parsed.success) { const base = transportURL(response.url); if (!base.pathname.endsWith('/manifest.json')) base.pathname = `${base.pathname.replace(/\/$/,'')}/manifest.json`; detected = { kind: 'stremio',url: base.href,manifest: parsed.data }; break; }
        const feed = parseOPDS(response.body,response.url);
        let search = feed.search?.url;
        if (feed.search?.openSearch) { const description = await this.document(feed.search.url,250_000); search = openSearchTemplate(description.body,description.url); }
        // A Gutenberg address filtered by language (query=l.pt) keeps that filter in text searches too.
        const address = new URL(response.url); const prefix = /(^|\.)gutenberg\.org$/.test(address.hostname) ? address.searchParams.get('query')?.match(/^l\.[a-z]{2,3}$/i)?.[0] : undefined;
        const gutenberg = /(^|\.)gutenberg\.org$/.test(address.hostname);
        const label = prefix ? new Intl.DisplayNames(['pt-BR'],{ type: 'language' }).of(prefix.slice(2).toLowerCase()) : undefined; const title = label ? `Project Gutenberg · ${label[0].toUpperCase()}${label.slice(1)}` : feed.name;
        if (prefix && search) search = search.replace(/%7BsearchTerms%7D|\{searchTerms\}/i,`${prefix}+{searchTerms}`);
        const catalogs = [{ id: 'root',url: response.url },...feed.navigation.map((link,index) => ({ id: `section-${index}`,url: link.url }))];
        detected = { kind: 'opds',url: transportURL(response.url).href,opds: { search,catalogs },manifest: manifestSchema.parse({ id: `opds.${createHash('sha256').update(response.url).digest('hex')}`,name: title,description: 'Catálogo OPDS de livros e audiobooks.',types: gutenberg ? ['book'] : ['book','audiobook'],resources: ['catalog','meta','stream'],catalogs: (gutenberg ? ['book'] : ['book','audiobook']).flatMap(type => catalogs.map((c,index) => ({ id: c.id,type,name: index ? feed.navigation[index-1].name : type === 'audiobook' ? 'Audiobooks' : 'Livros',extra: search ? [{ name: 'search' }] : [] }))) }) };
        break;
      } catch { /* Try the conventional manifest endpoint after the supplied URL. */ }
    }
    if (!detected) detected = await this.detectAudiobookBay(initial.href);
    if (!detected) throw new Error('Não foi possível identificar a fonte. Cole um link de complemento Stremio (manifest.json, stremio:// ou endereço base), de catálogo de livros OPDS ou o endereço do AudiobookBay. Confira a conexão e a configuração da fonte.');
    const previous = this.installed.find(a => a.url === detected!.url || a.manifest.id === detected!.manifest.id);
    if (!previous && this.installed.length >= 50) throw new Error('O limite é de 50 fontes instaladas. Remova uma antes de adicionar outra.');
    const next: Installed = { ...detected,id: previous?.id ?? randomUUID(),enabled: true };
    const old = this.installed; this.installed = [...this.installed.filter(a => a !== previous),next];
    try { await this.persist(); } catch (error) { this.installed = old; throw error; }
    for (const [key,reference] of this.references) if (reference.summary.addonId === next.id) this.references.delete(key);
    this.plans.clear();
  }
  private async detectAudiobookBay(value: string): Promise<Omit<Installed,'id'|'enabled'> | undefined> {
    try {
      const base = abbDomain(value); const page = await this.document(base,2_000_000,browserHeaders);
      if (!parseAbbList(page.body,page.url).length) return;
      return { kind: 'abb',url: base,manifest: manifestSchema.parse({ id: `abb.${new URL(base).host}`,name: 'AudiobookBay',description: 'Audiobooks por torrent. Os lançamentos aparecem no catálogo e a busca consulta o site.',types: ['audiobook'],resources: ['catalog','meta','stream'],catalogs: [{ id: 'latest',type: 'audiobook',name: 'Lançamentos',extra: [{ name: 'search' },{ name: 'skip' }] }] }) };
    } catch { return; }
  }
  private openLibraryAddon(): Omit<Installed,'id'|'enabled'> {
    const extra = [{ name: 'search' },{ name: 'skip' }];
    return { kind: 'openlibrary',url: 'https://openlibrary.org/',manifest: manifestSchema.parse({ id: 'openlibrary',name: 'Open Library',description: 'Catálogo livre de todos os livros, com filtro em português. Mostra edições para baixar quando são domínio público e o endereço do livro para os demais.',types: ['book'],resources: ['catalog','meta','stream'],catalogs: [{ id: 'all',type: 'book',name: 'Todos os livros',extra },{ id: 'pt',type: 'book',name: 'Em português',extra }] }) };
  }
  private async openLibraryCatalog(addon: Installed,type: OnlineType,catalogId: string,query: string,skip: number) {
    if (type !== 'book') throw new Error('Esta fonte oferece apenas livros.');
    const page = await this.document(openLibraryURL(query,skip,catalogId === 'pt'));
    return parseOpenLibrary(page.body).map(book => this.expose(this.store.cache({ id: openLibraryId(book.key),addonId: addon.id,type,name: book.title,year: book.year,description: '',poster: book.poster,authors: book.authors,genres: book.subjects,imdbRating: null,videos: [] })));
  }
  private async openLibrarySources(addon: Installed,item: OnlineItem,add: (summary: OnlineSource,raw: RawSource) => void,errors: string[]) {
    const key = openLibraryKey(item.id); const link = (name: string,description: string,url: string) => add({ id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name,description,transport: 'http',provider: name,releaseGroup: '',external: true },{ url });
    // Public-domain editions come from Project Gutenberg, matched by title and author; everything else opens on Open Library.
    try {
      const author = item.authors?.[0]?.split(',')[0] ?? ''; const search = new URL('https://www.gutenberg.org/ebooks/search.opds/'); search.searchParams.set('query',`${item.name} ${author}`.trim());
      const feed = parseOPDS((await this.document(search.href)).body,search.href); const match = feed.books.find(book => book.detail && sameTitle(book.name.replace(/\s*\([^)]*\)\s*$/,''),item.name));
      if (match?.detail) {
        const seen = new Set<string>(); const links = parseOPDS((await this.document(match.detail)).body,match.detail).books.flatMap(book => book.links).filter(entry => !entry.external && !seen.has(entry.url) && seen.add(entry.url)).slice(0,12);
        for (const entry of links) add({ id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name: `Project Gutenberg · ${entry.name}`,description: 'Edição de domínio público, sem custo.',transport: 'http',provider: 'Project Gutenberg',releaseGroup: '',format: entry.format,tags: ['Domínio público',entry.format?.toUpperCase()].filter(Boolean) as string[] },{ url: entry.url,behaviorHints: { filename: entry.format ? `livro.${entry.format}` : undefined } });
      }
    } catch (error: any) { errors.push(`Project Gutenberg: ${error.message}`); }
    link('Open Library',item.authors?.length ? 'Detalhes, edições, empréstimo digital e onde comprar. Abre no navegador.' : 'Detalhes e edições. Abre no navegador.',openLibraryPage(key));
  }
  private abbPage(body: string) {
    if (/cf-browser-verification|Just a moment\.\.\./i.test(body)) throw new Error('O AudiobookBay pediu uma verificação do navegador. Tente outro endereço do site.');
    return body;
  }
  private async abbCatalog(addon: Installed,type: OnlineType,query: string,skip: number) {
    if (type !== 'audiobook') throw new Error('Esta fonte oferece apenas audiobooks.');
    const page = await this.document(abbSearchURL(addon.url,query,Math.floor(skip/abbPageSize)+1),5_000_000,browserHeaders);
    return parseAbbList(this.abbPage(page.body),page.url).map(entry => {
      const { name,authors } = splitAbbTitle(entry.title);
      return this.expose(this.store.cache({ id: abbItemId(entry.path),addonId: addon.id,type,name,year: '',description: entry.title,poster: entry.poster,authors,genres: [],imdbRating: null,videos: [] }));
    });
  }
  debrid() { return { realDebrid: !!this.debridKey,username: this.debridName }; }
  async saveDebrid(token: string | null) {
    const value = token?.trim() ?? '';
    // A bad key is rejected here, with the provider's reason, instead of failing later inside a source list.
    const user = value ? await new RealDebrid(value,this.runtime.fetch ?? fetch,this.controller.signal).user() : { username: '',premium: false };
    if (value && !user.premium) throw new Error('Sua conta do Real-Debrid não tem acesso premium ativo.');
    await this.credentials.saveDocument('debrid',{ realDebrid: value,username: user.username });
    this.debridKey = value; this.debridName = user.username;
    for (const [key,reference] of this.references) if (reference.summary.provider === 'AudiobookBay' || reference.summary.provider === 'Real-Debrid') this.references.delete(key);
  }
  async change(action: 'remove'|'enable'|'disable',id: string) {
    this.get(id); const old = this.installed;
    this.installed = action === 'remove' ? old.filter(a => a.id !== id) : old.map(a => a.id === id ? { ...a,enabled: action === 'enable' } : a);
    try { await this.persist(); } catch (error) { this.installed = old; throw error; }
    for (const [key,reference] of this.references) if (reference.summary.addonId === id) this.references.delete(key);
    this.plans.clear();
  }
  configurationURL(id: string) { const addon = this.get(id); const url = new URL(addon.url); if (addon.kind !== 'stremio') return url.href; url.pathname = '/configure'; url.search = ''; return url.href; }
  private route(addon: Installed,resource: string,type: OnlineType,id: string,extra?: Record<string,string>) {
    const base = new URL(addon.url); const suffix = extra && Object.keys(extra).length ? `/${new URLSearchParams(extra).toString()}` : '';
    base.pathname = `${base.pathname.slice(0,-'manifest.json'.length)}${resource}/${type}/${encodeURIComponent(id)}${suffix}.json`;
    return base.href;
  }
  private image(value: unknown) {
    if (typeof value !== 'string' || !value) return undefined;
    let url: URL; try { url = transportURL(value); } catch { return undefined; }
    if (this.runtime.imageURL) return this.runtime.imageURL(url.href);
    let id = this.imageIds.get(url.href);
    if (!id) {
      if (this.images.size >= 5000) { const first = this.images.keys().next().value!; this.imageIds.delete(this.images.get(first)!); this.images.delete(first); }
      id = randomUUID(); this.images.set(id,url.href); this.imageIds.set(url.href,id);
    }
    return `cinessd://online-image/${id}`;
  }
  async imageResponse(id: string) {
    const url = this.images.get(id); if (!url) return new Response('',{ status: 404 });
    try {
      const response = await (this.runtime.fetch ?? fetch)(url,{ signal: AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]) });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !type || !['image/jpeg','image/png','image/webp','image/avif'].includes(type) || !response.body) return new Response('',{ status: 404 });
      const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
      while (true) { const { done,value } = await reader.read(); if (done) break; size += value.length; if (size > 5_000_000) { await reader.cancel(); return new Response('',{ status: 413 }); } chunks.push(value); }
      return new Response(joinChunks(chunks),{ headers: { 'content-type': type,'cache-control': 'private, max-age=3600' } });
    } catch { return new Response('',{ status: 404 }); }
  }
  private expose(item: OnlineItem) { return { ...item,poster: this.image(item.poster),background: this.image(item.background) }; }
  private cache(addonId: string,data: any,expectedType: OnlineType) {
    const id = idString.parse(data.id); const type = z.enum(['movie','series','book','audiobook']).parse(data.type ?? expectedType);
    if (type !== expectedType) throw new Error('O catálogo retornou um tipo de título diferente do solicitado.');
    const rating = Number(data.imdbRating);
    return this.store.cache({ id,addonId,type,name: text(data.name,500) || id,year: text(data.releaseInfo,30),description: text(data.description),narrators: type === 'audiobook' && Array.isArray(data.narrators) ? data.narrators.map((person: unknown) => text(person,500)).filter(Boolean).slice(0,30) : undefined,authors: ['book','audiobook'].includes(type) ? (Array.isArray(data.authors ?? data.author) ? data.authors ?? data.author : [data.author]).map((author: unknown) => text(author,500)).filter(Boolean).slice(0,30) : undefined,poster: text(data.poster,5000) || undefined,background: text(data.background,5000) || undefined,genres: Array.isArray(data.genres) ? data.genres.filter((x: any) => typeof x === 'string').slice(0,30) : [],imdbRating: data.imdbRating && Number.isFinite(rating) && rating >= 0 && rating <= 10 ? rating : null,videos: (Array.isArray(data.videos) ? data.videos : []).slice(0,10000).filter((v: any) => typeof v.id === 'string' && Number.isInteger(v.season) && Number.isInteger(v.episode)).map((v: any) => ({ id: v.id,title: text(v.title,500) || `Episódio ${v.episode}`,season: v.season,episode: v.episode,overview: text(v.overview),released: text(v.released,100) })) });
  }
  async catalog(addonId: string,catalogId: string,type: OnlineType,query = '',skip = 0,genre = '') {
    const addon = this.get(addonId); if (!addon.enabled) throw new Error('Ative o complemento para usar seu catálogo.');
    const catalog = addon.manifest.catalogs.find(c => c.id === catalogId && c.type === type); if (!catalog) throw new Error('Catálogo não encontrado.');
    const extras: Record<string,string> = {};
    if (addon.kind === 'opds') return this.opdsCatalog(addon,type,catalogId,query);
    if (addon.kind === 'abb') return this.abbCatalog(addon,type,query,skip);
    if (addon.kind === 'openlibrary') return this.openLibraryCatalog(addon,type,catalogId,query,skip);
    if (query) { if (!catalog.extra?.some(e => e.name === 'search')) throw new Error('Este catálogo não oferece busca.'); extras.search = query; }
    if (skip) { if (!catalog.extra?.some(e => e.name === 'skip')) throw new Error('Este catálogo não oferece paginação.'); extras.skip = String(skip); }
    if (genre) extras.genre = genre;
    for (const extra of catalog.extra ?? []) if (extra.isRequired && !extras[extra.name]) throw new Error(`Este catálogo exige o filtro ${extra.name}.`);
    const data = await this.json(this.route(addon,'catalog',type,catalogId,extras));
    if (!Array.isArray(data.metas)) throw new Error('O complemento retornou um catálogo inválido.');
    return data.metas.slice(0,250).flatMap((meta: any) => { try { return [this.expose(this.cache(addonId,meta,type))]; } catch { return []; } });
  }
  private async opdsCatalog(addon: Installed,type: OnlineType,catalogId: string,query: string) {
    if (!['book','audiobook'].includes(type) || !addon.opds) throw new Error('Esta fonte oferece apenas livros e audiobooks.');
    const catalog = addon.opds.catalogs.find(c => c.id === catalogId); if (!catalog) throw new Error('Catálogo não encontrado.');
    if (query && !addon.opds.search) throw new Error('Esta fonte de livros não oferece busca.');
    const url = query ? searchURL(addon.opds.search!,query) : catalog.url;
    const response = await this.document(url); const feed = parseOPDS(response.body,response.url);
    const items = feed.books.filter(book => book.type === type).map(book => {
      const id = `opds:${type === 'audiobook' ? 'audio:' : ''}${createHash('sha256').update(book.id).digest('hex')}`;
      this.bookLinks = this.bookLinks.filter(entry => entry.addonId !== addon.id || entry.id !== id);
      this.bookLinks.push({ addonId: addon.id,id,detail: book.detail,links: book.links });
      return this.expose(this.store.cache({ id,addonId: addon.id,type,name: book.name,year: book.year,description: book.description,poster: book.poster,authors: book.authors,narrators: book.narrators,genres: [],imdbRating: null,videos: [] }));
    });
    this.bookLinks = this.bookLinks.slice(-1000); const snapshot = structuredClone(this.bookLinks);
    const task = this.bookPersist.then(() => this.credentials.saveDocument('book-links',snapshot)); this.bookPersist = task.catch(() => {}); await task;
    return items;
  }
  async search(type: OnlineType,query: string,onlyAddon?: string): Promise<CatalogResult> {
    if (onlyAddon) this.get(onlyAddon);
    const candidates = this.list().filter(addon => addon.enabled && (!onlyAddon || addon.id === onlyAddon)).flatMap(addon => addon.catalogs.filter(c => c.type === type).filter((c,index) => addon.kind !== 'opds' || index === 0).map(catalog => ({ addon,catalog })));
    const supported = candidates.filter(({ catalog }) => query.trim() ? catalog.search : !catalog.searchRequired); const results: { items: OnlineItem[]; error?: string }[] = [];
    for (let i = 0; i < supported.length; i += 4) {
      results.push(...await Promise.all(supported.slice(i,i+4).map(async ({ addon,catalog }) => {
        try { return { items: await this.catalog(addon.id,catalog.id,type,query) }; }
        catch (error: any) { return { items: [],error: `${addon.name} · ${catalog.name}: ${error.message}` }; }
      })));
    }
    const seen = new Set<string>();
    return { items: results.flatMap(result => result.items).filter(item => { const key = `${item.addonId}:${item.type}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; }),errors: results.flatMap(result => result.error ? [result.error] : []),searched: supported.length,skipped: candidates.length-supported.length };
  }
  async meta(addonId: string,type: OnlineType,id: string) {
    const requested = this.get(addonId);
    if (requested.kind !== 'stremio') return this.expose(this.store.get(type,id));
    const candidates = this.installed.filter(a => this.supports(a,'meta',type,id)).sort((a,b) => Number(b.id === addonId)-Number(a.id === addonId));
    for (const addon of candidates) {
      try { const data = await this.json(this.route(addon,'meta',type,id)); if (data.meta?.id === id) return this.expose(await this.localize(this.cache(addonId,data.meta,type))); } catch { /* A second metadata addon or the saved preview may still work. */ }
    }
    return this.expose(await this.localize(this.store.get(type,id)));
  }
  private async localize(item: OnlineItem) {
    if (['book','audiobook'].includes(item.type)) return item;
    const previous = this.store.localization(item.type,item.id);
    if (this.translate && (!previous || Date.now()-Date.parse(previous.updatedAt) >= 7*86400000)) {
      try { const value = await this.translate(item); if (value) this.store.saveLocalization(item.type,item.id,{ ...value,description: value.description || previous?.description,genres: value.genres?.length ? value.genres : previous?.genres }); }
      catch { /* Preserve the catalog and previously saved translations when offline. */ }
    }
    return this.store.get(item.type,item.id);
  }
  saved() { return this.store.saved().map(item => this.expose(item)); }
  source(id: string) { const source = this.references.get(id); if (!source || !this.get(source.summary.addonId).enabled) throw new Error('Esta fonte expirou. Busque as opções novamente.'); return source; }
  getStreamForSource(sourceId: string): BoundSource { return this.source(sourceId); }
  async sources(addonId: string,type: OnlineType,id: string,videoId: string,onlyAddon?: string): Promise<SourceResult> {
    this.get(addonId); if (onlyAddon) this.get(onlyAddon); const item = this.store.get(type,id);
    const video = item.videos.find(v => v.id === videoId);
    if (type !== 'series' ? videoId !== id : !video) throw new Error('Episódio inválido para esta série.');
    const sources: OnlineSource[] = []; const errors: string[] = [];
    await Promise.all(this.installed.filter(a => (!onlyAddon || a.id === onlyAddon) && this.supports(a,'stream',type,videoId)).map(async addon => {
      try {
        if (addon.kind === 'openlibrary') {
          await this.openLibrarySources(addon,item,(summary,raw) => { if (this.references.size >= 10000) this.references.delete(this.references.keys().next().value!); this.references.set(summary.id,{ summary,raw,item }); sources.push(summary); },errors);
          return;
        }
        if (addon.kind === 'abb') {
          const page = await this.document(new URL(abbItemPath(id),addon.url).href,2_000_000,browserHeaders); const detail = parseAbbDetail(this.abbPage(page.body));
          const audioFormats = /^(mp3|m4b|m4a|aac|ogg|flac|wav|opus)$/; const title = item.description || item.name;
          const megabytes = (bytes: number) => bytes ? `${(bytes/1024**2).toFixed(0)} MB` : '';
          const add = (summary: OnlineSource,raw: RawSource) => { if (this.references.size >= 10000) this.references.delete(this.references.keys().next().value!); this.references.set(summary.id,{ summary,raw,item }); sources.push(summary); };
          // Tags are what the source list shows at a glance, like a torrent list: provider status, format, bitrate and size.
          const torrent = (description: string,status: string) => { const format = detail.format?.toLowerCase(); add({ id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name: title,description,transport: 'torrent',provider: 'AudiobookBay',releaseGroup: '',format: format && audioFormats.test(format) ? format : undefined,tags: [status,detail.format,detail.bitrate,megabytes(detail.size)].filter(Boolean) as string[] },{ infoHash: detail.infoHash,sources: detail.trackers.map(tracker => `tracker:${tracker}`) }); };
          if (!this.debridKey) { torrent('Torrent do AudiobookBay, sem seeders informados. Configure o Real-Debrid em Complementos para ouvir sem depender deles.','Torrent'); return; }
          try {
            const result = await new RealDebrid(this.debridKey,this.runtime.fetch ?? fetch,this.controller.signal).resolve(detail.infoHash,detail.trackers,this.runtime.debridWait);
            if (result.state === 'ready') for (const [index,file] of result.files.entries()) {
              const format = audioFormat('',`https://x/${encodeURIComponent(file.name)}`); const many = result.files.length > 1;
              add({ id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name: file.name,description: `${title}\nReal-Debrid · link direto · pronto para ouvir`,transport: 'http',provider: 'Real-Debrid',releaseGroup: '',format,part: many ? index+1 : undefined,tags: ['RD+',many ? `Parte ${index+1} de ${result.files.length}` : '',format?.toUpperCase(),detail.bitrate,megabytes(file.size)].filter(Boolean) as string[] },{ url: file.url,behaviorHints: { filename: file.name } });
            } else { errors.push(`Real-Debrid: ainda preparando este audiobook (${Math.round(result.progress)}%). Busque as fontes de novo em instantes.`); torrent('Torrent direto do AudiobookBay, enquanto o Real-Debrid termina de prepará-lo.',`RD ${Math.round(result.progress)}%`); }
          } catch (error: any) { errors.push(`Real-Debrid: ${error.message}`); torrent('Torrent direto do AudiobookBay.','Torrent'); }
          return;
        }
        if (addon.kind === 'opds') {
          const saved = this.bookLinks.find(entry => entry.addonId === addon.id && entry.id === id); let links = saved?.links ?? [];
          if (!links.length && saved?.detail) {
            // The catalog only linked to the book's own feed; its download links are read when the title is opened.
            try { const feed = parseOPDS((await this.document(saved.detail)).body,saved.detail); const seen = new Set<string>(); links = feed.books.filter(book => book.type === type).flatMap(book => book.links).filter(link => !seen.has(link.url) && seen.add(link.url)).slice(0,30); }
            catch (error: any) { errors.push(`${addon.manifest.name}: ${error.message}`); }
          }
          let part = 0;
          for (const original of links) {
            let resolved = [original];
            if (type === 'audiobook' && original.manifest) {
              try { const document = await this.document(original.url); resolved = audioManifest(document.body,document.url); }
              catch (error: any) { errors.push(`${addon.manifest.name}: ${error.message}`); }
            }
            for (const link of resolved) {
              const chapter = original.manifest && !link.external ? ++part : undefined;
              if (this.references.size >= 10000) this.references.delete(this.references.keys().next().value!);
              const raw: RawSource = { url: transportURL(link.url).href,behaviorHints: { filename: link.format ? `livro.${link.format}` : undefined } };
              const summary: OnlineSource = { id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name: link.name,description: link.external ? 'Acesso pelo navegador da fonte.' : type === 'audiobook' ? 'Áudio oferecido pelo catálogo.' : 'Arquivo de livro oferecido pelo catálogo.',transport: 'http',provider: '',releaseGroup: '',external: link.external,format: link.format,part: chapter };
              this.references.set(summary.id,{ summary,raw,item }); sources.push(summary);
            }
          }
          return;
        }
        const data = await this.json(this.route(addon,'stream',type,videoId)); if (!Array.isArray(data.streams)) throw new Error('Resposta de fontes inválida.');
        for (const stream of data.streams.slice(0,250)) {
          if (!stream || typeof stream !== 'object') continue;
          const raw: RawSource = {};
          if (typeof stream.infoHash === 'string' && /^[a-f\d]{40}$/i.test(stream.infoHash)) {
            raw.infoHash = stream.infoHash.toLowerCase(); if (Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0) raw.fileIdx = stream.fileIdx;
            raw.sources = Array.isArray(stream.sources) ? stream.sources.filter((s: unknown) => typeof s === 'string').slice(0,100) : [];
          } else if (typeof stream.url === 'string') { try { const url = transportURL(stream.url); if (/\.(m3u8|mpd)$/i.test(url.pathname)) continue; raw.url = url.href; } catch { continue; } }
          else continue;
          const filename = text(stream.behaviorHints?.filename,1000);
          const name = text(stream.name,500) || addon.manifest.name; const description = text(stream.description ?? stream.title,3000);
          const provider = description.match(/⚙️?\s*([^\n]+)/u)?.[1]?.trim() ?? '';
          const releaseGroup = filename.match(/-([\w]+)(?:\.[a-z\d]{2,4})?$/i)?.[1] ?? '';
          const headers = stream.behaviorHints?.proxyHeaders?.request;
          raw.behaviorHints = { filename,proxyHeaders: { request: headers && typeof headers === 'object' ? Object.fromEntries(Object.entries(headers).filter(([key,value]) => /^[a-z\d-]{1,100}$/i.test(key) && typeof value === 'string' && !/[\r\n]/.test(value) && value.length <= 8000)) as Record<string,string> : {} } };
          const details = sourceDetails({ ...stream,name,description,behaviorHints: { filename,videoSize: stream.behaviorHints?.videoSize } });
          const summary: OnlineSource = { format: type === 'audiobook' && raw.url ? audioFormat('',raw.url) : undefined,id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name,description,transport: raw.infoHash ? 'torrent' : 'http',provider,releaseGroup,details };
          if (this.references.size >= 10000) this.references.delete(this.references.keys().next().value!);
          this.references.set(summary.id,{ summary,raw,item,video }); sources.push(summary);
        }
      } catch (error: any) { errors.push(`${addon.manifest.name}: ${error.message}`); }
    }));
    sources.sort((a,b) => a.addonName.localeCompare(b.addonName));
    return { sources,errors };
  }
  async plan(addonId: string,id: string,season: number,sourceId: string) {
    const source = this.source(sourceId); const item = this.store.get('series',id);
    if (source.item.id !== id || source.item.type !== 'series' || source.video?.season !== season) throw new Error('Escolha uma fonte de um episódio desta temporada.');
    const videos = item.videos.filter(v => v.season === season).sort((a,b) => a.episode-b.episode);
    if (!videos.length || videos.length > 200) throw new Error('Esta temporada não tem episódios ou excede o limite de 200 episódios.');
    const plan: SeasonPlan = { id: randomUUID(),title: item.name,season,source: `${source.summary.addonName} · ${source.summary.name}${source.summary.provider ? ` · ${source.summary.provider}` : ''}${source.summary.releaseGroup ? ` · ${source.summary.releaseGroup}` : ''}`,episodes: [] };
    const needed = new Map<string,BoundSource>([[sourceId,source]]);
    for (let start = 0; start < videos.length; start += 3) {
      const entries = await Promise.all(videos.slice(start,start+3).map(async video => {
        if (video.id === source.video!.id) return { video,sources: [source.summary],selected: source.summary.id,error: undefined };
        const result = await this.sources(addonId,'series',id,video.id,source.summary.addonId);
        const match = result.sources.find(candidate => sameSource(source.summary,candidate));
        const alternatives = [...(match ? [match] : []),...result.sources.filter(candidate => candidate.id !== match?.id).slice(0,30)];
        for (const candidate of alternatives) needed.set(candidate.id,this.source(candidate.id));
        return { video,sources: alternatives,selected: match?.id ?? null,error: result.errors[0] };
      }));
      plan.episodes.push(...entries);
    }
    // Keep the reviewed choices usable even when a long season evicts intermediate search results.
    for (const [id,bound] of needed) { this.references.delete(id); if (this.references.size >= 10000) this.references.delete(this.references.keys().next().value!); this.references.set(id,bound); }
    if (this.plans.size >= 30) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id,plan); return plan;
  }
  planSources(id: string,selections: Record<string,string>) {
    const plan = this.plans.get(id); if (!plan) throw new Error('Revise a temporada novamente; este plano expirou.');
    const sources = Object.entries(selections).map(([videoId,sourceId]) => {
      const entry = plan.episodes.find(e => e.video.id === videoId);
      if (!entry?.sources.some(s => s.id === sourceId)) throw new Error('Uma fonte não pertence ao episódio escolhido.');
      return this.source(sourceId);
    });
    if (!sources.length) throw new Error('Escolha ao menos um episódio para baixar.'); return sources;
  }
  cancel() { this.controller.abort(); this.controller = new AbortController(); }
}
export type AddonsManager = Addons;
export const AddonsManager = Addons;
