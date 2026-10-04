import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, rm, access, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Manifest, Work, Personal, Metadata, MediaFile, CustomList, PlaybackSession, WatchedHistory, RemovalPreview } from '../shared/types';
import type { Identity } from '../library/identify';
import { normalize } from '../library/identify';
import { relativePath, resolvePath } from '../library/paths';
import { LibraryLock } from './libraryLock';
import { recoverRemovals } from '../library/removal';

export const emptyPersonal = (): Personal => ({ rating: null, review: '', spoilers: false, favorite: false, watchlist: false, watched: false, tags: [] });
type Row = Record<string, any>;
export const migrations = [
  `CREATE TABLE works(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('movie','series','season','episode')), title TEXT NOT NULL, year INTEGER, parent_id TEXT REFERENCES works(id), season INTEGER, episode INTEGER, inferred_key TEXT UNIQUE, added_at TEXT NOT NULL, needs_identification INTEGER NOT NULL DEFAULT 1, metadata TEXT NOT NULL DEFAULT '{}', overrides TEXT NOT NULL DEFAULT '{}');
   CREATE TABLE personal(work_id TEXT PRIMARY KEY REFERENCES works(id), data TEXT NOT NULL);
   CREATE TABLE files(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, fingerprint TEXT NOT NULL, duration REAL NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, video_codec TEXT NOT NULL, tracks TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX files_fingerprint ON files(fingerprint);
   CREATE TABLE file_works(file_id TEXT REFERENCES files(id), work_id TEXT REFERENCES works(id), PRIMARY KEY(file_id,work_id));
   CREATE TABLE progress(file_id TEXT PRIMARY KEY REFERENCES files(id), position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, audio TEXT, subtitle TEXT, updated_at TEXT NOT NULL);
   CREATE TABLE sessions(id TEXT PRIMARY KEY, file_id TEXT REFERENCES files(id), started_at TEXT NOT NULL, ended_at TEXT, watched_seconds REAL NOT NULL DEFAULT 0, end_position REAL NOT NULL DEFAULT 0);
   CREATE TABLE sources(path TEXT PRIMARY KEY);
   CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE lists(id TEXT PRIMARY KEY, name TEXT NOT NULL);
   CREATE TABLE list_items(list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, work_id TEXT REFERENCES works(id), position INTEGER NOT NULL, PRIMARY KEY(list_id,work_id));
   CREATE INDEX works_parent ON works(parent_id);
   CREATE INDEX file_works_work ON file_works(work_id);`,
  `CREATE TABLE metadata_sources(work_id TEXT REFERENCES works(id), provider TEXT NOT NULL, provider_id TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY(work_id,provider));
   CREATE INDEX sessions_file ON sessions(file_id);`,
  `CREATE TABLE files_v3(id TEXT PRIMARY KEY, path TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, fingerprint TEXT NOT NULL, duration REAL NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, video_codec TEXT NOT NULL, tracks TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1);
   INSERT INTO files_v3 SELECT * FROM files;
   DROP TABLE files;
   ALTER TABLE files_v3 RENAME TO files;
   CREATE INDEX files_fingerprint ON files(fingerprint);
   CREATE UNIQUE INDEX files_present_path ON files(path) WHERE available=1;`,
  `CREATE TABLE watched_history(root_id TEXT PRIMARY KEY,watched_at TEXT NOT NULL,removed_at TEXT,data TEXT NOT NULL);
   CREATE TABLE file_removals(id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('preparing','committed')),data TEXT NOT NULL);`
];
export function migrate(db: DatabaseSync) {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  if (version > migrations.length) throw new Error('Este catálogo exige uma versão mais recente do Umbra.');
  for (let i = version; i < migrations.length; i++) {
    if (i === 2) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(migrations[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { if (i === 2) db.exec('PRAGMA foreign_keys = ON'); }
  }
}
export class Store {
  db!: DatabaseSync;
  root: string;
  directory: string;
  manifest!: Manifest;
  closed = false;
  removalCleanupPending = false;
  private lock: LibraryLock;
  private lockPath: string;
  private backupInFlight = false;
  constructor(root: string) { this.root = root; this.directory = path.join(root, 'Biblioteca'); this.lockPath = path.join(this.directory, '.catalogo.lock'); this.lock = new LibraryLock(this.lockPath); }
  static async resolveRoot(selected: string) {
    let root = await realpath(selected);
    if (path.basename(root) === 'Biblioteca') root = path.dirname(root);
    return root;
  }
  static async open(selected: string) {
    const root = await Store.resolveRoot(selected);
    const store = new Store(root);
    try { await store.initialize(); return store; } catch (error) { await store.close(); throw error; }
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true });
    await this.lock.acquire();
    const file = path.join(this.directory, 'biblioteca.json');
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value.formatVersion !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string') throw new Error('Manifesto inválido ou versão não suportada.');
      this.manifest = value;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      this.manifest = { id: randomUUID(), formatVersion: 1, name: path.basename(this.root), createdAt: new Date().toISOString() };
      await writeFile(file, JSON.stringify(this.manifest, null, 2), { flag: 'wx' });
    }
    for (const name of ['capas','miniaturas','backups']) await mkdir(path.join(this.directory, name), { recursive: true });
    this.db = new DatabaseSync(path.join(this.directory, 'catalogo.sqlite'), { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    migrate(this.db);
    this.removalCleanupPending = await recoverRemovals(this);
    // Backfill older libraries using their stored completion flags/manual marks.
    for (const work of this.works()) this.syncHistory(work.id);
  }
  assertOpen() { if (this.closed || !this.db) throw new Error('A biblioteca está desconectada. Conecte o SSD novamente.'); }
  async assertDisk() {
    this.assertOpen();
    const manifest: Manifest = JSON.parse(await readFile(path.join(this.directory, 'biblioteca.json'), 'utf8'));
    const owner = JSON.parse(await readFile(path.join(this.lockPath, 'owner.json'), 'utf8'));
    if (manifest.id !== this.manifest.id || owner.token !== this.lock.token) throw new Error('A biblioteca ou o bloqueio mudou. Reconecte o SSD.');
  }
  transaction<T>(fn: () => T): T {
    this.assertOpen(); this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  sources(): string[] { this.assertOpen(); return (this.db.prepare('SELECT path FROM sources ORDER BY path').all() as Row[]).map(x => x.path); }
  addSource(absolute: string) {
    const relative = relativePath(this.root, absolute);
    if (relative === 'Biblioteca' || relative.startsWith('Biblioteca/')) throw new Error('Escolha a pasta de vídeos, fora do catálogo.');
    const sources = this.sources();
    if (sources.some(x => x === '.' || x === relative || relative.startsWith(`${x}/`))) return;
    this.transaction(() => {
      for (const source of sources) if (relative === '.' || source.startsWith(`${relative}/`)) this.db.prepare('DELETE FROM sources WHERE path = ?').run(source);
      this.db.prepare('INSERT OR IGNORE INTO sources(path) VALUES (?)').run(relative);
    });
  }
  setting<T>(key: string, fallback: T): T { this.assertOpen(); const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined; return row ? JSON.parse(row.value) : fallback; }
  setSetting(key: string, value: unknown) { this.assertOpen(); this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  rows() { this.assertOpen(); return this.db.prepare('SELECT * FROM files').all() as Row[]; }
  file(id: string): MediaFile {
    this.assertOpen(); const row = this.db.prepare('SELECT f.*,p.position,p.completed FROM files f LEFT JOIN progress p ON f.id=p.file_id WHERE f.id=?').get(id) as Row;
    if (!row) throw new Error('Arquivo não encontrado.');
    return this.toFile(row);
  }
  private toFile(row: Row): MediaFile { return { id: row.id, path: row.path, size: row.size, duration: row.duration, width: row.width, height: row.height, videoCodec: row.video_codec, tracks: JSON.parse(row.tracks), available: !!row.available, position: row.position ?? 0, completed: !!row.completed }; }
  private toWork(row: Row): Work {
    const personal = this.db.prepare('SELECT data FROM personal WHERE work_id=?').get(row.id) as Row | undefined;
    const files = (this.db.prepare(`SELECT DISTINCT f.*,p.position,p.completed FROM files f JOIN file_works fw ON fw.file_id=f.id LEFT JOIN progress p ON p.file_id=f.id WHERE fw.work_id=? OR fw.work_id IN (SELECT id FROM works WHERE parent_id=? OR parent_id IN (SELECT id FROM works WHERE parent_id=?)) ORDER BY f.path`).all(row.id,row.id,row.id) as Row[]).map(x => this.toFile(x));
    const unfinished = files.filter(x => !x.completed && x.position > 0).sort((a,b) => b.position - a.position);
    const value = { id: row.id, kind: row.kind, title: row.title, year: row.year, parentId: row.parent_id, season: row.season, episode: row.episode, addedAt: row.added_at, needsIdentification: !!row.needs_identification, metadata: { ...JSON.parse(row.metadata), ...JSON.parse(row.overrides) }, personal: personal ? { ...emptyPersonal(), ...JSON.parse(personal.data) } : emptyPersonal(), files, progress: unfinished[0]?.duration ? unfinished[0].position / unfinished[0].duration : 0, available: files.some(x => x.available) };
    return { ...value,watched: this.isWatched(row,value.personal,files) };
  }
  private isWatched(row: Row,personal: Personal,files: MediaFile[]) {
    if (personal.watched) return true;
    if (row.kind === 'episode' && files.length) {
      const parents = this.db.prepare('SELECT p.data FROM personal p WHERE p.work_id=? OR p.work_id=(SELECT parent_id FROM works WHERE id=?)').all(row.parent_id,row.parent_id) as Row[];
      if (parents.some(parent => JSON.parse(parent.data).watched)) return true;
    }
    if (row.kind === 'movie' || row.kind === 'episode') return files.some(file => file.completed);
    const episodes = this.db.prepare(`SELECT w.id,p.data,sp.data AS season_data,
      EXISTS(SELECT 1 FROM file_works fw WHERE fw.work_id=w.id) AS local,
      EXISTS(SELECT 1 FROM file_works fw JOIN progress pr ON pr.file_id=fw.file_id WHERE fw.work_id=w.id AND pr.completed=1) AS completed
      FROM works w LEFT JOIN personal p ON p.work_id=w.id LEFT JOIN personal sp ON sp.work_id=w.parent_id WHERE w.kind='episode' AND (w.parent_id=? OR w.parent_id IN (SELECT id FROM works WHERE parent_id=?))`).all(row.id,row.id) as Row[];
    const local = episodes.filter(episode => episode.local || (episode.data && JSON.parse(episode.data).watched));
    return local.length > 0 && local.every(episode => episode.completed || (episode.data && JSON.parse(episode.data).watched) || (episode.season_data && JSON.parse(episode.season_data).watched));
  }
  works(): Work[] { this.assertOpen(); return (this.db.prepare("SELECT * FROM works WHERE kind IN ('movie','series') ORDER BY added_at DESC").all() as Row[]).map(x => this.toWork(x)); }
  detail(id: string): Work {
    this.assertOpen(); const row = this.db.prepare('SELECT * FROM works WHERE id=?').get(id) as Row;
    if (!row) throw new Error('Título não encontrado.');
    const work = this.toWork(row);
    work.children = (this.db.prepare('SELECT * FROM works WHERE parent_id=? ORDER BY season,episode,title').all(id) as Row[]).map(x => this.toWork(x));
    for (const child of work.children) if (child.kind === 'season') child.children = (this.db.prepare('SELECT * FROM works WHERE parent_id=? ORDER BY episode').all(child.id) as Row[]).map(x => this.toWork(x));
    work.sessions = (this.db.prepare(`SELECT DISTINCT s.* FROM sessions s JOIN file_works f ON f.file_id=s.file_id WHERE f.work_id=? OR f.work_id IN (SELECT id FROM works WHERE parent_id=? OR parent_id IN (SELECT id FROM works WHERE parent_id=?)) ORDER BY started_at DESC LIMIT 30`).all(id,id,id) as Row[]).map(x => ({ id: x.id, fileId: x.file_id, startedAt: x.started_at, endedAt: x.ended_at, watchedSeconds: x.watched_seconds, endPosition: x.end_position }));
    return work;
  }
  savePersonal(id: string, personal: Personal) {
    const previous = this.detail(id).personal; const now = new Date().toISOString();
    const watchedAt = personal.watched ? previous.watched ? previous.watchedAt ?? previous.updatedAt ?? now : now : undefined;
    this.db.prepare('INSERT INTO personal VALUES (?,?) ON CONFLICT(work_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify({ ...personal,updatedAt: now,watchedAt }));
    this.syncHistory(this.rootWorkId(id));
  }
  private rootWorkId(id: string): string {
    const row = this.db.prepare('SELECT id,parent_id FROM works WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error('Título não encontrado.');
    return row.parent_id ? this.rootWorkId(row.parent_id) : row.id;
  }
  private historyEntry(id: string): WatchedHistory | null {
    const work = this.detail(id);
    for (const season of work.children ?? []) for (const episode of season.children ?? []) {
      if ((work.personal.watched || season.personal.watched) && episode.files.length) episode.watched = true;
    }
    const episodes = (work.children ?? []).flatMap(season => season.children ?? []);
    const watchedEpisodes = episodes.filter(episode => episode.watched);
    if (work.kind === 'movie' ? !work.watched : !work.personal.watched && !watchedEpisodes.length) return null;
    const row = this.db.prepare(`SELECT MAX(p.updated_at) AS date FROM progress p JOIN file_works fw ON fw.file_id=p.file_id
      WHERE p.completed=1 AND (fw.work_id=? OR fw.work_id IN (SELECT id FROM works WHERE parent_id=? OR parent_id IN (SELECT id FROM works WHERE parent_id=?)))`).get(id,id,id) as Row;
    const manualDates = [work,...(work.children ?? []),...episodes].filter(item => item.personal.watched).map(item => item.personal.watchedAt ?? item.personal.updatedAt).filter((date): date is string => !!date);
    const watchedAt = [row.date,...manualDates].filter(Boolean).sort().at(-1) ?? work.addedAt;
    return { work,watchedAt,removedAt: null,watchedEpisodes: watchedEpisodes.length,totalEpisodes: episodes.filter(episode => episode.files.length || episode.personal.watched).length };
  }
  private syncHistory(id: string) {
    const entry = this.historyEntry(id);
    if (!entry) { this.db.prepare('DELETE FROM watched_history WHERE root_id=? AND removed_at IS NULL').run(id); return; }
    this.db.prepare(`INSERT INTO watched_history VALUES (?,?,NULL,?) ON CONFLICT(root_id) DO UPDATE SET watched_at=excluded.watched_at,removed_at=NULL,data=excluded.data`).run(id,entry.watchedAt,JSON.stringify(entry));
  }
  history(): WatchedHistory[] {
    this.assertOpen();
    return (this.db.prepare('SELECT root_id,data,removed_at FROM watched_history ORDER BY watched_at DESC').all() as Row[]).map(row => row.removed_at ? JSON.parse(row.data) : this.historyEntry(row.root_id)).filter((entry): entry is WatchedHistory => !!entry);
  }
  removalPreview(id: string): RemovalPreview {
    const work = this.detail(id);
    if (work.kind !== 'movie' && work.kind !== 'series') throw new Error('Exclua o filme ou a série pelos detalhes do título.');
    const history = this.historyEntry(id);
    const files = work.files.filter(file => file.available).map(({ path,size }) => ({ path,size }));
    return { id,title: work.title,kind: work.kind,files,size: files.reduce((sum,file) => sum+file.size,0),keepsHistory: !!history,watchedEpisodes: history?.watchedEpisodes ?? 0,totalEpisodes: history?.totalEpisodes ?? (work.children ?? []).flatMap(season => season.children ?? []).filter(episode => episode.files.length).length,completedPercent: this.setting('completedPercent',90) };
  }
  removeCatalogWork(id: string,operationId: string): boolean {
    this.removalPreview(id);
    return this.transaction(() => {
      const operation = this.db.prepare('SELECT state,data FROM file_removals WHERE id=?').get(operationId) as Row | undefined;
      if (operation?.state !== 'preparing' || JSON.parse(operation.data).workId !== id) throw new Error('A exclusão não possui um registro de recuperação válido.');
      const history = this.historyEntry(id);
      if (history) {
        history.removedAt = new Date().toISOString();
        const hideFiles = (work: Work): Work => ({ ...work,available: false,files: work.files.map(file => ({ ...file,available: false })),children: work.children?.map(hideFiles) });
        history.work = hideFiles(history.work);
        if (history.work.kind === 'series') {
          history.work.children = history.work.children?.map(season => {
            const children = season.children?.filter(episode => episode.watched);
            const fileIds = new Set(children?.flatMap(episode => episode.files.map(file => file.id)));
            return { ...season,children,files: season.files.filter(file => fileIds.has(file.id)) };
          }).filter(season => season.children?.length);
          const fileIds = new Set(history.work.children?.flatMap(season => season.files.map(file => file.id)));
          history.work.files = history.work.files.filter(file => fileIds.has(file.id));
          history.work.sessions = history.work.sessions?.filter(session => fileIds.has(session.fileId));
        }
        this.db.prepare(`INSERT INTO watched_history VALUES (?,?,?,?) ON CONFLICT(root_id) DO UPDATE SET watched_at=excluded.watched_at,removed_at=excluded.removed_at,data=excluded.data`).run(id,history.watchedAt,history.removedAt,JSON.stringify(history));
      } else this.db.prepare('DELETE FROM watched_history WHERE root_id=?').run(id);
      const ids = (this.db.prepare('SELECT id FROM works WHERE id=? OR parent_id=? OR parent_id IN (SELECT id FROM works WHERE parent_id=?) ORDER BY CASE kind WHEN \'episode\' THEN 0 WHEN \'season\' THEN 1 ELSE 2 END').all(id,id,id) as Row[]).map(row => row.id);
      const files = this.detail(id).files;
      for (const workId of ids) {
        for (const table of ['list_items','personal','metadata_sources','file_works']) this.db.prepare(`DELETE FROM ${table} WHERE work_id=?`).run(workId);
        this.db.prepare('DELETE FROM works WHERE id=?').run(workId);
      }
      for (const file of files) {
        if (this.db.prepare('SELECT 1 FROM file_works WHERE file_id=?').get(file.id)) continue;
        this.db.prepare('DELETE FROM sessions WHERE file_id=?').run(file.id);
        this.db.prepare('DELETE FROM progress WHERE file_id=?').run(file.id);
        this.db.prepare('DELETE FROM files WHERE id=?').run(file.id);
      }
      this.db.prepare("UPDATE file_removals SET state='committed' WHERE id=?").run(operationId);
      return !!history;
    });
  }
  edit(id: string, value: { title: string; year: number | null; overview: string; tags: string[] }) {
    const work = this.detail(id);
    const row = this.db.prepare('SELECT overrides FROM works WHERE id=?').get(id) as Row;
    this.transaction(() => {
      this.db.prepare('UPDATE works SET title=?,year=?,overrides=? WHERE id=?').run(value.title,value.year,JSON.stringify({ ...JSON.parse(row.overrides), title: value.title, year: value.year, overview: value.overview }),id);
      this.savePersonal(id, { ...work.personal, tags: value.tags });
    });
  }
  private ensureWork(key: string, kind: string, title: string, year: number | null, parent: string | null = null, season: number | null = null, episode: number | null = null): string {
    const found = this.db.prepare('SELECT id FROM works WHERE inferred_key=?').get(key) as Row | undefined;
    if (found) return found.id;
    // Also use previously fetched episodes rather than creating a duplicate local episode.
    if (kind === 'episode' || kind === 'season') {
      const existing = this.db.prepare('SELECT id FROM works WHERE kind=? AND parent_id=? AND season=? AND episode IS ?').get(kind,parent,season,episode) as Row | undefined;
      if (existing) return existing.id;
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO works(id,kind,title,year,parent_id,season,episode,inferred_key,added_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,kind,title,year,parent,season,episode,key,new Date().toISOString());
    return id;
  }
  importFile(data: Omit<MediaFile,'position'|'completed'|'id'> & { mtime: number; fingerprint: string; id?: string }, identity: Identity) {
    return this.transaction(() => {
      let id = data.id ?? randomUUID();
      const prior = this.db.prepare('SELECT id,fingerprint FROM files WHERE path=? AND available=1').get(data.path) as Row | undefined;
      if (prior?.fingerprint === data.fingerprint) id = prior.id;
      else if (prior) this.db.prepare('UPDATE files SET available=0 WHERE id=?').run(prior.id);
      this.db.prepare(`INSERT INTO files(id,path,size,mtime,fingerprint,duration,width,height,video_codec,tracks,available) VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET path=excluded.path,size=excluded.size,mtime=excluded.mtime,fingerprint=excluded.fingerprint,duration=excluded.duration,width=excluded.width,height=excluded.height,video_codec=excluded.video_codec,tracks=excluded.tracks,available=1`).run(id,data.path,data.size,data.mtime,data.fingerprint,data.duration,data.width,data.height,data.videoCodec,JSON.stringify(data.tracks));
      if ((this.db.prepare('SELECT count(*) AS n FROM file_works WHERE file_id=?').get(id) as Row).n) return id;
      const key = `${identity.kind === 'movie' ? 'movie' : 'series'}:${normalize(identity.title)}:${identity.year ?? ''}`;
      if (identity.kind === 'movie') {
        const work = this.ensureWork(key,'movie',identity.title,identity.year);
        this.db.prepare('INSERT OR IGNORE INTO file_works VALUES (?,?)').run(id,work);
      } else {
        const series = this.ensureWork(key,'series',identity.title,identity.year);
        const season = this.ensureWork(`${key}:s${identity.season}`,'season',identity.season === 0 ? 'Especiais' : `Temporada ${identity.season}`,null,series,identity.season);
        for (const n of identity.episodes) {
          const episode = this.ensureWork(`${key}:s${identity.season}:e${n}`,'episode',`Episódio ${n}`,null,season,identity.season,n);
          this.db.prepare('INSERT OR IGNORE INTO file_works VALUES (?,?)').run(id,episode);
        }
      }
    return id;
    });
  }
  markPresent(id: string) { this.db.prepare('UPDATE files SET available=1 WHERE id=?').run(id); }
  markMissing(ids: string[]) { this.transaction(() => { for (const id of ids) this.db.prepare('UPDATE files SET available=0 WHERE id=?').run(id); }); }
  saveMetadata(id: string, metadata: Metadata, title?: string, year?: number | null) {
    this.transaction(() => {
      const overrides = JSON.parse((this.db.prepare('SELECT overrides FROM works WHERE id=?').get(id) as Row).overrides);
      this.db.prepare('UPDATE works SET metadata=?,title=COALESCE(?,title),year=COALESCE(?,year),needs_identification=0 WHERE id=?').run(JSON.stringify(metadata),overrides.title ?? title ?? null,(Object.hasOwn(overrides,'year') ? overrides.year : year) ?? null,id);
      this.db.prepare('DELETE FROM metadata_sources WHERE work_id=?').run(id);
      for (const [provider, providerId] of [['tmdb',metadata.tmdbId],['imdb',metadata.imdbId]] as const) if (providerId) this.db.prepare('INSERT INTO metadata_sources VALUES (?,?,?,?) ON CONFLICT(work_id,provider) DO UPDATE SET provider_id=excluded.provider_id,fetched_at=excluded.fetched_at').run(id,provider,String(providerId),new Date().toISOString());
    });
  }
  unmatch(id: string) {
    this.detail(id);
    this.transaction(() => { this.db.prepare("UPDATE works SET metadata='{}',needs_identification=1 WHERE id=?").run(id); this.db.prepare('DELETE FROM metadata_sources WHERE work_id=?').run(id); });
  }
  upsertEpisode(seasonId: string, seriesKey: string, season: number, episode: number, title: string, metadata: Metadata) {
    const id = this.ensureWork(`${seriesKey}:s${season}:e${episode}`,'episode',title,null,seasonId,season,episode);
    this.saveMetadata(id,metadata,title);
  }
  ensureSeason(seriesId: string, number: number) { return this.ensureWork(`remote:${seriesId}:s${number}`,'season',number === 0 ? 'Especiais' : `Temporada ${number}`,null,seriesId,number); }
  startSession(fileId: string) { const id = randomUUID(); this.db.prepare('INSERT INTO sessions(id,file_id,started_at) VALUES (?,?,?)').run(id,fileId,new Date().toISOString()); return id; }
  playbackPreferences(fileId: string) { return this.db.prepare('SELECT audio,subtitle FROM progress WHERE file_id=?').get(fileId) as { audio: string | null; subtitle: string | null } | undefined; }
  progress(fileId: string, sessionId: string, position: number, duration: number, watched: number, ended: boolean, audio?: string, subtitle?: string) {
    const completed = duration > 0 && position / duration >= this.setting('completedPercent',90) / 100;
    const previouslyCompleted = !!(this.db.prepare('SELECT completed FROM progress WHERE file_id=?').get(fileId) as Row | undefined)?.completed;
    this.transaction(() => {
      this.db.prepare(`INSERT INTO progress(file_id,position,duration,completed,audio,subtitle,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=MAX(progress.completed,excluded.completed),audio=COALESCE(excluded.audio,progress.audio),subtitle=COALESCE(excluded.subtitle,progress.subtitle),updated_at=excluded.updated_at`).run(fileId,position,duration,Number(completed),audio ?? null,subtitle ?? null,new Date().toISOString());
      this.db.prepare('UPDATE sessions SET watched_seconds=?,end_position=?,ended_at=? WHERE id=?').run(watched,position,ended ? new Date().toISOString() : null,sessionId);
      if (completed && !previouslyCompleted || ended) {
        const roots = new Set((this.db.prepare('SELECT work_id FROM file_works WHERE file_id=?').all(fileId) as Row[]).map(row => this.rootWorkId(row.work_id)));
        for (const root of roots) this.syncHistory(root);
      }
    });
  }
  lists(): CustomList[] { return (this.db.prepare('SELECT * FROM lists ORDER BY name').all() as Row[]).map(x => ({ id: x.id, name: x.name, workIds: (this.db.prepare('SELECT work_id FROM list_items WHERE list_id=? ORDER BY position').all(x.id) as Row[]).map(x => x.work_id) })); }
  list(action: string, nameOrId: string, value?: string) {
    if (action === 'create') { this.db.prepare('INSERT INTO lists VALUES (?,?)').run(randomUUID(),nameOrId); return; }
    if (!this.lists().some(x => x.id === nameOrId)) throw new Error('Lista não encontrada.');
    if (action === 'delete') this.db.prepare('DELETE FROM lists WHERE id=?').run(nameOrId);
    if (action === 'rename') this.db.prepare('UPDATE lists SET name=? WHERE id=?').run(value!,nameOrId);
    if (action === 'add') { this.detail(value!); this.db.prepare('INSERT OR IGNORE INTO list_items VALUES (?,?,(SELECT COALESCE(MAX(position),0)+1 FROM list_items WHERE list_id=?))').run(nameOrId,value!,nameOrId); }
    if (action === 'remove') this.db.prepare('DELETE FROM list_items WHERE list_id=? AND work_id=?').run(nameOrId,value!);
    if (action === 'move') {
      const items = this.lists().find(x => x.id === nameOrId)!.workIds;
      const index = items.indexOf(value!);
      if (index > 0) { [items[index-1],items[index]] = [items[index],items[index-1]]; this.transaction(() => { items.forEach((id,n) => this.db.prepare('UPDATE list_items SET position=? WHERE list_id=? AND work_id=?').run(n,nameOrId,id)); }); }
    }
  }
  async backup() {
    this.assertOpen(); if (this.backupInFlight) throw new Error('Já existe um backup em andamento.');
    this.backupInFlight = true;
    const target = path.join(this.directory,'backups',`catalogo-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`);
    try { await this.assertDisk(); await backup(this.db,target); return target; } finally { this.backupInFlight = false; }
  }
  exportData() { return { formatVersion: 1, libraryId: this.manifest.id, exportedAt: new Date().toISOString(), works: this.works().map(x => ({ id: x.id, title: x.title, kind: x.kind, personal: x.personal })), personal: (this.db.prepare('SELECT work_id,data FROM personal').all() as Row[]).map(x => ({ workId: x.work_id, ...JSON.parse(x.data) })), lists: this.lists(), sessions: this.db.prepare('SELECT * FROM sessions').all(),history: this.history() }; }
  async close() {
    if (this.closed) return;
    while (this.backupInFlight) await new Promise(resolve => setTimeout(resolve,20));
    this.closed = true;
    try { this.db?.close(); } finally {
      await this.lock.release();
    }
  }
}
