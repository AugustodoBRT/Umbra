import { DatabaseSync } from 'node:sqlite';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { emptyPersonal } from './store';
import type { OnlineItem, OnlineType, OnlineLocalization } from '../shared/online';
import type { Personal } from '../shared/types';

export class OnlineStore {
  private db: DatabaseSync;
  constructor(directory: string) {
    const file = path.join(directory,'online.sqlite');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS items(key TEXT PRIMARY KEY,data TEXT NOT NULL,personal TEXT NOT NULL,updated_at TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS translations(key TEXT PRIMARY KEY,data TEXT NOT NULL);');
    void chmod(file,0o600).catch(() => {});
  }
  private key(type: OnlineType,id: string) { return `${type}:${id}`; }
  cache(item: Omit<OnlineItem,'personal'>): OnlineItem {
    const key = this.key(item.type,item.id);
    const old = this.db.prepare('SELECT personal,data FROM items WHERE key=?').get(key) as { personal: string; data: string } | undefined;
    const personal: Personal = old ? JSON.parse(old.personal) : emptyPersonal();
    const previous = old ? JSON.parse(old.data) : undefined;
    const value = { ...item,videos: item.videos.length ? item.videos : previous?.videos ?? [] };
    this.db.prepare('INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(key,JSON.stringify(value),JSON.stringify(personal),new Date().toISOString());
    return this.applyLocalization({ ...value,personal });
  }
  get(type: OnlineType,id: string): OnlineItem {
    const row = this.db.prepare('SELECT data,personal FROM items WHERE key=?').get(this.key(type,id)) as { data: string; personal: string } | undefined;
    if (!row) throw new Error('Abra o título no catálogo antes de escolher uma fonte.');
    return this.applyLocalization({ ...JSON.parse(row.data),personal: JSON.parse(row.personal) });
  }
  localization(type: OnlineType,id: string): OnlineLocalization | null {
    const row = this.db.prepare('SELECT data FROM translations WHERE key=?').get(this.key(type,id)) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  saveLocalization(type: OnlineType,id: string,value: OnlineLocalization) {
    this.db.prepare('INSERT INTO translations VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(this.key(type,id),JSON.stringify(value));
  }
  private applyLocalization(item: OnlineItem): OnlineItem {
    const value = this.localization(item.type,item.id);
    return value ? { ...item,description: value.description || item.description,genres: value.genres?.length ? value.genres : item.genres,metadataLanguage: value.description ? 'pt-BR' : undefined } : item;
  }
  personal(type: OnlineType,id: string,value: Personal) { this.get(type,id); this.db.prepare('UPDATE items SET personal=? WHERE key=?').run(JSON.stringify(value),this.key(type,id)); }
  saved(): OnlineItem[] {
    return (this.db.prepare('SELECT data,personal FROM items ORDER BY updated_at DESC').all() as { data: string; personal: string }[]).map(row => this.applyLocalization({ ...JSON.parse(row.data),personal: JSON.parse(row.personal) })).filter(item => item.personal.watchlist || item.personal.favorite || item.personal.rating !== null || item.personal.review);
  }
  close() { this.db.close(); }
}
