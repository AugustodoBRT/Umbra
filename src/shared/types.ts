export type Kind = 'movie' | 'series' | 'season' | 'episode';
export interface Manifest { id: string; formatVersion: number; name: string; createdAt: string }
export interface LibraryInfo { id: string; name: string; root: string; connected: boolean; sources: string[]; size: number }
export interface MediaTrack { id: number; type: 'audio' | 'subtitle'; codec: string; language?: string; title?: string }
export interface MediaFile { id: string; path: string; size: number; duration: number; width: number; height: number; videoCodec: string; tracks: MediaTrack[]; available: boolean; position: number; completed: boolean }
export interface ExternalRating { value: number | null; votes: number | null; fetchedAt: string }
export interface Metadata { originalTitle?: string; overview?: string; genres?: string[]; cast?: string[]; director?: string; poster?: string; backdrop?: string; tmdbId?: number; imdbId?: string; tmdb?: ExternalRating; imdb?: ExternalRating; certification?: string; runtime?: number; status?: string; collection?: string; updatedAt?: string }
export interface Personal { rating: number | null; review: string; spoilers: boolean; favorite: boolean; watchlist: boolean; watched: boolean; tags: string[]; updatedAt?: string; watchedAt?: string }
export interface Work { id: string; kind: Kind; title: string; year: number | null; parentId: string | null; season: number | null; episode: number | null; addedAt: string; needsIdentification: boolean; metadata: Metadata; personal: Personal; files: MediaFile[]; progress: number; available: boolean; watched?: boolean; children?: Work[]; sessions?: PlaybackSession[] }
export interface WatchedHistory { work: Work; watchedAt: string; removedAt: string | null; watchedEpisodes: number; totalEpisodes: number }
export interface RemovalPreview { id: string; title: string; kind: 'movie'|'series'; files: { path: string; size: number }[]; size: number; keepsHistory: boolean; watchedEpisodes: number; totalEpisodes: number; completedPercent: number }
export interface RemovalResult { keptHistory: boolean; cleanupPending: boolean }
export interface PlaybackSession { id: string; fileId: string; startedAt: string; endedAt: string | null; watchedSeconds: number; endPosition: number }
export interface ScanProgress { running: boolean; phase: 'discovering' | 'inspecting' | 'done'; total: number; processed: number; added: number; updated: number; missing: number; current: string; errors: string[]; cancelled: boolean }
export interface PlayerState { active: boolean; fileId: string | null; title: string; position: number; duration: number; paused: boolean; volume: number; speed: number; tracks: MediaTrack[]; audio: number | string; subtitle: number | string; fullscreen: boolean; error?: string; source?: { token: string; mode: 'file'|'stream'; url: string; start: number; subtitleUrl?: string } }
export interface Candidate { id: number; kind: 'movie' | 'series'; title: string; originalTitle: string; year: number | null; overview: string; poster: string | null; confidence: number }
export interface CustomList { id: string; name: string; workIds: string[] }
export interface Settings { tmdbConfigured: boolean; omdbConfigured: boolean; secureStorage: boolean; credentialStorage: 'system'|'local'; completedPercent: number; hideSpoilers: boolean; autoScan: boolean; reopenLastLibrary: boolean; diagnostics: { ffprobe: boolean; ffmpeg: boolean; platform: string; electron: string } }
export interface IdentificationProgress { running: boolean; total: number; processed: number; matched: number; pending: number; errors: string[]; candidates: Record<string,Candidate[]> }
export interface Snapshot { library: LibraryInfo | null; works: Work[]; history: WatchedHistory[]; lists: CustomList[]; scan: ScanProgress; player: PlayerState; settings: Settings; identification: IdentificationProgress; error?: string }
export type Event = { type: 'changed' } | { type: 'downloads' } | { type: 'scan'; data: ScanProgress } | { type: 'player'; data: PlayerState } | { type: 'identification'; data: IdentificationProgress } | { type: 'disconnected'; message: string };
export interface API {
  addons(): Promise<import('./online').AddonSummary[]>;
  installAddon(url: string): Promise<void>;
  addon(action: 'remove'|'enable'|'disable', id: string): Promise<void>;
  configureAddon(id: string): Promise<void>;
  onlineCatalog(addonId: string, catalogId: string, type: import('./online').OnlineType, query: string, skip: number, genre: string): Promise<import('./online').OnlineItem[]>;
  onlineMeta(addonId: string, type: import('./online').OnlineType, id: string): Promise<import('./online').OnlineItem>;
  onlineSources(addonId: string, type: import('./online').OnlineType, id: string, videoId: string): Promise<import('./online').SourceResult>;
  onlinePersonal(addonId: string, type: import('./online').OnlineType, id: string, personal: Personal): Promise<void>;
  onlineSaved(): Promise<import('./online').OnlineItem[]>;
  planSeason(addonId: string, id: string, season: number, sourceId: string): Promise<import('./online').SeasonPlan>;
  downloadSource(sourceId: string): Promise<boolean>;
  downloadSeason(planId: string, selections: Record<string,string>): Promise<boolean>;
  downloads(): Promise<import('./online').DownloadsSnapshot>;
  downloadControl(action: 'pause'|'resume'|'cancel'|'reveal', id: string): Promise<void>;
  chooseDownloadFolder(): Promise<string | null>;
  snapshot(): Promise<Snapshot>;
  chooseLibrary(): Promise<Snapshot | null>;
  disconnect(): Promise<void>;
  addSource(): Promise<string | null>;
  scan(): Promise<void>;
  cancelScan(): Promise<void>;
  detail(id: string): Promise<Work>;
  removalPreview(id: string): Promise<RemovalPreview>;
  removeWork(id: string): Promise<RemovalResult>;
  personal(id: string, value: Personal): Promise<void>;
  edit(id: string, value: { title: string; year: number | null; overview: string; tags: string[] }): Promise<void>;
  play(fileId: string, restart?: boolean): Promise<void>;
  control(action: string, value?: number | string): Promise<void>;
  playbackReport(token: string,position: number,ended: boolean,error?: boolean): Promise<void>;
  reveal(fileId: string): Promise<void>;
  searchMetadata(id: string, query: string): Promise<Candidate[]>;
  associate(id: string, candidate: Candidate): Promise<void>;
  unmatch(id: string): Promise<void>;
  loadSeason(id: string): Promise<void>;
  enrich(): Promise<{ matched: number; pending: number }>;
  saveKeys(tmdb: string | null, omdb: string | null): Promise<void>;
  settings(value: { completedPercent: number; hideSpoilers: boolean; autoScan: boolean; reopenLastLibrary?: boolean }): Promise<void>;
  backup(): Promise<string>;
  exportData(): Promise<string | null>;
  list(action: 'create' | 'rename' | 'delete' | 'add' | 'remove' | 'move', nameOrId: string, value?: string): Promise<void>;
  onEvent(callback: (event: Event) => void): () => void;
}
declare global { interface Window { cine: API } }
