import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Providers, confidence, strongMatch, emptyIdentification } from '../src/metadata/providers';
import { library } from './helpers';
import { identify } from '../src/library/identify';
import { personalSchema } from '../src/shared/validation';
test('associação automática exige título exato, ano exato e resultado único',() => {
  const work = { title: 'A Chegada',year: 2016 };
  assert.equal(confidence(work,'A Chegada','Arrival',2016),1);
  assert.ok(confidence(work,'A Chegada','Arrival',2015)<.98);
  assert.ok(confidence({ ...work,year: null },'A Chegada','Arrival',2016)<.98);
  const candidate = { id: 1,kind: 'movie' as const,title: 'A Chegada',originalTitle: 'Arrival',year: 2016,overview: '',poster: null,confidence: 1 };
  assert.equal(strongMatch([candidate])?.id,1); assert.equal(strongMatch([candidate,{ ...candidate,id: 2 }]),null);
});
test('busca automática oferece candidatos sem ano, cacheia a consulta e preserva a decisão manual',async () => {
  const { root,store } = await library(); const originalFetch = globalThis.fetch;
  try {
    store.importFile({ path: 'Filmes/From.S04E01.mp4',size: 100,mtime: 1,fingerprint: 'abc',duration: 10,width: 100,height: 100,videoCodec: 'mpeg4',tracks: [],available: true },identify('From.S04E01.mp4'));
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ results: [{ id: 124364,name: 'From',original_name: 'From',first_air_date: '2022-02-20',overview: 'Sinopse de teste' }] })); };
    const providers = new Providers(); providers.tmdb = 'token-de-teste';
    let progress = emptyIdentification(); await providers.enrich(store,{ changed: value => { progress = value; } });
    const work = store.works()[0]; assert.ok(work.needsIdentification); assert.equal(work.metadata.tmdbId,undefined);
    assert.equal(progress.pending,1); assert.equal(progress.candidates[work.id][0].title,'From'); assert.equal(progress.running,false);
    await providers.enrich(store); assert.equal(requests,1);
    await providers.enrich(store,{ force: true }); assert.equal(requests,2);
    const localEpisode = store.detail(work.id).children![0].children![0];
    store.savePersonal(localEpisode.id,{ ...localEpisode.personal,rating: 9 });
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('/external_ids') ? { imdb_id: 'tt0000001' }
        : url.pathname.endsWith('/season/4') ? { id: 400,overview: 'Temporada de teste',episodes: [{ id: 401,episode_number: 1,name: 'Nome do episódio',overview: 'Sinopse do episódio',vote_average: 7.3,vote_count: 10,runtime: 54 }] }
        : { id: 124364,name: 'From',original_name: 'From',overview: 'Sinopse da série',vote_average: 8.1,vote_count: 100,seasons: [{ season_number: 4 }],external_ids: {} };
      return new Response(JSON.stringify(data));
    };
    await providers.associate(store,store.detail(work.id),progress.candidates[work.id][0]);
    const result = store.detail(work.id); const episode = result.children![0].children![0];
    assert.equal(result.metadata.overview,'Sinopse da série'); assert.equal(result.needsIdentification,false);
    assert.equal(episode.id,localEpisode.id); assert.equal(episode.title,'Nome do episódio'); assert.equal(episode.metadata.overview,'Sinopse do episódio');
    assert.equal(episode.metadata.tmdb?.value,7.3); assert.equal(episode.personal.rating,9); assert.equal(episode.files[0].id,localEpisode.files[0].id);
  } finally { globalThis.fetch = originalFetch; await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('validação diferencia não avaliado de nota baixa e recusa incrementos inválidos',() => {
  const personal = { rating: null,review: '',spoilers: false,favorite: false,watchlist: false,watched: false,tags: [] };
  assert.equal(personalSchema.parse(personal).rating,null); assert.equal(personalSchema.parse({ ...personal,rating: .5 }).rating,.5);
  for (const rating of [0,1.3,11]) assert.equal(personalSchema.safeParse({ ...personal,rating }).success,false);
});
test('provedores separam IMDb e TMDB, preservam avaliação e edição local ao reassociar',async () => {
  const { root,store } = await library(); const originalFetch = globalThis.fetch;
  try {
    store.importFile({ path: 'Filmes/A Chegada (2016).mp4',size: 100,mtime: 1,fingerprint: 'abc',duration: 10,width: 100,height: 100,videoCodec: 'mpeg4',tracks: [],available: true },identify('A Chegada (2016).mp4'));
    const work = store.works()[0]; store.savePersonal(work.id,{ ...work.personal,rating: 9.5,review: 'Minha resenha.' });
    store.edit(work.id,{ title: 'Título pessoal',year: 2016,overview: 'Sinopse pessoal',tags: ['favorito'] });
    const requested: string[] = [];
    globalThis.fetch = async (input: any) => {
      const url = String(input); requested.push(url);
      if (url.includes('omdbapi')) return new Response(JSON.stringify({ Response: 'True',imdbRating: 'N/A',imdbVotes: 'N/A' }));
      return new Response(JSON.stringify({ id: 329865,title: 'A Chegada',original_title: 'Arrival',overview: 'Sinopse TMDB',imdb_id: 'tt2543164',vote_average: 7.6,vote_count: 3000,genres: [{ name: 'Ficção científica' }],credits: { cast: [],crew: [] } }));
    };
    const providers = new Providers(); providers.tmdb = 'token'; providers.omdb = 'test';
    await providers.associate(store,store.detail(work.id),{ id: 329865,kind: 'movie',title: 'A Chegada',originalTitle: 'Arrival',year: 2016,overview: '',poster: null,confidence: 1 });
    const result = store.detail(work.id); assert.equal(result.metadata.tmdb?.value,7.6); assert.equal(result.metadata.imdb?.value,null); assert.equal(result.metadata.imdb?.votes,null); assert.equal(result.personal.rating,9.5); assert.equal(result.personal.review,'Minha resenha.'); assert.equal(result.metadata.overview,'Sinopse pessoal'); assert.equal(result.title,'Título pessoal');
    assert.ok(requested.find(x => x.includes('i=tt2543164')));
    store.unmatch(work.id); assert.equal(store.detail(work.id).personal.rating,9.5); assert.equal(store.detail(work.id).metadata.overview,'Sinopse pessoal'); assert.equal(store.detail(work.id).metadata.tmdb,undefined);
  } finally { globalThis.fetch = originalFetch; await store.close(); await rm(root,{ recursive: true,force: true }); }
});
