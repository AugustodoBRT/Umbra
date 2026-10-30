import { Addons, type BoundSource } from '../online/addons';
import { identify, normalize } from '../library/identify';
import { defaultSubtitleAppearance, subtitleAppearanceSchema } from '../shared/subtitles';
import { personalSchema, editSchema, candidateSchema, settingsSchema } from '../shared/validation';
import type { API, Snapshot, Work, Personal, Candidate, Event, LibraryInfo, WatchedHistory, PlaybackSession } from '../shared/types';
import type { OnlineItem, OnlineLocalization } from '../shared/online';
import { device, makeDeviceFetch, type Device, type DeviceFile, type DeviceJob } from './native';
import { Documents, MobileOnlineStore, personal } from './store';
import { createHash } from './crypto';

const now = () => new Date().toISOString();
const stableId = (value: string) => createHash('sha256').update(value).digest('hex');
const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'').slice(0,140) || 'Sem título';
const blankPlayer = (): Snapshot['player'] => ({ active: false,fileId: null,title: '',position: 0,duration: 0,paused: true,volume: 100,speed: 1,tracks: [],audio: 'auto',subtitle: 'no',fullscreen: false });
const blankScan = (): Snapshot['scan'] => ({ running: false,phase: 'done',total: 0,processed: 0,added: 0,updated: 0,missing: 0,current: '',errors: [],cancelled: false });
const blankIdentification = (): Snapshot['identification'] => ({ running: false,total: 0,processed: 0,matched: 0,pending: 0,errors: [],candidates: {} });
interface Catalog { library: LibraryInfo; works: Record<string,Work>; history: WatchedHistory[]; lists: Snapshot['lists']; sessions: PlaybackSession[]; files: Record<string,DeviceFile> }
export class MobileBackend {
  private documents = new Documents();
  private listeners = new Set<(event: Event) => void>();
  private catalog?: Catalog;
  private online = new MobileOnlineStore(() => { this.dirty = true; });
  private addons = new Addons(this.documents,this.online,item => this.localize(item),{ fetch: makeDeviceFetch(device),imageURL: url => url });
  private dirty = false;
  private cancelled = false;
  private scanState = blankScan();
  private identification = blankIdentification();
  private preferences = { completedPercent: 90,hideSpoilers: true,autoScan: true,reopenLastLibrary: true,subtitleAppearance: defaultSubtitleAppearance,downloadRoot: '',libraryURI: '' };
  private keys = { tmdb: '',omdb: '' };
  private playback?: { fileId: string; sessionId: string };
  private saveChain = Promise.resolve();
  private fetch: typeof fetch;
  constructor(private platform: Device = device) {
    this.fetch = makeDeviceFetch(platform); this.documents = new Documents(platform);
    this.addons = new Addons(this.documents,this.online,item => this.localize(item),{ fetch: this.fetch,imageURL: url => url });
  }
  async initialize() {
    Object.assign(this.preferences,await this.documents.loadDocument('preferences') ?? {});
    Object.assign(this.keys,await this.documents.loadDocument('providers') ?? {});
    const online = await this.documents.loadDocument('online'); if (online) { this.online.items = online.items ?? {}; this.online.translations = online.translations ?? {}; }
    if (this.preferences.libraryURI) {
      this.catalog = await this.documents.loadDocument(`library-${stableId(this.preferences.libraryURI)}`) ?? undefined;
      if (this.catalog) this.catalog.library.connected = this.preferences.reopenLastLibrary && (await this.platform.exists({ uri: this.catalog.library.root })).exists;
    }
    await this.addons.initialize();
    const playback = await this.documents.loadDocument('native-playback');
    const session = playback && this.catalog?.sessions.findLast(entry => entry.fileId === playback.fileId);
    if (session) { this.playback = { fileId: session.fileId,sessionId: session.id }; await this.deviceEvent(playback); }
    await this.platform.addListener('deviceEvent',event => { void this.deviceEvent(event).catch(error => this.emit({ type: 'disconnected',message: String(error.message) })); });
    return this.api();
  }
  private emit(event: Event) { for (const listener of this.listeners) listener(event); }
  private async deviceEvent(event: any) {
    if (event.type === 'downloads') { this.emit({ type: 'downloads' }); if (event.completed && this.catalog?.library.connected) await this.scan(); }
    if (event.type === 'playback' && this.catalog && this.playback && this.playback.fileId === event.fileId) {
      const { fileId,sessionId } = this.playback; const file = this.findFile(fileId);
      if (file && Number.isFinite(event.position)) {
        file.position = Math.max(0,event.position); file.duration = event.duration || file.duration;
        file.completed ||= file.duration > 0 && file.position/file.duration >= this.preferences.completedPercent/100;
        const session = this.catalog.sessions.find(entry => entry.id === sessionId);
        if (session) { session.endPosition = file.position; session.watchedSeconds = Math.max(session.watchedSeconds,event.watchedSeconds ?? 0); if (event.ended) session.endedAt = now(); }
        this.updateHistory(); await this.persist(); this.emit({ type: 'changed' });
      }
      if (event.ended) this.playback = undefined;
    }
  }
  private persist() {
    const catalog = this.catalog ? structuredClone(this.catalog) : undefined;
    const preferences = structuredClone(this.preferences),online = this.dirty ? structuredClone({ items: this.online.items,translations: this.online.translations }) : undefined;
    this.dirty = false;
    const task = this.saveChain.then(async () => {
      await this.documents.saveDocument('preferences',preferences);
      if (catalog) await this.documents.saveDocument(`library-${stableId(catalog.library.root)}`,catalog);
      if (online) await this.documents.saveDocument('online',online);
    }); this.saveChain = task.catch(() => {}); return task;
  }
  private requireLibrary() { if (!this.catalog?.library.connected) throw new Error('Selecione uma pasta da biblioteca no celular ou armazenamento conectado.'); return this.catalog; }
  private getWork(id: string) { const work = this.catalog?.works[id]; if (!work) throw new Error('Título não encontrado.'); return work; }
  private children(id: string) { return Object.values(this.catalog?.works ?? {}).filter(work => work.parentId === id).sort((a,b) => (a.season ?? 0)-(b.season ?? 0) || (a.episode ?? 0)-(b.episode ?? 0)); }
  private detail(id: string): Work {
    const work = this.getWork(id),children = this.children(id).map(child => this.detail(child.id));
    const files = children.length ? children.flatMap(child => child.files) : work.files;
    return { ...work,children,files,available: files.some(file => file.available),progress: files.length ? files.reduce((sum,file) => sum+(file.duration ? file.position/file.duration : 0),0)/files.length : 0,watched: work.personal.watched || (files.length > 0 && files.every(file => file.completed)),sessions: this.catalog!.sessions.filter(session => files.some(file => file.id === session.fileId)) };
  }
  private findFile(id: string) { return Object.values(this.catalog?.works ?? {}).flatMap(work => work.files).find(file => file.id === id); }
  private updateHistory() {
    if (!this.catalog) return;
    for (const work of Object.values(this.catalog.works).filter(w => !w.parentId)) {
      const detail = this.detail(work.id),episodes = (detail.children ?? []).flatMap(season => season.children ?? []),watchedEpisodes = episodes.filter(e => e.watched).length;
      const seen = detail.kind === 'series' ? detail.personal.watched || watchedEpisodes > 0 : detail.watched;
      const previous = this.catalog.history.find(entry => entry.work.id === work.id && !entry.removedAt);
      if (seen) {
        const entry = { work: structuredClone(detail),watchedAt: previous?.watchedAt ?? now(),removedAt: null,watchedEpisodes,totalEpisodes: episodes.length };
        if (previous) Object.assign(previous,entry); else this.catalog.history.push(entry);
      } else this.catalog.history = this.catalog.history.filter(entry => entry.work.id !== work.id || entry.removedAt);
    }
  }
  private snapshot(): Snapshot {
    return { library: this.catalog?.library ?? null,works: Object.values(this.catalog?.works ?? {}).filter(work => !work.parentId).map(work => this.detail(work.id)),history: this.catalog?.history ?? [],lists: this.catalog?.lists ?? [],scan: this.scanState,player: blankPlayer(),identification: this.identification,settings: { ...this.preferences,tmdbConfigured: !!this.keys.tmdb,omdbConfigured: !!this.keys.omdb,secureStorage: true,credentialStorage: 'system',diagnostics: { mpv: true,ffmpeg: false,ffprobe: false,platform: 'Android',electron: 'Player nativo Android' } } };
  }
  private async chooseLibrary() {
    const folder = await this.platform.chooseFolder(); if (folder.cancelled) return null;
    this.catalog = await this.documents.loadDocument(`library-${stableId(folder.uri)}`) ?? { library: { id: crypto.randomUUID(),name: folder.name,root: folder.uri,connected: true,sources: [folder.uri],size: 0 },works: {},history: [],lists: [],sessions: [],files: {} };
    this.catalog!.library.connected = true; this.preferences.libraryURI = folder.uri;
    await this.persist(); if (this.preferences.autoScan) await this.scan(); return this.snapshot();
  }
  private async scan() {
    const catalog = this.requireLibrary(); if (this.scanState.running) return;
    this.cancelled = false; this.scanState = { ...blankScan(),running: true,phase: 'discovering' }; this.emit({ type: 'scan',data: this.scanState });
    try {
      const found: DeviceFile[] = []; const errors: string[] = [];
      for (const uri of catalog.library.sources) { const result = await this.platform.scan({ uri }); found.push(...result.files); errors.push(...result.errors); if (this.cancelled) break; }
      this.scanState = { ...this.scanState,phase: 'inspecting',total: found.length,errors };
      const seen = new Set<string>();
      for (const file of found) {
        if (this.cancelled) break;
        const id = stableId(file.id); if (seen.has(id)) continue; seen.add(id); catalog.files[id] = file;
        const identity = identify(file.path); const parent = identity.kind === 'episode' ? `series:${normalize(identity.title)}:${identity.year ?? ''}` : null;
        let workId = `movie:${normalize(identity.title)}:${identity.year ?? ''}`;
        if (parent) {
          const series = this.ensureWork(parent,'series',identity.title,identity.year);
          const season = this.ensureWork(`${parent}:s${identity.season}`,'season',`Temporada ${identity.season}`,identity.year,series.id,identity.season);
          workId = `${season.id}:e${identity.episodes[0]}`; this.ensureWork(workId,'episode',`Episódio ${identity.episodes[0]}`,identity.year,season.id,identity.season,identity.episodes[0]);
        } else this.ensureWork(workId,'movie',identity.title,identity.year);
        const work = catalog.works[workId]; const old = work.files.find(f => f.id === id);
        if (old) { Object.assign(old,{ size: file.size,duration: file.duration || old.duration,width: file.width,height: file.height,available: true }); this.scanState.updated++; }
        else { work.files.push({ id,path: file.path,size: file.size,duration: file.duration,width: file.width,height: file.height,videoCodec: '',tracks: [],available: true,position: 0,completed: false }); this.scanState.added++; }
        this.scanState = { ...this.scanState,processed: this.scanState.processed+1,current: file.path }; this.emit({ type: 'scan',data: this.scanState });
      }
      if (!this.cancelled && !errors.length) for (const work of Object.values(catalog.works)) for (const file of work.files) if (!seen.has(file.id) && file.available) { file.available = false; this.scanState.missing++; }
      catalog.library.size = Object.values(catalog.works).flatMap(w => w.files).filter(f => f.available).reduce((sum,file) => sum+file.size,0);
      await this.persist(); this.emit({ type: 'changed' });
    } finally { this.scanState = { ...this.scanState,running: false,phase: 'done',cancelled: this.cancelled }; this.emit({ type: 'scan',data: this.scanState }); }
  }
  private ensureWork(id: string,kind: Work['kind'],title: string,year: number|null,parentId: string|null = null,season: number|null = null,episode: number|null = null) {
    return this.catalog!.works[id] ??= { id,kind,title,year,parentId,season,episode,addedAt: now(),needsIdentification: ['movie','series'].includes(kind),metadata: {},personal: personal(),files: [],progress: 0,available: false };
  }
  private async tmdb(endpoint: string,parameters: Record<string,string> = {}) {
    if (!this.keys.tmdb) throw new Error('Configure o TMDB nas configurações.');
    const query = new URLSearchParams({ language: 'pt-BR',...parameters }); const key = /^[a-f\d]{32}$/i.test(this.keys.tmdb);
    if (key) query.set('api_key',this.keys.tmdb);
    const response = await this.fetch(`https://api.themoviedb.org/3/${endpoint}?${query}`,{ headers: key ? {} : { Authorization: `Bearer ${this.keys.tmdb}` } });
    if (!response.ok) throw new Error('Não foi possível consultar o TMDB. Confira a chave e a conexão.'); return response.json();
  }
  private async localize(item: OnlineItem): Promise<OnlineLocalization|null> {
    if (!this.keys.tmdb || !['movie','series'].includes(item.type) || !/^tt\d+$/.test(item.id)) return null;
    const match = await this.tmdb(`find/${item.id}`,{ external_source: 'imdb_id' }); const results = item.type === 'movie' ? match.movie_results : match.tv_results;
    if (results?.length !== 1) return null; const details = await this.tmdb(`${item.type === 'movie' ? 'movie' : 'tv'}/${results[0].id}`);
    return { description: details.overview,genres: details.genres?.map((g: any) => g.name),updatedAt: now() };
  }
  private async searchMetadata(id: string,query: string): Promise<Candidate[]> {
    const work = this.getWork(id),type = work.kind === 'movie' ? 'movie' : 'tv'; const number = query.match(/^(?:tmdb:)?(\d+)$/)?.[1];
    const result = number ? { results: [await this.tmdb(`${type}/${number}`)] } : await this.tmdb(`search/${type}`,{ query });
    return result.results.slice(0,12).map((item: any) => {
      const title = item.title ?? item.name,originalTitle = item.original_title ?? item.original_name,year = Number((item.release_date ?? item.first_air_date ?? '').slice(0,4)) || null;
      return { id: item.id,kind: work.kind === 'movie' ? 'movie' : 'series',title,originalTitle,year,overview: item.overview ?? '',poster: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : null,confidence: [title,originalTitle].some(value => normalize(value) === normalize(work.title)) && work.year === year && year !== null ? 1 : .3 };
    });
  }
  private async associate(id: string,value: Candidate) {
    const candidate = candidateSchema.parse(value),work = this.getWork(id),type = work.kind === 'movie' ? 'movie' : 'tv';
    const data = await this.tmdb(`${type}/${candidate.id}`,{ append_to_response: 'credits,external_ids' });
    work.metadata = { ...work.metadata,tmdbId: data.id,imdbId: data.imdb_id ?? data.external_ids?.imdb_id,originalTitle: data.original_title ?? data.original_name,overview: work.metadata.overview || data.overview,genres: data.genres?.map((g: any) => g.name),cast: data.credits?.cast?.slice(0,15).map((c: any) => c.name),director: data.credits?.crew?.find((c: any) => c.job === 'Director')?.name,poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : undefined,tmdb: { value: data.vote_count ? data.vote_average : null,votes: data.vote_count,fetchedAt: now() },updatedAt: now() };
    work.needsIdentification = false;
    if (this.keys.omdb && work.metadata.imdbId) {
      try { const response = await this.fetch(`https://www.omdbapi.com/?${new URLSearchParams({ apikey: this.keys.omdb,i: work.metadata.imdbId })}`); const rating = await response.json(); const score = Number(rating.imdbRating); work.metadata.imdb = { value: Number.isFinite(score) ? score : null,votes: Number(rating.imdbVotes?.replace(/,/g,'')) || null,fetchedAt: now() }; } catch { /* Metadata remains available. */ }
    }
    if (work.kind === 'series') for (const season of data.seasons ?? []) this.ensureWork(`${work.id}:s${season.season_number}`,'season',season.name,work.year,work.id,season.season_number);
  }
  private async enqueue(sources: BoundSource[]) {
    const jobs: DeviceJob[] = sources.map(source => {
      const { item,video,raw,summary } = source; if (summary.external) throw new Error('Abra este acesso no navegador da fonte.');
      const year = item.year.match(/^\d{4}/)?.[0],name = safe(`${item.name}${year ? ` (${year})` : ''}`),part = summary.part ? ` - Parte ${String(summary.part).padStart(3,'0')}` : '';
      const parent = item.type === 'movie' ? 'Filmes' : item.type === 'series' ? 'Series' : item.type === 'book' ? 'Livros' : 'Audiobooks';
      const episode = video ? ` - S${String(video.season).padStart(2,'0')}E${String(video.episode).padStart(2,'0')}` : '';
      return { id: crypto.randomUUID(),title: `${item.name}${episode}${part}`,itemName: item.name,sourceName: `${summary.addonName} · ${summary.name}`,type: item.type,folder: `${parent}/${name}${video ? `/Temporada ${String(video.season).padStart(2,'0')}` : ''}`,prefix: safe(`${name}${episode}${part}`),...raw,filename: raw.behaviorHints?.filename,headers: raw.behaviorHints?.proxyHeaders?.request,season: video?.season,episode: video?.episode };
    });
    const root = (await this.platform.downloads()).root;
    if (!this.catalog?.library.connected) {
      this.catalog = await this.documents.loadDocument(`library-${stableId(root)}`) ?? { library: { id: crypto.randomUUID(),name: 'Downloads do Umbra',root,connected: true,sources: [root],size: 0 },works: {},history: [],lists: [],sessions: [],files: {} };
      this.catalog!.library.connected = true; this.preferences.libraryURI = root;
    } else if (!this.catalog.library.sources.includes(root)) this.catalog.library.sources.push(root);
    await this.persist();
    await this.platform.enqueue({ jobs });
    return true;
  }
  private async play(id: string,restart = false) {
    this.requireLibrary(); const file = this.findFile(id),deviceFile = this.catalog!.files[id]; if (!file || !deviceFile) throw new Error('Arquivo indisponível. Importe a pasta novamente.');
    const session: PlaybackSession = { id: crypto.randomUUID(),fileId: id,startedAt: now(),endedAt: null,watchedSeconds: 0,endPosition: restart ? 0 : file.position };
    this.catalog!.sessions.push(session); this.playback = { fileId: id,sessionId: session.id }; await this.persist();
    await this.platform.play({ url: deviceFile.id,type: 'movie',title: deviceFile.name,fileId: id,start: restart ? 0 : file.position,appearance: this.preferences.subtitleAppearance });
  }
  private async removeWork(id: string) {
    const catalog = this.requireLibrary(),work = this.detail(id); const preview = await this.removalPreview(id);
    const jobs = (await this.platform.downloads()).jobs; if (jobs.some(job => job.itemName === work.title && !['completed','cancelled'].includes(job.state))) throw new Error('Cancele os downloads pendentes antes de excluir.');
    // Save watched history before deleting; only authorized media URIs are sent to Android.
    this.updateHistory(); const history = catalog.history.find(entry => entry.work.id === id && !entry.removedAt);
    if (history) { history.removedAt = now(); history.work = structuredClone(work); }
    try { await this.platform.deleteFiles({ uris: preview.files.map(file => catalog.files[file.path]?.id).filter((uri): uri is string => !!uri) }); } catch (error) { if (history) history.removedAt = null; await this.scan(); throw error; }
    const remove = (target: string) => { for (const child of this.children(target)) remove(child.id); delete catalog.works[target]; };
    remove(id); for (const list of catalog.lists) list.workIds = list.workIds.filter(workId => workId !== id); await this.persist();
    return { keptHistory: !!history,cleanupPending: false };
  }
  private async removalPreview(id: string): Promise<import('../shared/types').RemovalPreview> {
    const work = this.detail(id); if (!['movie','series'].includes(work.kind)) throw new Error('Escolha um filme ou série.');
    const episodes = (work.children ?? []).flatMap(season => season.children ?? []);
    return { id,title: work.title,kind: work.kind as 'movie'|'series',files: work.files.filter(file => file.available).map(file => ({ path: file.id,size: file.size })),size: work.files.filter(file => file.available).reduce((sum,file) => sum+file.size,0),keepsHistory: !!work.watched || episodes.some(e => e.watched),watchedEpisodes: episodes.filter(e => e.watched).length,totalEpisodes: episodes.length,completedPercent: this.preferences.completedPercent };
  }
  private api(): API {
    const backend: API = {
      addons: async () => this.addons.list(),debrid: async () => this.addons.debrid(),saveDebrid: token => this.addons.saveDebrid(token),installAddon: url => this.addons.install(url),addon: (action,id) => this.addons.change(action,id),configureAddon: async id => { await this.platform.open({ url: id === 'torrentio' ? 'https://torrentio.strem.fun/configure' : this.addons.configurationURL(id) }); },
      onlineCatalog: (...args) => this.addons.catalog(...args),onlineSearch: (...args) => this.addons.search(...args),onlineMeta: (...args) => this.addons.meta(...args),onlineSources: (...args) => this.addons.sources(...args),onlinePersonal: async (_addon,type,id,value) => this.online.personal(type,id,personalSchema.parse(value)),onlineSaved: async () => this.addons.saved(),
      openBookSource: async id => { const source = this.addons.source(id); if (!source.summary.external || !source.raw.url) throw new Error('Link indisponível.'); await this.platform.open({ url: source.raw.url }); },planSeason: (...args) => this.addons.plan(...args),downloadSource: id => this.enqueue([this.addons.source(id)]),downloadSeason: (id,selections) => this.enqueue(this.addons.planSources(id,selections)),downloads: () => this.platform.downloads(),downloadControl: (action,id) => this.platform.downloadControl({ action,id }),chooseDownloadFolder: async () => { const folder = await this.platform.chooseFolder(); if (folder.cancelled) return null; await this.platform.setDownloadFolder({ uri: folder.uri }); return folder.uri; },
      snapshot: async () => this.snapshot(),chooseLibrary: () => this.chooseLibrary(),disconnect: async () => { if (this.catalog) this.catalog.library.connected = false; },addSource: async () => { const folder = await this.platform.chooseFolder(); if (folder.cancelled) return null; const catalog = this.requireLibrary(); if (!catalog.library.sources.includes(folder.uri)) catalog.library.sources.push(folder.uri); return folder.uri; },scan: () => this.scan(),cancelScan: async () => { this.cancelled = true; },detail: async id => this.detail(id),
      personal: async (id,value) => { const work = this.getWork(id); work.personal = { ...personalSchema.parse(value),updatedAt: now(),watchedAt: value.watched ? work.personal.watchedAt ?? now() : undefined }; this.updateHistory(); },edit: async (id,value) => { const input = editSchema.parse(value),work = this.getWork(id); work.title = input.title; work.year = input.year; work.metadata.overview = input.overview; work.personal.tags = input.tags; },
      play: (id,restart) => this.play(id,restart),playOnlineSource: async (id,title) => { const bound = this.addons.source(id); if (bound.item.type === 'book' || bound.summary.external) throw new Error('Abra este acesso na fonte.'); await this.platform.play({ ...bound.raw,type: bound.item.type,title: title || bound.item.name,headers: bound.raw.behaviorHints?.proxyHeaders?.request,appearance: this.preferences.subtitleAppearance }); },control: (action,value) => this.platform.control({ action,value }),playerBounds: async () => {},playbackReport: async () => {},reveal: async id => { const file = this.catalog?.files[id]; if (file) await this.platform.open({ url: file.id }); },
      removalPreview: id => this.removalPreview(id),removeWork: id => this.removeWork(id),searchMetadata: (id,query) => this.searchMetadata(id,query),associate: (id,value) => this.associate(id,value),unmatch: async id => { const work = this.getWork(id); work.metadata = {}; work.needsIdentification = true; },
      loadSeason: async id => { const season = this.getWork(id),series = this.getWork(season.parentId!); const data = await this.tmdb(`tv/${series.metadata.tmdbId}/season/${season.season}`); for (const entry of data.episodes ?? []) { const episode = this.ensureWork(`${id}:e${entry.episode_number}`,'episode',entry.name,series.year,id,season.season,entry.episode_number); episode.metadata.overview = entry.overview; } },
      enrich: async () => { const pending = Object.values(this.requireLibrary().works).filter(work => work.needsIdentification); let matched = 0; this.identification = { ...blankIdentification(),running: true,total: pending.length }; try { for (const work of pending) { try { const candidates = await this.searchMetadata(work.id,work.title); const strong = candidates.filter(c => c.confidence === 1); if (strong.length === 1) { await this.associate(work.id,strong[0]); matched++; } else this.identification.candidates[work.id] = candidates; } catch (error: any) { this.identification.errors.push(error.message); } this.identification.processed++; this.identification.matched = matched; this.emit({ type: 'identification',data: { ...this.identification } }); } } finally { this.identification.running = false; this.identification.pending = pending.length-matched; this.emit({ type: 'identification',data: this.identification }); } return { matched,pending: pending.length-matched }; },
      saveKeys: async (tmdb,omdb) => { if (tmdb !== null) this.keys.tmdb = tmdb; if (omdb !== null) this.keys.omdb = omdb; await this.documents.saveDocument('providers',this.keys); },settings: async value => { Object.assign(this.preferences,settingsSchema.parse(value)); },subtitleAppearance: async value => { this.preferences.subtitleAppearance = subtitleAppearanceSchema.parse(value); },
      backup: async () => { const catalog = this.requireLibrary(); return (await this.platform.exportFile({ name: `umbra-backup-${Date.now()}.json`,value: JSON.stringify(catalog),uri: catalog.library.root })).path; },exportData: async () => (await this.platform.exportFile({ name: `umbra-avaliacoes-${Date.now()}.json`,value: JSON.stringify({ library: this.catalog,online: this.online.saved() }) })).path,
      list: async (action,nameOrId,value) => { const catalog = this.requireLibrary(); if (action === 'create') { catalog.lists.push({ id: crypto.randomUUID(),name: nameOrId,workIds: [] }); return; } const list = catalog.lists.find(entry => entry.id === nameOrId); if (!list) throw new Error('Coleção não encontrada.'); if (action === 'delete') catalog.lists = catalog.lists.filter(entry => entry !== list); if (action === 'rename' && value) list.name = value; if (action === 'add' && value && !list.workIds.includes(value)) list.workIds.push(value); if (action === 'remove') list.workIds = list.workIds.filter(id => id !== value); if (action === 'move' && value) { list.workIds = [value,...list.workIds.filter(id => id !== value)]; } },
      onEvent: callback => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
    };
    // Every mutation resolves only after private state is durably written on Android.
    for (const key of Object.keys(backend) as (keyof API)[]) {
      if (key === 'onEvent' || key === 'snapshot' || key === 'playerBounds') continue;
      const action = backend[key] as (...args: any[]) => Promise<unknown>;
      (backend as any)[key] = async (...args: any[]) => { const value = await action(...args); await this.persist(); return value; };
    }
    return backend;
  }
}
