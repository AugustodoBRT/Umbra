import { registerPlugin, Capacitor } from '@capacitor/core';
import type { DownloadJob, OnlineType } from '../shared/online';
export interface DeviceFile { id: string; name: string; path: string; size: number; duration: number; width: number; height: number }
export interface Device {
  readDocument(options: { name: string }): Promise<{ value: string | null }>;
  writeDocument(options: { name: string; value: string }): Promise<void>;
  http(options: { url: string; headers?: Record<string,string>; limit?: number }): Promise<{ body: string; url: string; status: number }>;
  chooseFolder(): Promise<{ uri: string; name: string; cancelled?: boolean }>;
  scan(options: { uri: string }): Promise<{ files: DeviceFile[]; errors: string[] }>;
  exists(options: { uri: string }): Promise<{ exists: boolean }>;
  deleteFiles(options: { uris: string[] }): Promise<void>;
  open(options: { url: string }): Promise<void>;
  exportFile(options: { name: string; value: string; uri?: string }): Promise<{ path: string }>;
  setDownloadFolder(options: { uri: string }): Promise<void>;
  enqueue(options: { jobs: DeviceJob[] }): Promise<void>;
  downloads(): Promise<{ jobs: DownloadJob[]; root: string; torrentAvailable: boolean }>;
  downloadControl(options: { action: string; id: string }): Promise<void>;
  play(options: { url?: string; infoHash?: string; fileIdx?: number; sources?: string[]; type: OnlineType; title: string; fileId?: string; start?: number; headers?: Record<string,string>; appearance?: unknown }): Promise<void>;
  control(options: { action: string; value?: number|string }): Promise<void>;
  appInfo(): Promise<{ versionCode: number; versionName: string }>;
  installUpdate(options: { url: string; sha256: string; versionCode: number }): Promise<void>;
  addListener(name: 'deviceEvent',callback: (event: any) => void): Promise<{ remove(): Promise<void> }>;
}
export interface DeviceJob { id: string; title: string; itemName: string; sourceName: string; type: OnlineType; folder: string; prefix: string; url?: string; infoHash?: string; fileIdx?: number; sources?: string[]; filename?: string; headers?: Record<string,string>; season?: number; episode?: number }
export const device = registerPlugin<Device>('UmbraDevice');
export const isAndroid = () => Capacitor.getPlatform() === 'android';
export const makeDeviceFetch = (platform: Device): typeof fetch => async (input,init) => {
  if (init?.signal?.aborted) throw new DOMException('Cancelado','AbortError');
  const url = String(input); const data = await platform.http({ url,headers: Object.fromEntries(new Headers(init?.headers)),limit: 5_000_000 });
  if (init?.signal?.aborted) throw new DOMException('Cancelado','AbortError');
  const response = new Response(data.body,{ status: data.status }); Object.defineProperty(response,'url',{ value: data.url }); return response;
};

export const deviceFetch = makeDeviceFetch(device);
