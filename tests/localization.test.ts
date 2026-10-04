import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Providers } from '../src/metadata/providers';
import { OnlineStore } from '../src/storage/online';
import { Credentials } from '../src/storage/credentials';
import { Addons } from '../src/online/addons';
import { emptyPersonal } from '../src/storage/store';
import { identify } from '../src/library/identify';
import { library } from './helpers';

test('sinopse e gêneros pt-BR usam o IMDb exato, preservando nome, fontes e notas do catálogo',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-localization-')); const originalFetch = globalThis.fetch;
  let store = new OnlineStore(directory);
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' });
  await credentials.saveDocument('addons',[]);
  const providers = new Providers(); providers.tmdb = 'token-sintetico'; let tmdbRequests = 0;
  let offline = false;
  const manifest = { id: 'test.translation',name: 'Teste',resources: ['catalog','meta','stream'],types: ['movie','series'],catalogs: [{ id: 'top',type: 'movie' }] };
  const movie = { id: 'tt2543164',name: 'Arrival',type: 'movie',description: 'An English synopsis.',genres: ['Science Fiction'],imdbRating: '8.0' };
  globalThis.fetch = async input => {
    if (offline) throw new TypeError('offline');
    const url = new URL(String(input));
    if (url.hostname === 'api.themoviedb.org') {
      tmdbRequests++; assert.equal(url.searchParams.get('language'),'pt-BR');
      if (url.pathname.includes('/find/')) { assert.equal(url.pathname,'/3/find/tt2543164'); assert.equal(url.searchParams.get('external_source'),'imdb_id'); return new Response(JSON.stringify({ movie_results: [{ id: 329865 }],tv_results: [] })); }
      assert.equal(url.pathname,'/3/movie/329865'); return new Response(JSON.stringify({ id: 329865,title: 'A Chegada',overview: 'Uma linguista investiga a chegada de visitantes à Terra.',genres: [{ name: 'Ficção científica' }] }));
    }
    return new Response(JSON.stringify(url.pathname.endsWith('manifest.json') ? manifest : url.pathname.includes('/catalog/') ? { metas: [movie] } : { meta: movie }));
  };
  try {
    const addons = new Addons(credentials,store,item => providers.localizeOnline(item)); await addons.initialize(); await addons.install('https://test.invalid/manifest.json');
    const addonId = addons.list()[0].id; await addons.catalog(addonId,'top','movie');
    store.personal('movie',movie.id,{ ...emptyPersonal(),rating: 8.5,watchlist: true });
    const item = await addons.meta(addonId,'movie',movie.id);
    assert.equal(item.name,'Arrival'); assert.equal(item.id,movie.id); assert.equal(item.addonId,addonId); assert.equal(item.imdbRating,8);
    assert.equal(item.personal.rating,8.5); assert.equal(item.description,'Uma linguista investiga a chegada de visitantes à Terra.'); assert.deepEqual(item.genres,['Ficção científica']); assert.equal(item.metadataLanguage,'pt-BR');
    await addons.meta(addonId,'movie',movie.id); assert.equal(tmdbRequests,2);
    await addons.catalog(addonId,'top','movie'); assert.equal(store.get('movie',movie.id).description,item.description);
    store.close(); store = new OnlineStore(directory); offline = true;
    const reopened = new Addons(credentials,store,value => providers.localizeOnline(value)); await reopened.initialize();
    const saved = await reopened.meta(addonId,'movie',movie.id); assert.equal(saved.description,item.description); assert.equal(saved.name,'Arrival'); assert.equal(saved.personal.rating,8.5);
    assert.equal(reopened.saved()[0].description,item.description);
  } finally { globalThis.fetch = originalFetch; store.close(); await rm(directory,{ recursive: true,force: true }); }
});

test('sem chave, ID compatível, tradução ou conexão, o catálogo mantém o texto disponível',async () => {
  const originalFetch = globalThis.fetch; const providers = new Providers();
  let calls = 0;
  globalThis.fetch = async input => {
    calls++; const url = new URL(String(input));
    return new Response(JSON.stringify(url.pathname.includes('/find/') ? { tv_results: [{ id: 1399 }] } : { id: 1399,overview: '',genres: [] }));
  };
  try {
    assert.equal(await providers.localizeOnline({ id: 'tt0944947',type: 'series' }),null); assert.equal(calls,0);
    providers.tmdb = 'token'; assert.equal(await providers.localizeOnline({ id: 'custom:series',type: 'series' }),null); assert.equal(calls,0);
    const translation = await providers.localizeOnline({ id: 'tt0944947',type: 'series' }); assert.equal(translation?.description,undefined);
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(providers.localizeOnline({ id: 'tt0944947',type: 'series' }),/conexão/);
  } finally { globalThis.fetch = originalFetch; }
});

test('biblioteca local usa sinopse pt-BR e título original; atualização explícita renova obras já identificadas',async () => {
  const { root,store } = await library(); const originalFetch = globalThis.fetch;
  const providers = new Providers(); providers.tmdb = 'token'; const languages: string[] = []; let translated = true;
  globalThis.fetch = async input => {
    const url = new URL(String(input)); const language = url.searchParams.get('language')!; languages.push(language);
    return new Response(JSON.stringify({ id: 329865,title: 'A Chegada',original_title: 'Arrival',overview: language === 'pt-BR' && translated ? 'Uma linguista recebe uma missão.' : language === 'en-US' ? 'An English fallback.' : '',genres: [{ name: 'Ficção científica' }],credits: { cast: [],crew: [] } }));
  };
  try {
    store.importFile({ path: 'Filmes/Arrival (2016).mp4',size: 1,mtime: 1,fingerprint: 'x',duration: 100,width: 1,height: 1,videoCodec: 'mpeg4',tracks: [],available: true },identify('Arrival (2016).mp4'));
    const work = store.works()[0]; const candidate = { id: 329865,kind: 'movie' as const,title: 'A Chegada',originalTitle: 'Arrival',year: 2016,overview: '',poster: null,confidence: 1 };
    await providers.associate(store,work,candidate); assert.equal(store.detail(work.id).title,'Arrival'); assert.equal(store.detail(work.id).metadata.overview,'Uma linguista recebe uma missão.');
    store.saveMetadata(work.id,{ ...store.detail(work.id).metadata,overview: 'Old English synopsis.' });
    await providers.enrich(store,{ force: true }); assert.equal(store.detail(work.id).metadata.overview,'Uma linguista recebe uma missão.');
    assert.deepEqual(languages,['pt-BR','pt-BR']); translated = false;
    await providers.associate(store,store.detail(work.id),candidate); assert.equal(store.detail(work.id).metadata.overview,'An English fallback.'); assert.equal(store.detail(work.id).title,'Arrival');
    assert.deepEqual(languages.slice(-2),['pt-BR','en-US']);
  } finally { globalThis.fetch = originalFetch; await store.close(); await rm(root,{ recursive: true,force: true }); }
});
