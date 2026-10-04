import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Credentials } from '../src/storage/credentials';
import { OnlineStore } from '../src/storage/online';
import { Addons, sameSource, transportURL, type BoundSource } from '../src/online/addons';
import { Downloads, destination, safeName } from '../src/downloads/downloads';
import { library, until } from './helpers';
import { emptyPersonal } from '../src/storage/store';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(),'cine-addons-'));
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' });
  const store = new OnlineStore(directory),addons = new Addons(credentials,store); await addons.initialize();
  const requests: string[] = [];
  const server = createServer((request,response) => {
    requests.push(request.url!); const url = decodeURIComponent(request.url!);
    response.setHeader('content-type','application/json');
    if (url.endsWith('manifest.json')) response.end(JSON.stringify({ id: 'org.test.addon',name: 'Fonte de teste',description: 'Teste',types: ['movie','series'],resources: ['catalog','meta',{ name: 'stream',types: ['movie','series'],idPrefixes: ['test:'] }],catalogs: [{ type: 'movie',id: 'top',name: 'Filmes',extra: [{ name: 'search' },{ name: 'skip' }] },{ type: 'series',id: 'top' }] }));
    else if (url.includes('/catalog/')) response.end(JSON.stringify({ metas: [{ id: 'test:movie',type: 'movie',name: 'Filme de teste',poster: 'https://example.com/image.jpg',releaseInfo: '2026' }] }));
    else if (url.includes('/meta/')) response.end(JSON.stringify({ meta: { id: 'test:series',type: 'series',name: 'Série de teste',releaseInfo: '2026-',videos: [1,2,3].map(n => ({ id: `test:series:4:${n}`,title: `Episódio ${n}`,season: 4,episode: n })) } }));
    else response.end(JSON.stringify({ streams: [
      { name: '1080p',title: 'Arquivo\n⚙️ Provedor A',infoHash: 'a'.repeat(40),fileIdx: Number(url.split(':').at(-1)?.replace('.json','')) || 0,behaviorHints: { filename: 'Série.S04E01-GROUP.mkv' } },
      { name: url.includes(':4:3') ? '720p' : '1080p',title: 'Arquivo\n⚙️ Provedor B',url: 'https://example.com/stream.mp4?apiKey=test-secret',behaviorHints: { filename: 'Série.S04E01-OTHER.mkv' } },
      { name: 'Inseguro',url: 'file:///etc/passwd' }
    ].filter((_,index) => !url.includes(':4:3') || index !== 0) }));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as { port: number }).port;
  await addons.install(`http://127.0.0.1:${port}/configuration-test-secret/manifest.json`);
  return { directory,credentials,store,addons,requests,server,addonId: addons.list().find(a => a.name === 'Fonte de teste')!.id,close: async () => { addons.cancel(); server.close(); server.closeAllConnections(); store.close(); await rm(directory,{ recursive: true,force: true }); } };
}

