import { contextBridge, ipcRenderer } from 'electron';
import type { API, Event } from '../shared/types';
const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`cine:${name}`,...args);
const api: API = {
  subtitleAppearance: value => invoke('subtitleAppearance',value),
  addons: () => invoke('addons'),installAddon: url => invoke('installAddon',url),addon: (action,id) => invoke('addon',action,id),configureAddon: id => invoke('configureAddon',id),
  onlineCatalog: (...args) => invoke('onlineCatalog',...args),onlineMeta: (...args) => invoke('onlineMeta',...args),onlineSources: (...args) => invoke('onlineSources',...args),onlinePersonal: (...args) => invoke('onlinePersonal',...args),onlineSaved: () => invoke('onlineSaved'),
  planSeason: (...args) => invoke('planSeason',...args),downloadSource: id => invoke('downloadSource',id),downloadSeason: (...args) => invoke('downloadSeason',...args),downloads: () => invoke('downloads'),downloadControl: (...args) => invoke('downloadControl',...args),chooseDownloadFolder: () => invoke('chooseDownloadFolder'),
  snapshot: () => invoke('snapshot'), chooseLibrary: () => invoke('chooseLibrary'), disconnect: () => invoke('disconnect'), addSource: () => invoke('addSource'), scan: () => invoke('scan'), cancelScan: () => invoke('cancelScan'), detail: id => invoke('detail',id),
  removalPreview: id => invoke('removalPreview',id),removeWork: id => invoke('removeWork',id),
  personal: (id,value) => invoke('personal',id,value), edit: (id,value) => invoke('edit',id,value), play: (id,restart) => invoke('play',id,restart), control: (action,value) => invoke('control',action,value), reveal: id => invoke('reveal',id),
  playbackReport: (...args) => invoke('playbackReport',...args),
  searchMetadata: (id,query) => invoke('searchMetadata',id,query), associate: (id,candidate) => invoke('associate',id,candidate), unmatch: id => invoke('unmatch',id), loadSeason: id => invoke('loadSeason',id), enrich: () => invoke('enrich'), saveKeys: (tmdb,omdb) => invoke('saveKeys',tmdb,omdb), settings: value => invoke('settings',value), backup: () => invoke('backup'), exportData: () => invoke('exportData'), list: (action,id,value) => invoke('list',action,id,value),
  onEvent(callback) { const listener = (_: unknown,event: Event) => callback(event); ipcRenderer.on('cine:event',listener); return () => ipcRenderer.removeListener('cine:event',listener); }
};
contextBridge.exposeInMainWorld('cine',api);
