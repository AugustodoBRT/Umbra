import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../storage/store';
import type { Work, Candidate, Metadata, ExternalRating, IdentificationProgress } from '../shared/types';
import type { OnlineItem, OnlineLocalization } from '../shared/online';
import { normalize } from '../library/identify';
import { candidateSchema } from '../shared/validation';

export const emptyIdentification = (): IdentificationProgress => ({ running: false,total: 0,processed: 0,matched: 0,pending: 0,errors: [],candidates: {} });

export function confidence(work: Pick<Work,'title'|'year'>, title: string, original: string, year: number | null) {
  const exact = [title,original].some(x => normalize(x) === normalize(work.title));
  if (exact && work.year !== null && work.year === year) return 1;
  if (exact && work.year === null) return .8;
  if (exact && work.year !== null && year !== null && Math.abs(work.year-year) === 1) return .85;
  return .3;
}
export function strongMatch(candidates: Candidate[]) { const strong = candidates.filter(x => x.confidence >= .98); return strong.length === 1 ? strong[0] : null; }
export class Providers {
  tmdb = '';
  omdb = '';
  private controller = new AbortController();
  private inFlight = 0;
  private waiting: (() => void)[] = [];
  cancel() { this.controller.abort(); this.controller = new AbortController(); }
  private async request(url: string, token?: string): Promise<any> {
    const signal = this.controller.signal;
    if (this.inFlight >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    signal.throwIfAborted(); this.inFlight++;
    try {
      const response = await fetch(url,{ headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : undefined, signal: AbortSignal.any([signal,AbortSignal.timeout(12000)]), redirect: 'error' });
      if (!response.ok) throw new Error(response.status === 429 ? 'Limite do provedor atingido. Tente mais tarde.' : response.status === 401 ? 'A chave do provedor não é válida.' : 'O provedor está indisponível.');
      return await response.json();
    } catch (e: any) { if (e.message?.includes('provedor') || e.message?.includes('Limite')) throw e; throw new Error('Sem conexão com o provedor. Sua biblioteca local continua disponível.'); }
    finally { this.inFlight--; this.waiting.shift()?.(); }
  }
  private tmdbRequest(endpoint: string, parameters: Record<string,string> = {}) {
    if (!this.tmdb) throw new Error('Configure a chave ou o token de acesso do TMDB nas configurações.');
    const query = new URLSearchParams({ language: 'pt-BR',...parameters });
    const isKey = /^[a-f0-9]{32}$/i.test(this.tmdb);
    if (isKey) query.set('api_key',this.tmdb);
    return this.request(`https://api.themoviedb.org/3/${endpoint}?${query}`,isKey ? undefined : this.tmdb);
  }
  async localizeOnline(item: Pick<OnlineItem,'id'|'type'>): Promise<OnlineLocalization | null> {
    if (!this.tmdb || !/^tt\d+$/.test(item.id)) return null;
    const data = await this.tmdbRequest(`find/${item.id}`,{ external_source: 'imdb_id' });
    const results = item.type === 'movie' ? data.movie_results : data.tv_results;
    if (!Array.isArray(results) || results.length !== 1 || !Number.isInteger(results[0].id)) return null;
    const type = item.type === 'movie' ? 'movie' : 'tv';
    const details = await this.tmdbRequest(`${type}/${results[0].id}`);
    const description = typeof details.overview === 'string' ? details.overview.trim().slice(0,10000) : undefined;
    const genres = Array.isArray(details.genres) ? details.genres.flatMap((genre: any) => typeof genre.name === 'string' ? [genre.name.slice(0,100)] : []).slice(0,30) : undefined;
    return { description: description || undefined,genres,updatedAt: new Date().toISOString() };
  }
  async search(work: Work, query: string): Promise<Candidate[]> {
    if (!['movie','series'].includes(work.kind)) throw new Error('Corrija a identificação a partir do filme ou da série.');
    const kind = work.kind as 'movie'|'series'; const type = kind === 'movie' ? 'movie' : 'tv';
    const byId = query.trim().match(/^(?:tmdb:)?(\d+)$/);
    const data = byId ? { results: [await this.tmdbRequest(`${type}/${byId[1]}`)] } : await this.tmdbRequest(`search/${type}`,{ query, include_adult: 'false' });
    return data.results.slice(0,12).map((item: any) => {
      const title = item.title ?? item.name; const original = item.original_title ?? item.original_name;
      const year = Number((item.release_date ?? item.first_air_date ?? '').slice(0,4)) || null;
      return { id: item.id,kind,title,originalTitle: original,year,overview: item.overview ?? '',poster: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : null,confidence: confidence(work,title,original,year) };
    }).sort((a: Candidate,b: Candidate) => b.confidence-a.confidence);
  }
  private async image(store: Store, remote: string | null, size: string) {
    if (!remote || !/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(remote)) return undefined;
    const target = path.join(store.directory,'capas',`${size}-${path.basename(remote)}`);
    const { access } = await import('node:fs/promises');
    try { await access(target); return `Biblioteca/capas/${path.basename(target)}`; } catch { /* Download only missing assets. */ }
    const signal = this.controller.signal;
    try {
      const response = await fetch(`https://image.tmdb.org/t/p/${size}${remote}`,{ signal: AbortSignal.any([signal,AbortSignal.timeout(15000)]), redirect: 'error' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return undefined;
      const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 15_000_000) return undefined;
      await store.assertDisk(); signal.throwIfAborted();
      const temp = `${target}.${randomUUID()}.tmp`; await writeFile(temp,bytes); await rename(temp,target);
      return `Biblioteca/capas/${path.basename(target)}`;
    } catch { return undefined; }
  }
  private async imdb(id?: string): Promise<ExternalRating | undefined> {
    if (!this.omdb || !id || !/^tt\d+$/.test(id)) return undefined;
    const data = await this.request(`https://www.omdbapi.com/?${new URLSearchParams({ apikey: this.omdb, i: id })}`);
    if (data.Response === 'False') {
      if (/key|limit/i.test(data.Error ?? '')) throw new Error('Verifique a chave e a quota do OMDb nas configurações.');
      return { value: null,votes: null,fetchedAt: new Date().toISOString() };
    }
    return { value: data.imdbRating && data.imdbRating !== 'N/A' ? Number(data.imdbRating) : null,votes: data.imdbVotes && data.imdbVotes !== 'N/A' ? Number(data.imdbVotes.replace(/,/g,'')) : null,fetchedAt: new Date().toISOString() };
  }
  async associate(store: Store, work: Work, candidate: Candidate) {
    if (candidate.kind !== work.kind) throw new Error('O tipo da obra não corresponde ao resultado.');
    const operationSignal = this.controller.signal;
    const type = candidate.kind === 'movie' ? 'movie' : 'tv';
    const data = await this.tmdbRequest(`${type}/${candidate.id}`,{ append_to_response: 'external_ids,credits,release_dates,content_ratings' });
    let overview = data.overview;
    if (!overview) { const fallback = await this.tmdbRequest(`${type}/${candidate.id}`,{ language: 'en-US' }); overview = fallback.overview; }
    const imdbId = data.imdb_id ?? data.external_ids?.imdb_id;
    let imdb: ExternalRating | undefined;
    try { imdb = await this.imdb(imdbId); } catch { /* TMDB enrichment remains useful when OMDb is offline. */ }
    const old = work.metadata;
    const metadata: Metadata = {
      originalTitle: data.original_title ?? data.original_name,overview,genres: data.genres?.map((x: any) => x.name),cast: data.credits?.cast?.slice(0,16).map((x: any) => x.name),director: data.credits?.crew?.find((x: any) => x.job === 'Director')?.name ?? data.created_by?.map((x: any) => x.name).join(', '),
      poster: await this.image(store,data.poster_path,'w500'),backdrop: await this.image(store,data.backdrop_path,'w1280'),tmdbId: data.id,imdbId,
      tmdb: { value: data.vote_count > 0 ? data.vote_average : null,votes: data.vote_count || null,fetchedAt: new Date().toISOString() },imdb: imdb ?? (old.imdbId === imdbId ? old.imdb : undefined),
      runtime: data.runtime ?? data.episode_run_time?.[0],status: data.status,collection: data.belongs_to_collection?.name,
      certification: type === 'movie' ? data.release_dates?.results?.find((x: any) => x.iso_3166_1 === 'BR')?.release_dates?.find((x: any) => x.certification)?.certification : data.content_ratings?.results?.find((x: any) => x.iso_3166_1 === 'BR')?.rating,
      updatedAt: new Date().toISOString()
    };
    operationSignal.throwIfAborted(); await store.assertDisk();
    store.saveMetadata(work.id,metadata,data.original_title ?? data.original_name ?? work.title,candidate.year);
    if (work.kind === 'series') {
      store.transaction(() => { for (const season of data.seasons ?? []) store.ensureSeason(work.id,season.season_number); });
      for (const season of store.detail(work.id).children ?? []) if (season.files.length) {
        operationSignal.throwIfAborted();
        try { await this.season(store,season); } catch { operationSignal.throwIfAborted(); /* A season failure must not undo the confirmed series. */ }
      }
    }
  }
  async season(store: Store, season: Work) {
    if (season.kind !== 'season' || !season.parentId) throw new Error('Temporada inválida.');
    const series = store.detail(season.parentId); if (!series.metadata.tmdbId) throw new Error('Identifique a série primeiro.');
    const operationSignal = this.controller.signal;
    const data = await this.tmdbRequest(`tv/${series.metadata.tmdbId}/season/${season.season}`);
    const episodes: { episode: any; metadata: Metadata }[] = [];
    for (const episode of data.episodes ?? []) {
      operationSignal.throwIfAborted();
      const ext = await this.tmdbRequest(`tv/${series.metadata.tmdbId}/season/${season.season}/episode/${episode.episode_number}/external_ids`);
      let imdb: ExternalRating | undefined; try { imdb = await this.imdb(ext.imdb_id); } catch { /* Keep TMDB data. */ }
      episodes.push({ episode, metadata: { overview: episode.overview,poster: await this.image(store,episode.still_path,'w500'),tmdbId: episode.id,imdbId: ext.imdb_id,imdb,tmdb: { value: episode.vote_count > 0 ? episode.vote_average : null,votes: episode.vote_count || null,fetchedAt: new Date().toISOString() },runtime: episode.runtime,updatedAt: new Date().toISOString() } });
    }
    operationSignal.throwIfAborted(); await store.assertDisk();
    store.transaction(() => {
      // saveMetadata uses a transaction; update episodes after this structural transaction.
      store.db.prepare('UPDATE works SET metadata=?,needs_identification=0 WHERE id=?').run(JSON.stringify({ overview: data.overview,tmdbId: data.id,updatedAt: new Date().toISOString() }),season.id);
    });
    for (const { episode,metadata } of episodes) store.upsertEpisode(season.id,`tmdb:tv:${series.metadata.tmdbId}`,season.season!,episode.episode_number,episode.name,metadata);
  }
  async enrich(store: Store, options: { force?: boolean; changed?: (state: IdentificationProgress) => void } = {}) {
    const state = emptyIdentification(); state.running = true;
    const publish = () => options.changed?.({ ...state,candidates: { ...state.candidates },errors: [...state.errors] });
    const signal = this.controller.signal;
    const works = store.works().filter(work => work.needsIdentification ? !!this.tmdb : !!this.tmdb && !!work.metadata.tmdbId && !!options.force || !!this.omdb && !!work.metadata.imdbId && (options.force || !work.metadata.imdb));
    state.total = works.length; publish();
    type Cached = { title: string; year: number | null; at: number; candidates: Candidate[] };
    const cache = store.setting<Record<string,Cached>>('identificationCache',{});
    try {
      for (const work of works) {
        signal.throwIfAborted();
        try {
          if (!work.needsIdentification) {
            if (options.force && this.tmdb && work.metadata.tmdbId) {
              await this.associate(store,work,{ id: work.metadata.tmdbId,kind: work.kind as 'movie'|'series',title: work.title,originalTitle: work.metadata.originalTitle ?? work.title,year: work.year,overview: work.metadata.overview ?? '',poster: null,confidence: 1 });
              state.matched++;
            } else {
              const imdb = await this.imdb(work.metadata.imdbId); signal.throwIfAborted(); await store.assertDisk();
              if (imdb) store.saveMetadata(work.id,{ ...work.metadata,imdb });
            }
          } else {
            const saved = cache[work.id];
            const fresh = !options.force && saved?.title === work.title && saved.year === work.year && Date.now()-saved.at < 86400000;
            const cached = fresh ? candidateSchema.array().safeParse(saved.candidates) : undefined;
            const candidates = cached?.success ? cached.data : await this.search(work,work.title);
            signal.throwIfAborted(); await store.assertDisk();
            cache[work.id] = { title: work.title,year: work.year,at: Date.now(),candidates };
            store.setSetting('identificationCache',cache);
            const candidate = strongMatch(candidates);
            if (candidate) { await this.associate(store,work,candidate); state.matched++; }
            else { state.candidates[work.id] = candidates; state.pending++; }
          }
        } catch (error: any) {
          signal.throwIfAborted();
          const message = error.message || 'Não foi possível consultar os metadados.';
          if (!state.errors.includes(message)) state.errors.push(message);
          if (work.needsIdentification) state.pending++;
          // Provider-wide errors should not cause one retry per title.
          if (/chave|Limite|conexão|indisponível/i.test(message)) { state.processed++; publish(); break; }
        }
        state.processed++; publish();
      }
      return { matched: state.matched,pending: state.pending };
    } finally {
      state.running = false; publish();
    }
  }
}