test('complementos persistem privados; protocolo preserva configuração, busca e filtros de recursos',async () => {
  const f = await fixture();
  try {
    const items = await f.addons.catalog(f.addonId,'top','movie','ação & aventura',100);
    assert.equal(items[0].name,'Filme de teste'); assert.match(items[0].poster!,/^cinessd:\/\/online-image\//);
    assert.ok(f.requests.some(url => url.includes('/configuration-test-secret/catalog/movie/top/search=') && url.includes('skip=100')));
    assert.ok(!JSON.stringify(f.addons.list()).includes('test-secret')); assert.ok(!(await readFile(path.join(f.directory,'credentials','addons.json'),'utf8')).includes('test-secret'));
    await f.addons.meta(f.addonId,'series','test:series');
    const sources = await f.addons.sources(f.addonId,'series','test:series','test:series:4:1');
    assert.equal(sources.sources.length,2); assert.ok(!JSON.stringify(sources).includes('test-secret')); assert.equal(sources.sources[0].transport,'torrent');
    const restarted = new Addons(new Credentials(f.directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' }),f.store); await restarted.initialize();
    assert.equal(restarted.list().find(a => a.id === f.addonId)?.enabled,true);
    await restarted.change('disable',f.addonId);
    assert.equal((await restarted.sources(f.addonId,'series','test:series','test:series:4:1')).sources.length,0);
    assert.equal(transportURL('stremio://example.org/config/manifest.json').protocol,'https:');
    for (const url of ['file:///etc/passwd','javascript:alert(1)','https://user:password@example.org/manifest.json']) assert.throws(() => transportURL(url));
  } finally { await f.close(); }
});
test('temporada mantém a fonte escolhida e deixa episódios sem correspondência para revisão',async () => {
  const f = await fixture();
  try {
    const series = await f.addons.meta(f.addonId,'series','test:series');
    f.store.personal(series.type,series.id,{ ...series.personal,rating: 9,watchlist: true });
    const result = await f.addons.sources(f.addonId,'series',series.id,series.videos[0].id);
    const chosen = result.sources.find(s => s.provider === 'Provedor A')!;
    const plan = await f.addons.plan(f.addonId,series.id,4,chosen.id);
    assert.equal(plan.episodes.length,3); assert.ok(plan.episodes[0].selected); assert.ok(plan.episodes[1].selected); assert.equal(plan.episodes[2].selected,null);
    assert.ok(sameSource(chosen,plan.episodes[1].sources.find(s => s.id === plan.episodes[1].selected)!));
    assert.throws(() => f.addons.planSources(plan.id,{ [series.videos[2].id]: chosen.id }));
    assert.equal(f.addons.saved()[0].personal.rating,9);
    assert.equal(f.addons.planSources(plan.id,Object.fromEntries(plan.episodes.filter(e => e.selected).map(e => [e.video.id,e.selected!]))).length,2);
  } finally { await f.close(); }
});
test('nomes e pastas de download são portáteis e ficam dentro da raiz',() => {
  assert.equal(safeName('../../Série: Exemplo?'),'Série Exemplo');
  assert.ok(!safeName('CON').match(/^CON$/));
  const item = { id: 'test:series',addonId: randomUUID(),type: 'series' as const,name: 'Série / Exemplo',year: '2022-',description: '',genres: [],imdbRating: null,videos: [],personal: emptyPersonal() };
  const result = destination(item,{ id: 'episode',title: '',season: 4,episode: 2 });
  assert.equal(result.relative,path.join('Series','Série Exemplo (2022)','Temporada 04')); assert.equal(result.prefix,'Série Exemplo (2022) - S04E02');
});
test('temporadas longas mantêm as fontes revisadas mesmo depois de expirar o cache de buscas',async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  try {
    const series = await f.addons.meta(f.addonId,'series','test:series');
    const chosen = (await f.addons.sources(f.addonId,'series',series.id,series.videos[0].id)).sources.find(s => s.provider === 'Provedor A')!;
    f.store.cache({ ...series,videos: Array.from({ length: 50 },(_,i) => ({ id: `test:series:4:${i+1}`,title: '',season: 4,episode: i+1 })) });
    globalThis.fetch = async () => new Response(JSON.stringify({ streams: Array.from({ length: 250 },(_,i) => ({ name: i === 0 ? '1080p' : `Qualidade ${i}`,title: 'Arquivo\n⚙️ Provedor A',infoHash: 'a'.repeat(40),fileIdx: i,behaviorHints: { filename: 'Série-GROUP.mkv' } })) }));
    const plan = await f.addons.plan(f.addonId,series.id,4,chosen.id);
    assert.equal(plan.episodes.length,50); assert.ok(plan.episodes.every(entry => entry.selected));
    assert.equal(f.addons.planSources(plan.id,Object.fromEntries(plan.episodes.map(entry => [entry.video.id,entry.selected!]))).length,50);
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
test('download HTTP real pausa, retoma por Range, persiste a fila e não sobrescreve arquivos',async () => {
  const { root,store } = await library(); const directory = await mkdtemp(path.join(tmpdir(),'cine-downloads-'));
  const payload = Buffer.alloc(2*1024*1024,42); const ranges: string[] = [];
  const server = createServer((request,response) => {
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0); if (request.headers.range) ranges.push(request.headers.range);
    response.statusCode = offset ? 206 : 200; response.setHeader('content-type','video/mp4'); response.setHeader('content-length',payload.length-offset);
    if (offset) response.setHeader('content-range',`bytes ${offset}-${payload.length-1}/${payload.length}`);
    let position = offset; const timer = setInterval(() => { const end = Math.min(position+32768,payload.length); response.write(payload.subarray(position,end)); position = end; if (position >= payload.length) { clearInterval(timer); response.end(); } },20); response.on('close',() => clearInterval(timer));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const port = (server.address() as { port: number }).port;
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' });
  const worker = path.resolve('src/downloads/torrent-worker.py'); const downloads = new Downloads(credentials,worker,() => {},() => {}); await downloads.initialize();
  const source: BoundSource = { summary: { id: randomUUID(),addonId: randomUUID(),addonName: 'Teste',name: '1080p',description: '',transport: 'http',provider: '',releaseGroup: '' },raw: { url: `http://127.0.0.1:${port}/movie.mp4?key=test-secret` },item: { id: 'test:movie',addonId: randomUUID(),type: 'movie',name: 'Filme de teste',year: '2026',description: '',genres: [],imdbRating: null,videos: [],personal: emptyPersonal() } };
  try {
    await downloads.enqueue([source],root,store.manifest.id);
    await until(() => downloads.list()[0].downloaded > 65536,10000); const id = downloads.list()[0].id;
    await downloads.control('pause',id); assert.equal(downloads.list()[0].state,'paused');
    assert.throws(() => downloads.assertNoPendingWork(root,'Filme de teste',undefined,[],false),/Cancele/);
    assert.doesNotThrow(() => downloads.assertNoPendingWork(root,'Título diferente',undefined,[],false));
    assert.ok(!(await readFile(path.join(directory,'credentials','downloads.json'),'utf8')).includes('test-secret'));
    await downloads.close();
    const reopened = new Downloads(credentials,worker,() => {},() => {}); await reopened.initialize();
    try {
      assert.equal(reopened.list()[0].state,'paused'); await reopened.control('resume',id);
      await until(() => reopened.list()[0].state === 'completed' || reopened.list()[0].state === 'error',10000);
      assert.equal(reopened.list()[0].state,'completed',reopened.list()[0].error);
      const job = reopened.list()[0]; assert.deepEqual(await readFile(path.join(job.directory,job.fileName)),payload); assert.ok(ranges.length >= 1);
      await assert.rejects(reopened.enqueue([source],root,store.manifest.id),/já está na fila/);
      const other = { ...source,item: { ...source.item,name: 'Outro filme' } }; const target = destination(other.item,undefined); await mkdir(path.join(root,target.relative),{ recursive: true }); await writeFile(path.join(root,target.relative,`${target.prefix}.mp4`),'original');
      await reopened.enqueue([other],root,store.manifest.id); await until(() => reopened.list()[0].state === 'error',10000); assert.equal(await readFile(path.join(root,target.relative,`${target.prefix}.mp4`),'utf8'),'original');
      const outside = path.join(directory,'outside'); await mkdir(outside); await symlink(outside,path.join(root,'Filmes','Link (2026)'));
      await reopened.enqueue([{ ...source,item: { ...source.item,name: 'Link' } }],root,store.manifest.id); await until(() => reopened.list()[0].state === 'error',10000); assert.deepEqual(await readdir(outside),[]);
      assert.doesNotThrow(() => reopened.assertNoPendingWork(root,'Filme de teste',undefined,[],false));
      await rm(path.join(job.directory,job.fileName));
      await reopened.forgetRemovedFiles(root,[path.relative(root,path.join(job.directory,job.fileName))]);
      assert.ok(!reopened.list().some(entry => entry.id === id));
      await reopened.enqueue([source],root,store.manifest.id);
      await until(() => reopened.list()[0].state === 'completed' || reopened.list()[0].state === 'error',10000);
      assert.equal(reopened.list()[0].state,'completed',reopened.list()[0].error);
    } finally { await reopened.close(); }
  } finally { await downloads.close(); server.close(); server.closeAllConnections(); await store.close(); await rm(root,{ recursive: true,force: true }); await rm(directory,{ recursive: true,force: true }); }
});
test('motor torrent real pausa, retoma e baixa só o episódio solicitado de um pacote',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'cine-torrent-')); const seed = path.join(directory,'seed'),destination = path.join(directory,'destination'); await mkdir(seed); await mkdir(destination);
  await mkdir(path.join(seed,'pack'));
  const first = Buffer.alloc(128*1024,1),second = Buffer.alloc(64*1024,2); await writeFile(path.join(seed,'pack','Show.S01E01.mkv'),first); await writeFile(path.join(seed,'pack','Show.S01E02.mkv'),second);
  const script = path.join(directory,'seed.py');
  await writeFile(script,`import sys,json,time,libtorrent as lt\nroot=sys.argv[1]\nfiles=lt.file_storage()\nfiles.add_file('pack/Show.S01E01.mkv',128*1024)\nfiles.add_file('pack/Show.S01E02.mkv',64*1024)\nt=lt.create_torrent(files,16384,lt.create_torrent.v1_only)\nlt.set_piece_hashes(t,root)\nti=lt.torrent_info(t.generate())\ns=lt.session({'listen_interfaces':'127.0.0.1:0','enable_dht':False,'enable_lsd':False,'enable_upnp':False,'enable_natpmp':False,'allow_multiple_connections_per_ip':True})\np=lt.add_torrent_params()\np.ti=ti\np.save_path=root\np.flags|=lt.torrent_flags.seed_mode\np.flags&=~lt.torrent_flags.paused\nh=s.add_torrent(p)\nwhile not s.listen_port(): time.sleep(.05)\nprint(json.dumps({'hash':str(ti.info_hashes().v1),'port':s.listen_port()}),flush=True)\nimport threading\nstop=threading.Event()\ndef watch():\n sys.stdin.readline()\n stop.set()\nthreading.Thread(target=watch,daemon=True).start()\nwhile not stop.wait(.5):\n st=h.status()\n print(json.dumps({'seedState':int(st.state),'seedFlags':int(h.flags()),'seedPeers':st.num_peers}),file=sys.stderr,flush=True)\n`);
  const seeder = spawn('/usr/bin/python',['-u',script,seed],{ stdio: ['pipe','pipe','pipe'] }); let seedOutput = '',seedError = ''; seeder.stdout.on('data',data => { seedOutput += data; }); seeder.stderr.on('data',data => { seedError += data; });
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    await until(() => seedOutput.includes('\n') || seeder.exitCode !== null,10000); assert.equal(seeder.exitCode,null,seedError);
    const info = JSON.parse(seedOutput.trim());
    const job = { id: randomUUID(),directory: destination,filePrefix: 'Show - S01E02',magnet: `magnet:?xt=urn:btih:${info.hash}`,season: 1,episode: 2,peers: [['127.0.0.1',info.port]] };
    worker = spawn('/usr/bin/python',['-u',path.resolve('src/downloads/torrent-worker.py')],{ stdio: ['pipe','pipe','pipe'] });
    const pausedEvents: any[] = []; let pausedBuffer = '';
    worker.stdout!.on('data',data => {
      pausedBuffer += data; let i: number;
      while ((i = pausedBuffer.indexOf('\n')) >= 0) {
        const event = JSON.parse(pausedBuffer.slice(0,i)); pausedBuffer = pausedBuffer.slice(i+1); pausedEvents.push(event);
        if (event.event === 'file') worker!.stdin!.write('{"action":"stop"}\n');
      }
    });
    worker.stdin!.write(`${JSON.stringify(job)}\n`);
    await until(() => pausedEvents.some(e => e.event === 'stopped' || e.event === 'error') || worker!.exitCode !== null,15000);
    assert.ok(pausedEvents.some(e => e.event === 'stopped'),JSON.stringify(pausedEvents)); const resume = pausedEvents.filter(e => e.event === 'resume').at(-1)?.data; assert.ok(resume);
    if (worker.exitCode === null) await once(worker,'exit');
    assert.equal(worker.exitCode,0);
    worker = spawn('/usr/bin/python',['-u',path.resolve('src/downloads/torrent-worker.py')],{ stdio: ['pipe','pipe','pipe'] });
    const events: any[] = []; let buffer = '',error = ''; worker.stdout!.on('data',data => { buffer += data; let i: number; while ((i = buffer.indexOf('\n')) >= 0) { events.push(JSON.parse(buffer.slice(0,i))); buffer = buffer.slice(i+1); } }); worker.stderr!.on('data',data => { error += data; });
    worker.stdin!.write(`${JSON.stringify({ ...job,resume })}\n`);
    try { await until(() => events.some(e => e.event === 'complete' || e.event === 'error') || worker!.exitCode !== null,25000); }
    catch { assert.fail(JSON.stringify(events.map(({ data,...event }) => event).slice(-12))+error+seedError.slice(-2500)); }
    assert.ok(events.some(e => e.event === 'complete'),`${JSON.stringify(events.map(({ data,...event }) => event))} ${error}`);
    assert.deepEqual(await readFile(path.join(destination,'Show - S01E02.mkv')),second); assert.deepEqual((await readdir(destination,{ recursive: true })).filter(file => file.endsWith('.mkv')),['Show - S01E02.mkv']); assert.ok(events.some(e => e.event === 'resume'));
  } finally { worker?.kill(); seeder.kill(); await rm(directory,{ recursive: true,force: true }); }
});
