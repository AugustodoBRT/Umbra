import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mediaTool } from '../src/runtime/tools';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Credentials } from '../src/storage/credentials';
import { media, until } from '../tests/helpers';

const directory = await mkdtemp(path.join(tmpdir(),'cine-online-desktop-')); const root = path.join(directory,'SSD'),config = path.join(directory,'computer'); await mkdir(root); await mkdir(config);
const video = path.join(directory,'video.mp4'); media(video,'teal',3); const payload = await readFile(video);
const credentials = new Credentials(config,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' }); await credentials.saveDocument('addons',[]);
const audiobook = path.join(directory,'audiobook.m4b');
execFileSync(mediaTool('ffmpeg'),['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=30','-c:a','aac','-f','mp4',audiobook]);
const audioPayload = await readFile(audiobook);
let port = 0, explicitTracks = true;
const server = createServer((request,response) => {
  const url = decodeURIComponent(request.url!);
  if (url.startsWith('/audio.m4b')) {
    response.setHeader('content-type','audio/mp4'); response.setHeader('accept-ranges','bytes');
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0,end = range?.[2] ? Math.min(Number(range[2]),audioPayload.length-1) : audioPayload.length-1;
    if (range) { response.statusCode = 206; response.setHeader('content-range',`bytes ${start}-${end}/${audioPayload.length}`); }
    response.setHeader('content-length',end-start+1); response.end(audioPayload.subarray(start,end+1)); return;
  }
  if (url.startsWith('/audio-catalog')) { response.setHeader('content-type','application/opds+json'); response.end(JSON.stringify({ metadata: { title: 'Audiobooks Sintéticos' },links: [{ rel: 'search',href: '/audio-catalog{?query}',type: 'application/opds+json' }],publications: [{ metadata: { '@type': 'http://schema.org/Audiobook',identifier: 'urn:audio:synthetic',title: 'Audiobook Sintético',author: 'Autora Sintética',narrator: 'Narradora Sintética',published: '2026-01-01' },links: [{ rel: 'download',href: '/audio.m4b?key=fake-audio-key',type: 'audio/mp4' }] }] })); return; }
  if (url.startsWith('/book.pdf')) { response.setHeader('content-type','application/pdf'); response.end('%PDF-1.4\nLivro sintético'); return; }
  if (url.startsWith('/opds')) { response.setHeader('content-type','application/opds+json'); response.end(JSON.stringify({ metadata: { title: 'Livros Sintéticos' },links: [{ rel: 'search',href: '/opds{?query,title,author}',type: 'application/opds+json' }],publications: [{ metadata: { identifier: 'urn:isbn:synthetic',title: 'Livro Sintético',author: 'Autora Sintética',description: 'Livro gerado para testar as fontes.',published: '2026-01-01' },links: [{ rel: 'http://opds-spec.org/acquisition/open-access',href: '/book.pdf?key=fake-book-key',type: 'application/pdf' }] }] })); return; }
  if (url.startsWith('/file/')) { response.setHeader('content-type','video/mp4'); response.setHeader('content-length',payload.length); response.end(payload); return; }
  response.setHeader('content-type','application/json');
  const movie = { id: 'tt1234567',type: 'movie',name: 'Filme Sintético',releaseInfo: '2026',description: 'An English synopsis from the synthetic catalog.',imdbRating: '8.4' };
  const series = { id: 'demo:series',type: 'series',name: 'Série Sintética',releaseInfo: '2026-',description: 'Série de teste para o download por temporada.',videos: [1,2].flatMap(season => [1,2].map(episode => ({ id: `demo:series:${season}:${episode}`,season,episode,title: `Episódio ${episode}`,released: '2026-01-01' }))) };
  if (url.endsWith('manifest.json')) response.end(JSON.stringify({ id: url.startsWith('/second/') ? 'org.cinessd.second' : 'org.cinessd.synthetic',name: url.startsWith('/second/') ? 'Fonte Alternativa' : 'Complemento Sintético',description: 'Somente arquivos gerados para teste.',resources: ['catalog','meta','stream'],types: ['movie','series'],idPrefixes: ['demo:','tt'],catalogs: ['movie','series'].map(type => ({ id: 'top',type,name: type === 'movie' ? 'Filmes' : 'Séries',extra: [{ name: 'search' },{ name: 'skip' }] })) }));
  else if (url.includes('/catalog/')) response.end(JSON.stringify({ metas: url.includes('/series/') ? [series] : [movie] }));
  else if (url.includes('/meta/')) response.end(JSON.stringify({ meta: url.includes('/series/') ? series : movie }));
  else response.end(JSON.stringify({ streams: [{ name: '1080p · Arquivo de teste',title: `Vídeo sintético\n👤 113 💾 3.45 GB ⚙️ Provedor Sintético\n${explicitTracks ? 'Áudio: 🇧🇷 / 🇬🇧\nLegendas: 🇧🇷 / 🇪🇸\n' : ''}🇧🇷 / 🇬🇧 / 🇫🇷 / 🇩🇪 / 🇯🇵`,url: `http://127.0.0.1:${port}/file/${encodeURIComponent(url)}.mp4?key=fake-test-key`,behaviorHints: { filename: 'Arquivo.1080p.BluRay.AV1-GROUP.mp4' } }] }));
});
server.listen(0,'127.0.0.1'); await once(server,'listening'); port = (server.address() as { port: number }).port;
const output = path.resolve('test-results'); await mkdir(output,{ recursive: true });
let runtime: Awaited<ReturnType<typeof electron.launch>> | undefined;
const errors: string[] = [];
async function launch() {
  const packaged = process.env.UMBRA_PACKAGED_EXECUTABLE;
  runtime = await electron.launch({ executablePath: packaged || process.env.CINESSD_ELECTRON || '/usr/bin/electron',args: packaged ? ['--password-store=basic'] : [path.resolve('.'),'--password-store=basic',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env: Object.fromEntries(Object.entries({ ...process.env,CINESSD_DATA_DIR: config,CINESSD_MPV_AUDIO: 'null' }).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')),timeout: 60000 });
  const page = await runtime.firstWindow(); page.on('pageerror',error => errors.push(error.message)); page.on('console',message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.getByRole('button',{ name: 'Umbra, início' }).waitFor(); return page;
}
try {
  let page = await launch(); assert.equal((await page.evaluate(() => window.cine.snapshot())).library,null);
  await page.getByRole('button',{ name: 'Complementos',exact: true }).first().click();
  await page.getByLabel('Link de instalação do complemento').fill(`http://127.0.0.1:${port}/configured/manifest.json`);
  await page.getByRole('button',{ name: 'Adicionar complemento',exact: true }).click(); await page.getByRole('heading',{ name: 'Complemento Sintético',exact: true }).waitFor();
  await page.getByRole('button',{ name: 'Explorar',exact: true }).click(); await page.getByRole('button',{ name: 'Ver título online Filme Sintético' }).waitFor();
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'10-catalogo-online.png') });
  await page.getByRole('button',{ name: 'Ver título online Filme Sintético' }).click(); await page.getByRole('button',{ name: 'Baixar filme',exact: true }).waitFor();
  assert.ok(await page.getByText('Configure o TMDB em Configurações',{ exact: false }).isVisible());
  await runtime!.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input,init) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.themoviedb.org') return originalFetch(input,init);
      const data = url.pathname.includes('/find/') ? { movie_results: [{ id: 123 }] } : url.pathname.includes('/search/') ? { results: [] } : { id: 123,title: 'Título traduzido',original_title: 'Original Movie',overview: 'Uma sinopse em português, mantendo o nome do catálogo.',genres: [{ name: 'Ficção científica' }] };
      return new Response(JSON.stringify(data));
    };
  });
  await page.evaluate(() => window.cine.saveKeys('synthetic-tmdb-token',''));
  await page.getByRole('dialog',{ name: 'Detalhes online de Filme Sintético' }).getByRole('button',{ name: 'Fechar',exact: true }).click();
  await page.getByRole('button',{ name: 'Ver título online Filme Sintético' }).click();
  await page.getByText('Uma sinopse em português, mantendo o nome do catálogo.',{ exact: true }).waitFor();
  assert.ok(await page.getByRole('heading',{ name: 'Filme Sintético',exact: true }).isVisible());
  await page.getByRole('button',{ name: 'Baixar filme',exact: true }).waitFor();
  const tracks = page.getByRole('table',{ name: 'Áudio, legendas e idiomas da fonte' });
  assert.ok(await tracks.getByRole('row',{ name: /^Áudio/ }).getByText('Português (Brasil)',{ exact: true }).isVisible());
  assert.ok(await tracks.getByRole('row',{ name: /^Legendas/ }).getByText('Espanhol',{ exact: true }).isVisible());
  assert.ok(await tracks.getByText('A fonte não distingue se são de áudio ou de legenda.',{ exact: true }).isVisible());
  assert.ok(await page.getByText('3,45 GB',{ exact: true }).isVisible());
  assert.ok(await page.getByText('113 compartilhando',{ exact: true }).isVisible());
  await tracks.getByRole('button',{ name: '+1 idiomas',exact: true }).click();
  assert.ok(await tracks.getByText('Japonês',{ exact: true }).isVisible());
  assert.ok(await page.locator('.source-flag').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)));
  await page.getByRole('button',{ name: 'Minha lista online',exact: true }).last().click();
  // Wait for the asynchronous save and its UI update before editing another field.
  await page.getByRole('button',{ name: 'Na minha lista online',exact: true }).waitFor();
  await page.getByLabel('Minha nota online').selectOption('8.5');
  await until(async () => { const saved = await page.evaluate(() => window.cine.onlineSaved()); return saved[0]?.personal.rating === 8.5 && saved[0].personal.watchlist; });
  if (await page.getByRole('button',{ name: 'Fechar aviso',exact: true }).isVisible()) await page.getByRole('button',{ name: 'Fechar aviso',exact: true }).click();
  await page.locator('.source-card').screenshot({ animations: 'disabled',path: path.join(output,'14-detalhes-fonte.png') });
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'11-fontes-download.png') });
  explicitTracks = false; await page.getByRole('button',{ name: 'Buscar fontes',exact: true }).click();
  await tracks.getByRole('row',{ name: /^Áudio/ }).getByText('Não informado',{ exact: true }).waitFor();
  assert.ok(await tracks.getByRole('row',{ name: /^Legendas/ }).getByText('Não informado',{ exact: true }).isVisible());
  assert.ok(await tracks.getByRole('row',{ name: /^Idiomas anunciados/ }).getByText('Português (Brasil)',{ exact: true }).isVisible());
  await page.locator('.source-card').screenshot({ animations: 'disabled',path: path.join(output,'15-idiomas-anunciados.png') });
  // A fresh destination has no Filmes/Series parents. This catches Windows path splitting regressions.
  for (const folder of ['Filmes','Series']) await assert.rejects(stat(path.join(root,folder)),{ code: 'ENOENT' });
  await runtime!.evaluate(({ dialog },selected) => { dialog.showOpenDialog = async () => ({ canceled: false,filePaths: [selected] }); },root);
  await page.getByRole('button',{ name: 'Baixar filme',exact: true }).click();
  await page.getByRole('heading',{ name: 'Downloads',exact: true }).waitFor();
  await until(async () => { const jobs = (await page.evaluate(() => window.cine.downloads())).jobs; const snapshot = await page.evaluate(() => window.cine.snapshot()); return jobs[0]?.state === 'completed' && !snapshot.scan.running && snapshot.works.length === 1; },20000);
  assert.equal((await stat(path.join(root,'Filmes','Filme Sintético (2026)','Filme Sintético (2026).mp4'))).size,payload.length);
  await page.getByRole('button',{ name: 'Explorar',exact: true }).click(); await page.locator('main').getByRole('button',{ name: 'Séries',exact: true }).click();
  await page.getByRole('button',{ name: 'Ver título online Série Sintética' }).click(); await page.getByRole('button',{ name: 'Usar para a temporada',exact: true }).waitFor();
  await page.getByLabel('Temporada para baixar').selectOption('1'); await page.getByRole('button',{ name: 'Usar para a temporada',exact: true }).click();
  await page.getByRole('dialog',{ name: 'Revisar download da temporada' }).waitFor(); assert.ok(await page.getByText('2/2 episódios selecionados.',{ exact: false }).isVisible());
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'12-revisao-temporada.png') });
  await page.getByRole('button',{ name: 'Baixar temporada completa',exact: true }).click(); await page.getByRole('heading',{ name: 'Downloads',exact: true }).waitFor();
  await until(async () => { const jobs = (await page.evaluate(() => window.cine.downloads())).jobs; const snapshot = await page.evaluate(() => window.cine.snapshot()); return jobs.length === 3 && jobs.every(job => job.state === 'completed') && !snapshot.scan.running && snapshot.works.length === 2; },20000);
  const seriesDirectory = path.join(root,'Series','Série Sintética (2026)','Temporada 01');
  for (const n of [1,2]) assert.equal((await stat(path.join(seriesDirectory,`Série Sintética (2026) - S01E0${n}.mp4`))).size,payload.length);
  await assert.rejects(stat(path.join(root,'Series','Série Sintética (2026)','Temporada 02')),{ code: 'ENOENT' });
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'13-downloads-concluidos.png') });
  const snapshot = await page.evaluate(() => window.cine.snapshot()); const local = await page.evaluate(id => window.cine.detail(id),snapshot.works.find(work => work.kind === 'series')!.id); assert.equal(local.children![0].children!.length,2);
  assert.ok(!JSON.stringify(await page.evaluate(() => window.cine.downloads())).includes('fake-test-key'));
  await runtime!.close(); runtime = undefined; page = await launch();
  assert.equal((await page.evaluate(() => window.cine.downloads())).jobs.length,3); assert.equal((await page.evaluate(() => window.cine.addons()))[0].name,'Complemento Sintético');
  const saved = await page.evaluate(() => window.cine.onlineSaved()); assert.equal(saved[0].personal.rating,8.5); assert.equal(saved[0].personal.watchlist,true);
  assert.equal(saved[0].description,'Uma sinopse em português, mantendo o nome do catálogo.'); assert.equal(saved[0].name,'Filme Sintético');
  await page.getByRole('button',{ name: 'Complementos',exact: true }).first().click();
  for (const [endpoint,name] of [['second/manifest.json','Fonte Alternativa'],['opds','Livros Sintéticos'],['audio-catalog','Audiobooks Sintéticos']]) {
    await page.getByLabel('Link de instalação do complemento').fill(`http://127.0.0.1:${port}/${endpoint}`);
    await page.getByRole('button',{ name: 'Adicionar complemento',exact: true }).click();
    await page.getByRole('heading',{ name,exact: true }).waitFor();
  }
  const alternate = (await page.evaluate(() => window.cine.addons())).find(a => a.name === 'Fonte Alternativa')!;
  await page.getByRole('button',{ name: 'Explorar',exact: true }).click();
  await page.getByLabel('Buscar no catálogo online').fill('Sintético');
  await until(async () => await page.getByRole('button',{ name: 'Ver título online Filme Sintético',exact: true }).count() === 2);
  await page.getByLabel('Fontes do catálogo').selectOption(alternate.id);
  await until(async () => await page.getByRole('button',{ name: 'Ver título online Filme Sintético',exact: true }).count() === 1);
  await page.getByRole('button',{ name: 'Ver título online Filme Sintético',exact: true }).click();
  await until(async () => await page.locator('.source-card').count() === 2);
  await page.getByLabel('Fonte do título').selectOption(alternate.id);
  await until(async () => await page.locator('.source-card').count() === 1);
  assert.ok(await page.locator('.source-card').getByText('Fonte Alternativa',{ exact: true }).isVisible());
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'16-selecao-fontes.png') });
  await page.getByRole('dialog').getByRole('button',{ name: 'Fechar',exact: true }).click();
  await page.getByLabel('Buscar no catálogo online').fill('');
  await page.locator('main').getByRole('button',{ name: 'Livros',exact: true }).click();
  await page.getByLabel('Buscar no catálogo online').fill('Livro');
  await page.getByRole('button',{ name: 'Ver título online Livro Sintético',exact: true }).click();
  await page.getByRole('button',{ name: 'Baixar livro',exact: true }).waitFor();
  assert.ok(await page.getByText('Autora Sintética',{ exact: true }).isVisible());
  assert.equal(await page.getByText('Configure o TMDB em Configurações',{ exact: false }).count(),0);
  await page.getByRole('button',{ name: 'Minha lista online',exact: true }).last().click();
  await page.getByRole('button',{ name: 'Na minha lista online',exact: true }).waitFor();
  await page.getByRole('button',{ name: 'Baixar livro',exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'17-livros.png') });
  await page.getByRole('button',{ name: 'Baixar livro',exact: true }).click();
  await page.getByRole('heading',{ name: 'Downloads',exact: true }).waitFor();
  await until(async () => { const jobs = (await page.evaluate(() => window.cine.downloads())).jobs; return jobs.length === 4 && jobs.every(job => job.state === 'completed'); },20000);
  assert.equal(await readFile(path.join(root,'Livros','Livro Sintético (2026)','Livro Sintético (2026).pdf'),'utf8'),'%PDF-1.4\nLivro sintético');
  await runtime!.close(); runtime = undefined; page = await launch();
  const savedBook = (await page.evaluate(() => window.cine.onlineSaved())).find(item => item.type === 'book')!;
  assert.equal(savedBook.name,'Livro Sintético');
  const bookSources = await page.evaluate(item => window.cine.onlineSources(item.addonId,item.type,item.id,item.id),savedBook);
  assert.equal(bookSources.sources.length,1); assert.ok(!JSON.stringify(bookSources).includes('fake-book-key'));
  await page.getByRole('button',{ name: 'Explorar',exact: true }).click();
  await page.locator('main').getByRole('button',{ name: 'Audiobooks',exact: true }).click();
  await page.getByLabel('Buscar no catálogo online').fill('Audiobook');
  const audioProvider = (await page.evaluate(() => window.cine.addons())).find(addon => addon.name === 'Audiobooks Sintéticos')!;
  await page.getByLabel('Fontes do catálogo').selectOption(audioProvider.id);
  await page.getByRole('button',{ name: 'Ver título online Audiobook Sintético',exact: true }).click();
  await page.getByRole('button',{ name: 'Ouvir agora',exact: true }).waitFor();
  assert.ok(await page.getByText('Narração: Narradora Sintética',{ exact: true }).isVisible());
  await page.getByRole('button',{ name: 'Minha lista online',exact: true }).last().click();
  await page.getByRole('button',{ name: 'Na minha lista online',exact: true }).waitFor();
  await page.getByRole('button',{ name: 'Ouvir agora',exact: true }).click();
  await page.getByLabel('Audiobook em reprodução',{ exact: true }).waitFor();
  await until(async () => { const state = (await page.evaluate(() => window.cine.snapshot())).player; return state.mediaType === 'audio' && state.duration > 25 && !state.loading; },20000);
  await page.getByLabel('Velocidade',{ exact: true }).selectOption('1.5');
  await until(async () => (await page.evaluate(() => window.cine.snapshot())).player.speed === 1.5);
  await page.getByRole('button',{ name: 'Pausar',exact: true }).click();
  await until(async () => (await page.evaluate(() => window.cine.snapshot())).player.paused);
  assert.equal(await page.getByRole('button',{ name: 'Legendas',exact: true }).count(),0);
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.join(output,'18-audiobook-player.png') });
  await page.getByRole('button',{ name: 'Encerrar reprodução',exact: true }).click();
  await page.getByRole('button',{ name: 'Ver título online Audiobook Sintético',exact: true }).click();
  await page.getByRole('button',{ name: 'Baixar audiobook',exact: true }).click();
  await page.getByRole('heading',{ name: 'Downloads',exact: true }).waitFor();
  await until(async () => { const jobs = (await page.evaluate(() => window.cine.downloads())).jobs; return jobs.length === 5 && jobs.every(job => job.state === 'completed'); },20000);
  assert.deepEqual(await readFile(path.join(root,'Audiobooks','Audiobook Sintético (2026)','Audiobook Sintético (2026).m4b')),audioPayload);
  await runtime!.close(); runtime = undefined; page = await launch();
  const savedAudio = (await page.evaluate(() => window.cine.onlineSaved())).find(item => item.type === 'audiobook')!;
  assert.equal(savedAudio.name,'Audiobook Sintético');
  const audioSources = await page.evaluate(item => window.cine.onlineSources(item.addonId,item.type,item.id,item.id),savedAudio);
  assert.equal(audioSources.sources.length,1); assert.ok(!JSON.stringify(audioSources).includes('fake-audio-key'));
  assert.deepEqual(errors.filter(error => !error.includes('ERR_ABORTED')),[]);
  console.log('Online desktop OK: catálogo sem SSD, complemento pela interface, fontes reais HTTP, pasta escolhida, filme e temporada completa baixados, organização e importação automática, fila e avaliações persistentes; busca em todas/uma fonte, seletor de provedor, livros OPDS com download PDF; audiobook com player de áudio, velocidade, pausa, download M4B e reinício.');
} finally { await runtime?.close(); server.close(); server.closeAllConnections(); await rm(directory,{ recursive: true,force: true }); }
