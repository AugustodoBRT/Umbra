import type { OnlineItem, OnlineType, OnlineLocalization } from '../shared/online';
import type { Personal } from '../shared/types';
import { device, type Device } from './native';
export const personal = (): Personal => ({ rating: null,review: '',spoilers: false,favorite: false,watchlist: false,watched: false,tags: [] });
export class Documents {
  constructor(private platform: Pick<Device,'readDocument'|'writeDocument'> = device) {}
  private chain = Promise.resolve();
  async loadDocument(name: string): Promise<any> { const { value } = await this.platform.readDocument({ name }); return value === null ? null : JSON.parse(value); }
  saveDocument(name: string,value: unknown) { const encoded = JSON.stringify(value); const task = this.chain.then(() => this.platform.writeDocument({ name,value: encoded })); this.chain = task.catch(() => {}); return task; }
}
export class MobileOnlineStore {
  items: Record<string,OnlineItem> = {};
  translations: Record<string,OnlineLocalization> = {};
  constructor(private changed: () => void) {}
  cache(item: Omit<OnlineItem,'personal'>): OnlineItem {
    const key = `${item.type}:${item.id}`,old = this.items[key];
    this.items[key] = { ...item,videos: item.videos.length ? item.videos : old?.videos ?? [],personal: old?.personal ?? personal() };
    this.changed(); return this.get(item.type,item.id);
  }
  get(type: OnlineType,id: string): OnlineItem {
    const item = this.items[`${type}:${id}`]; if (!item) throw new Error('Abra o título no catálogo primeiro.');
    const translation = this.localization(type,id);
    return translation ? { ...item,description: translation.description || item.description,genres: translation.genres?.length ? translation.genres : item.genres,metadataLanguage: translation.description ? 'pt-BR' : undefined } : item;
  }
  personal(type: OnlineType,id: string,value: Personal) { this.get(type,id); this.items[`${type}:${id}`].personal = value; this.changed(); }
  localization(type: OnlineType,id: string) { return this.translations[`${type}:${id}`] ?? null; }
  saveLocalization(type: OnlineType,id: string,value: OnlineLocalization) { this.translations[`${type}:${id}`] = value; this.changed(); }
  saved() { return Object.values(this.items).filter(item => item.personal.watchlist || item.personal.favorite || item.personal.rating !== null || item.personal.review).map(item => this.get(item.type,item.id)); }
}
