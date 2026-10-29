import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MobileBackend } from '../src/mobile/backend';
import { availableUpdate } from '../src/mobile/updates';
import type { Device, DeviceFile } from '../src/mobile/native';
import { until } from './helpers';

function fixture() {
  const documents = new Map<string,string>([['addons','[]']]);
  const files: DeviceFile[] = [{ id: 'content://test/movie',name: 'Movie (2026).mp4',path: 'Movie (2026).mp4',size: 100,duration: 100,width: 1920,height: 1080 },...[1,2].map(n => ({ id: `content://test/episode-${n}`,name: `Show.S01E0${n}.mkv`,path: `Show/Show.S01E0${n}.mkv`,size: 200,duration: 100,width: 1920,height: 1080 }))];
  let callback: (event: any) => void = () => {};
  const deleted: string[] = [],played: any[] = [],jobs: any[] = [];
  const device: Device = {
    readDocument: async ({ name }) => ({ value: documents.get(name) ?? null }),writeDocument: async ({ name,value }) => { documents.set(name,value); },
    http: async ({ url }) => ({ url,status: 200,body: JSON.stringify({}) }),chooseFolder: async () => ({ uri: 'content://test/library',name: 'Biblioteca do teste' }),scan: async () => ({ files,errors: [] }),exists: async () => ({ exists: true }),deleteFiles: async ({ uris }) => { deleted.push(...uris); },open: async () => {},exportFile: async ({ name }) => ({ path: `content://export/${name}` }),
    setDownloadFolder: async () => {},enqueue: async ({ jobs: batch }) => { jobs.push(...batch); },downloads: async () => ({ jobs: [],root: 'file:///app/downloads',torrentAvailable: true }),downloadControl: async () => {},play: async value => { played.push(value); },control: async () => {},appInfo: async () => ({ versionName: 'test',versionCode: 1 }),installUpdate: async () => {},addListener: async (_name,listener) => { callback = listener; return { remove: async () => {} }; }
  };
  return { device,documents,files,played,deleted,jobs,emit: (event: any) => callback(event) };
}

test('Android importa filmes/séries, mantém avaliações e coleções e reabre o catálogo',async () => {
  const f = fixture(); const api = await new MobileBackend(f.device).initialize();
  assert.equal((await api.snapshot()).library,null);await api.chooseLibrary();
  const snapshot = await api.snapshot();assert.equal(snapshot.works.length,2);const series = snapshot.works.find(work => work.kind === 'series')!;
  assert.equal(series.children![0].children!.length,2);assert.equal(series.files.length,2);
  const movie = snapshot.works.find(work => work.kind === 'movie')!;
  await api.personal(movie.id,{ ...movie.personal,rating: 8.5,favorite: true });await api.list('create','Favoritos');const list = (await api.snapshot()).lists[0];await api.list('add',list.id,movie.id);
  await api.edit(movie.id,{ title: 'Meu filme',year: 2026,overview: 'Sinopse local',tags: ['teste'] });
  const reopened = await new MobileBackend(f.device).initialize(); const saved = await reopened.detail(movie.id);
  assert.equal(saved.title,'Meu filme');assert.equal(saved.personal.rating,8.5);assert.equal(saved.metadata.overview,'Sinopse local');assert.deepEqual((await reopened.snapshot()).lists[0].workIds,[movie.id]);
});

test('Android salva progresso e histórico; excluir assistido remove só os arquivos autorizados',async () => {
  const f = fixture();const api = await new MobileBackend(f.device).initialize();await api.chooseLibrary();const movie = (await api.snapshot()).works.find(work => work.kind === 'movie')!;
  await api.play(movie.files[0].id);assert.equal(f.played[0].url,'content://test/movie');
  f.emit({ type: 'playback',fileId: movie.files[0].id,position: 95,duration: 100,watchedSeconds: 95,ended: true });
  await until(async () => (await api.snapshot()).history.length === 1);
  const preview = await api.removalPreview(movie.id);assert.equal(preview.keepsHistory,true);
  const result = await api.removeWork(movie.id);assert.equal(result.keptHistory,true);assert.deepEqual(f.deleted,['content://test/movie']);
  const state = await api.snapshot();assert.equal(state.works.some(work => work.id === movie.id),false);assert.ok(state.history[0].removedAt);assert.equal(state.history[0].work.sessions![0].watchedSeconds,95);
});

test('Android não marca arquivos ausentes quando a varredura tem falhas',async () => {
  const f = fixture();const api = await new MobileBackend(f.device).initialize();await api.chooseLibrary();
  f.device.scan = async () => ({ files: [],errors: ['Armazenamento desconectado'] });await api.scan();
  assert.ok((await api.snapshot()).works.every(work => work.available));assert.deepEqual((await api.snapshot()).scan.errors,['Armazenamento desconectado']);
});

test('manifesto de atualização aceita somente o pacote e o APK oficiais com versão crescente',() => {
  const manifest = { schemaVersion: 1,applicationId: 'io.cinessd.android',versionCode: 20,versionName: '0.2.0',url: 'https://github.com/AugustodoBRT/Umbra/releases/download/android-latest/Umbra-android.apk',sha256: 'a'.repeat(64),minSdk: 28 };
  assert.equal(availableUpdate(manifest,19)?.versionCode,20);assert.equal(availableUpdate(manifest,20),null);assert.equal(availableUpdate(manifest,21),null);
  for (const patch of [{ applicationId: 'other.app' },{ url: 'https://example.org/app.apk' },{ sha256: 'bad' },{ versionCode: -1 },{ schemaVersion: 2 }]) assert.throws(() => availableUpdate({ ...manifest,...patch },1));
});

test('Android preserva o histórico conectado quando a exclusão falha',async () => {
  const f = fixture();const api = await new MobileBackend(f.device).initialize();await api.chooseLibrary();const movie = (await api.snapshot()).works.find(work => work.kind === 'movie')!;
  await api.personal(movie.id,{ ...movie.personal,watched: true });
  f.device.deleteFiles = async () => { throw new Error('Armazenamento desconectado'); };
  await assert.rejects(api.removeWork(movie.id),/desconectado/);
  const snapshot = await api.snapshot();assert.ok(snapshot.works.find(work => work.id === movie.id));assert.equal(snapshot.history[0].removedAt,null);
  const restored = await new MobileBackend(f.device).initialize();assert.equal((await restored.snapshot()).history[0].removedAt,null);
});
