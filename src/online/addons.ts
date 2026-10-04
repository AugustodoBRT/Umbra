import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AddonSummary, OnlineItem, OnlineSource, OnlineType, OnlineVideo, SourceResult, SeasonPlan, OnlineLocalization } from '../shared/online';
import { Credentials } from '../storage/credentials';
import { OnlineStore } from '../storage/online';
import { sourceDetails } from '../shared/sourceDetails';

const resource = z.union([z.string(),z.object({ name: z.string(),types: z.array(z.string()).optional(),idPrefixes: z.array(z.string()).optional() })]);
const manifestSchema = z.object({ id: z.string().max(200),name: z.string().max(200),description: z.string().max(5000).default(''),resources: z.array(resource).max(30),types: z.array(z.string()).max(30),idPrefixes: z.array(z.string()).optional(),catalogs: z.array(z.object({ id: z.string().max(300),type: z.string(),name: z.string().optional(),extra: z.array(z.object({ name: z.string(),isRequired: z.boolean().optional(),options: z.array(z.string()).optional() })).optional() })).max(100).default([]) });
const installedSchema = z.array(z.object({ id: z.string().uuid(),url: z.string(),enabled: z.boolean(),manifest: manifestSchema })).max(50);
type Installed = z.infer<typeof installedSchema>[number];
export interface RawSource { url?: string; infoHash?: string; fileIdx?: number; sources?: string[]; behaviorHints?: { filename?: string; proxyHeaders?: { request?: Record<string,string> } } }
export interface BoundSource { summary: OnlineSource; raw: RawSource; item: OnlineItem; video?: OnlineVideo }
const idString = z.string().min(1).max(500);
const text = (value: unknown,limit = 10000) => typeof value === 'string' ? value.slice(0,limit) : '';
export function transportURL(value: string) {
  let source = value.trim(); if (source.startsWith('stremio://')) source = `https://${source.slice(10)}`;
  const url = new URL(source);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use um link HTTP(S) de manifest.json, sem usuário ou senha no endereço.');
  url.hash = ''; return url;
}
export function sameSource(a: OnlineSource,b: OnlineSource) { return a.addonId === b.addonId && a.name === b.name && a.provider === b.provider && a.releaseGroup === b.releaseGroup; }
export class Addons {
  private installed: Installed[] = [];
  private references = new Map<string,BoundSource>();
  private plans = new Map<string,SeasonPlan>();
  private images = new Map<string,string>();
  private imageIds = new Map<string,string>();
  private controller = new AbortController();
  constructor(private credentials: Credentials,readonly store: OnlineStore,private translate?: (item: OnlineItem) => Promise<OnlineLocalization | null>) {}
  async initialize() {
    const saved = await this.credentials.loadDocument('addons');
    this.installed = saved === null ? [{ id: 'f60fa3c7-e121-4452-bc0b-907d580af250',url: 'https://v3-cinemeta.strem.io/manifest.json',enabled: true,manifest: manifestSchema.parse({ id: 'com.linvo.cinemeta',name: 'Cinemeta',description: 'Catálogo de filmes e séries do Stremio.',resources: ['catalog','meta'],types: ['movie','series'],idPrefixes: ['tt'],catalogs: ['movie','series'].map(type => ({ type,id: 'top',name: type === 'movie' ? 'Filmes populares' : 'Séries populares',extra: [{ name: 'search' },{ name: 'skip' },{ name: 'genre',options: ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Mystery','Romance','Sci-Fi','Thriller'] }] })) }) }] : installedSchema.parse(saved);
    if (saved === null) {
      this.installed.push({ id: '6d55f2e7-d36c-47fa-b88c-58ce883a04b3',url: 'https://torrentio.strem.fun/manifest.json',enabled: true,manifest: manifestSchema.parse({ id: 'com.stremio.torrentio.addon',name: 'Torrentio',description: 'Fontes torrent para filmes e séries. Você pode substituir a configuração padrão por um link personalizado.',resources: [{ name: 'stream',types: ['movie','series'],idPrefixes: ['tt'] }],types: ['movie','series'],catalogs: [] }) });
      await this.persist();
    }
  }
  list(): AddonSummary[] { return this.installed.map(addon => ({ id: addon.id,name: addon.manifest.name,description: addon.manifest.description,host: new URL(addon.url).host,enabled: addon.enabled,resources: addon.manifest.resources.map(r => typeof r === 'string' ? r : r.name),catalogs: addon.manifest.catalogs.filter(c => ['movie','series'].includes(c.type)).map(c => ({ id: c.id,type: c.type as OnlineType,name: c.name ?? c.id,search: !!c.extra?.some(e => e.name === 'search'),pagination: !!c.extra?.some(e => e.name === 'skip'),genres: c.extra?.find(e => e.name === 'genre')?.options ?? [] })) })); }
  private async persist() { await this.credentials.saveDocument('addons',this.installed); }
  private get(id: string) { const addon = this.installed.find(a => a.id === id); if (!addon) throw new Error('Complemento não encontrado.'); return addon; }
  private supports(addon: Installed,name: string,type: OnlineType,id: string) {
    if (!addon.enabled) return false;
    return addon.manifest.resources.some(resource => {
      const r = typeof resource === 'string' ? { name: resource } : resource;
      const prefixes = r.idPrefixes ?? addon.manifest.idPrefixes;
      return r.name === name && (r.types ?? addon.manifest.types).includes(type) && (!prefixes?.length || prefixes.some(prefix => id.startsWith(prefix)));
    });
  }
  private async json(url: string,limit = 5_000_000) {
    const signal = AbortSignal.any([this.controller.signal,AbortSignal.timeout(25000)]);
    try {
      const response = await fetch(url,{ signal });
      if (!response.ok) throw new Error(response.status === 429 ? 'Limite de consultas atingido; tente novamente mais tarde.' : response.status === 401 || response.status === 403 ? 'Confira a configuração e a chave deste complemento.' : 'O complemento não respondeu à consulta.');
      if (!response.body) throw new Error('Resposta vazia do complemento.');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done,value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('A resposta do complemento excedeu o limite.'); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error: any) { if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('A consulta foi interrompida ou demorou demais.'); if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('Não foi possível consultar o complemento. Verifique o link e a conexão.'); throw error; }
  }
  async install(value: string) {
    const url = transportURL(value);
    if (!url.pathname.endsWith('/manifest.json')) throw new Error('Cole o link de instalação que termina em /manifest.json.');
    const manifest = manifestSchema.parse(await this.json(url.href,1_000_000));
    const previous = this.installed.find(a => a.url === url.href || a.manifest.id === manifest.id);
    const next: Installed = { id: previous?.id ?? randomUUID(),url: url.href,manifest,enabled: true };
    const old = this.installed; this.installed = [...this.installed.filter(a => a !== previous),next];
    try { await this.persist(); } catch (error) { this.installed = old; throw error; }
  }
  async change(action: 'remove'|'enable'|'disable',id: string) {
    this.get(id); const old = this.installed;
    this.installed = action === 'remove' ? old.filter(a => a.id !== id) : old.map(a => a.id === id ? { ...a,enabled: action === 'enable' } : a);
    try { await this.persist(); } catch (error) { this.installed = old; throw error; }
    for (const [key,reference] of this.references) if (reference.summary.addonId === id) this.references.delete(key);
    this.plans.clear();
  }
  configurationURL(id: string) { const url = new URL(this.get(id).url); url.pathname = '/configure'; url.search = ''; return url.href; }
  private route(addon: Installed,resource: string,type: OnlineType,id: string,extra?: Record<string,string>) {
    const base = new URL(addon.url); const suffix = extra && Object.keys(extra).length ? `/${new URLSearchParams(extra).toString()}` : '';
    base.pathname = `${base.pathname.slice(0,-'manifest.json'.length)}${resource}/${type}/${encodeURIComponent(id)}${suffix}.json`;
    return base.href;
  }
  private image(value: unknown) {
    if (typeof value !== 'string' || !value) return undefined;
    let url: URL; try { url = transportURL(value); } catch { return undefined; }
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
      const response = await fetch(url,{ signal: AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]) });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !type || !['image/jpeg','image/png','image/webp','image/avif'].includes(type) || !response.body) return new Response('',{ status: 404 });
      const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
      while (true) { const { done,value } = await reader.read(); if (done) break; size += value.length; if (size > 5_000_000) { await reader.cancel(); return new Response('',{ status: 413 }); } chunks.push(value); }
      return new Response(Buffer.concat(chunks),{ headers: { 'content-type': type,'cache-control': 'private, max-age=3600' } });
    } catch { return new Response('',{ status: 404 }); }
  }
  private expose(item: OnlineItem) { return { ...item,poster: this.image(item.poster),background: this.image(item.background) }; }
  private cache(addonId: string,data: any,expectedType: OnlineType) {
    const id = idString.parse(data.id); const type = z.enum(['movie','series']).parse(data.type ?? expectedType);
    const rating = Number(data.imdbRating);
    return this.store.cache({ id,addonId,type,name: text(data.name,500) || id,year: text(data.releaseInfo,30),description: text(data.description),poster: text(data.poster,5000) || undefined,background: text(data.background,5000) || undefined,genres: Array.isArray(data.genres) ? data.genres.filter((x: any) => typeof x === 'string').slice(0,30) : [],imdbRating: data.imdbRating && Number.isFinite(rating) && rating >= 0 && rating <= 10 ? rating : null,videos: (Array.isArray(data.videos) ? data.videos : []).slice(0,10000).filter((v: any) => typeof v.id === 'string' && Number.isInteger(v.season) && Number.isInteger(v.episode)).map((v: any) => ({ id: v.id,title: text(v.title,500) || `Episódio ${v.episode}`,season: v.season,episode: v.episode,overview: text(v.overview),released: text(v.released,100) })) });
  }
  async catalog(addonId: string,catalogId: string,type: OnlineType,query = '',skip = 0,genre = '') {
    const addon = this.get(addonId); if (!addon.enabled) throw new Error('Ative o complemento para usar seu catálogo.');
    const catalog = addon.manifest.catalogs.find(c => c.id === catalogId && c.type === type); if (!catalog) throw new Error('Catálogo não encontrado.');
    const extras: Record<string,string> = {};
    if (query) { if (!catalog.extra?.some(e => e.name === 'search')) throw new Error('Este catálogo não oferece busca.'); extras.search = query; }
    if (skip) { if (!catalog.extra?.some(e => e.name === 'skip')) throw new Error('Este catálogo não oferece paginação.'); extras.skip = String(skip); }
    if (genre) extras.genre = genre;
    for (const extra of catalog.extra ?? []) if (extra.isRequired && !extras[extra.name]) throw new Error(`Este catálogo exige o filtro ${extra.name}.`);
    const data = await this.json(this.route(addon,'catalog',type,catalogId,extras));
    if (!Array.isArray(data.metas)) throw new Error('O complemento retornou um catálogo inválido.');
    return data.metas.slice(0,250).flatMap((meta: any) => { try { return [this.expose(this.cache(addonId,meta,type))]; } catch { return []; } });
  }
  async meta(addonId: string,type: OnlineType,id: string) {
    this.get(addonId);
    const candidates = this.installed.filter(a => this.supports(a,'meta',type,id)).sort((a,b) => Number(b.id === addonId)-Number(a.id === addonId));
    for (const addon of candidates) {
      try { const data = await this.json(this.route(addon,'meta',type,id)); if (data.meta?.id === id) return this.expose(await this.localize(this.cache(addonId,data.meta,type))); } catch { /* A second metadata addon or the saved preview may still work. */ }
    }
    return this.expose(await this.localize(this.store.get(type,id)));
  }
  private async localize(item: OnlineItem) {
    const previous = this.store.localization(item.type,item.id);
    if (this.translate && (!previous || Date.now()-Date.parse(previous.updatedAt) >= 7*86400000)) {
      try { const value = await this.translate(item); if (value) this.store.saveLocalization(item.type,item.id,{ ...value,description: value.description || previous?.description,genres: value.genres?.length ? value.genres : previous?.genres }); }
      catch { /* Preserve the catalog and previously saved translations when offline. */ }
    }
    return this.store.get(item.type,item.id);
  }
  saved() { return this.store.saved().map(item => this.expose(item)); }
  source(id: string) { const source = this.references.get(id); if (!source || !this.get(source.summary.addonId).enabled) throw new Error('Esta fonte expirou. Busque as opções novamente.'); return source; }
  async sources(addonId: string,type: OnlineType,id: string,videoId: string,onlyAddon?: string): Promise<SourceResult> {
    this.get(addonId); const item = this.store.get(type,id);
    const video = item.videos.find(v => v.id === videoId);
    if (type === 'movie' ? videoId !== id : !video) throw new Error('Episódio inválido para esta série.');
    const sources: OnlineSource[] = []; const errors: string[] = [];
    await Promise.all(this.installed.filter(a => (!onlyAddon || a.id === onlyAddon) && this.supports(a,'stream',type,videoId)).map(async addon => {
      try {
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
          const summary: OnlineSource = { id: randomUUID(),addonId: addon.id,addonName: addon.manifest.name,name,description,transport: raw.infoHash ? 'torrent' : 'http',provider,releaseGroup,details };
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
