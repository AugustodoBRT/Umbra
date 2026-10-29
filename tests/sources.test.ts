import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Addons } from '../src/online/addons';
import { Credentials } from '../src/storage/credentials';
import { OnlineStore } from '../src/storage/online';
import { parseOPDS, searchURL, parseXML, audioManifest } from '../src/online/opds';
import { TorrentStreamer } from '../src/downloads/streamer';
import { Downloads } from '../src/downloads/downloads';
import { library, until } from './helpers';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-sources-'));
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' });
  await credentials.saveDocument('addons',[]);
  const store = new OnlineStore(directory),addons = new Addons(credentials,store); await addons.initialize();
  const requests: string[] = [];
  const server = createServer((request,response) => {
    requests.push(request.url!); const url = new URL(request.url!,'http://localhost');
    response.setHeader('content-type','application/json');
    const source = url.pathname.split('/')[1];
    if (url.pathname === '/audio.m4b') { response.setHeader('content-type','audio/mp4'); response.end('synthetic-audiobook'); return; }
    if (url.pathname === '/audio') { response.end(JSON.stringify({ metadata: { title: 'Fonte de Audiobooks' },links: [{ rel: 'search',href: '/audio{?query}',type: 'application/opds+json' }],publications: [{ metadata: { '@type': 'http://schema.org/Audiobook',identifier: 'urn:audio:1',title: 'Audiobook de teste',author: 'Autora',narrator: [{ name: 'Narradora' }],published: '2026-01-01' },links: [{ rel: 'download',href: '/audio.m4b?key=private-audio-key',type: 'audio/mp4' },{ rel: 'borrow',href: '/borrow',type: 'text/html' }] },{ metadata: { '@type': 'http://schema.org/Audiobook',identifier: 'urn:audio:2',title: 'Obra em capítulos' },links: [{ rel: 'acquisition',href: '/audio-manifest',type: 'application/audiobook+json' }] }] })); return; }
    if (url.pathname === '/audio-manifest') { response.end(JSON.stringify({ readingOrder: [{ title: 'Capítulo 1',href: '/audio.m4b?part=1',type: 'audio/mp4' },{ title: 'Capítulo 2',href: '/audio.m4b?part=2',type: 'audio/mp4' }] })); return; }
    if (url.pathname === '/file.pdf') { response.setHeader('content-type','application/pdf'); response.end('%PDF-1.4\nSynthetic book.'); return; }
    if (url.pathname === '/xml') { response.setHeader('content-type','application/atom+xml'); response.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Livraria XML</title><id>books</id><link rel="search" type="application/opensearchdescription+xml" href="/opensearch"/><entry><id>urn:isbn:123</id><title>Livro XML</title><author><name>Autora XML</name></author><summary>&lt;b&gt;Sinopse&lt;/b&gt;</summary><link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/file.epub?key=private-book-key"/></entry></feed>`); return; }
    if (url.pathname === '/opensearch') { response.end('<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><Url type="application/atom+xml" template="/xml?q={searchTerms}&amp;count={count?}"/></OpenSearchDescription>'); return; }
    if (url.pathname === '/opds') { response.end(JSON.stringify({ metadata: { title: 'Livraria JSON' },links: [{ rel: 'search',href: '/opds{?query,title,author}',type: 'application/opds+json',templated: true }],publications: [{ metadata: { title: 'Livro JSON',identifier: 'urn:isbn:456',author: [{ name: 'Autora JSON' }],description: '<p>Um livro</p>',published: '2026-01-01' },links: [{ rel: 'download',href: '/file.pdf?key=private-book-key',type: 'application/pdf' },{ rel: 'borrow',href: '/borrow',type: 'text/html' },{ rel: 'download',href: 'file:///etc/passwd',type: 'application/pdf' }] }] })); return; }
    if (url.pathname.endsWith('/manifest.json') && ['a','b','broken','nosearch','audio-addon'].includes(source)) {
      response.end(JSON.stringify({ id: `test.${source}`,name: source,description: '',types: ['movie','series','book','audiobook'],idPrefixes: ['wrong-prefix'],resources: ['catalog',{ name: 'stream',types: ['movie','series','book','audiobook'] }],catalogs: [{ id: 'top',type: 'movie',extra: source === 'nosearch' ? [] : [{ name: 'search' }] },{ id: 'again',type: 'movie',extra: [{ name: 'search' }] },{ id: 'books',type: 'book',extra: [{ name: 'search' }] },{ id: 'audio',type: 'audiobook',extra: [{ name: 'search' }] }] })); return;
    }
    if (url.pathname.includes('/catalog/')) {
      if (source === 'broken') { response.statusCode = 503; response.end('{}'); return; }
      const type = url.pathname.includes('/audiobook/') ? 'audiobook' : url.pathname.includes('/book/') ? 'book' : 'movie';
      response.end(JSON.stringify({ metas: [{ id: type === 'book' ? 'book:shared' : 'tt123',type,name: `${source} título` },{ id: type === 'book' ? 'book:shared' : 'tt123',type,name: `${source} título` }] })); return;
    }
    if (url.pathname.includes('/stream/')) { response.end(JSON.stringify({ streams: [{ name: source,url: 'https://example.org/file.mp4' }] })); return; }
    response.statusCode = 404; response.end('{}');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const install = async (name: string) => { await addons.install(`${base}/${name}`); return addons.list().find(a => a.name === name)!.id; };
  return { directory,credentials,store,addons,requests,base,install,close: async () => { addons.cancel(); server.close(); server.closeAllConnections(); store.close(); await rm(directory,{ recursive: true,force: true }); } };
}

test('link base detecta Stremio; busca em todas ou uma fonte preserva resultados parciais e capacidades',async () => {
  const f = await fixture();
  try {
    const a = await f.install('a'), b = await f.install('b'); await f.install('broken'); await f.install('nosearch');
    const result = await f.addons.search('movie','ação & aventura');
    assert.equal(result.items.length,3); assert.equal(result.errors.length,2); assert.equal(result.skipped,1);
    assert.ok(f.requests.some(url => url.includes('search=a%C3%A7%C3%A3o+%26+aventura')));
    assert.equal((await f.addons.search('movie','teste',b)).items.length,1);
    assert.equal((await f.addons.search('movie','teste',b)).items[0].addonId,b);
    const all = await f.addons.sources(a,'movie','tt123','tt123'); assert.equal(all.sources.length,4);
    // Object-form resources do not inherit the manifest's global idPrefixes.
    assert.equal((await f.addons.sources(a,'movie','tt123','tt123',b)).sources.length,1);
    await f.addons.change('disable',b);
    assert.equal((await f.addons.sources(a,'movie','tt123','tt123',b)).sources.length,0);
    await assert.rejects(f.addons.search('movie','teste','00000000-0000-4000-8000-000000000000'),/não encontrado/);
    assert.equal((await f.addons.search('book','livro',a)).items[0].type,'book');
    await assert.rejects(f.addons.install(`${f.base}/unknown`),/Não foi possível identificar/);
  } finally { await f.close(); }
});

test('OPDS JSON e Atom/OpenSearch identificam livros, protegem links e preservam acesso ao reiniciar',async () => {
  const f = await fixture();
  try {
    await f.addons.install(`${f.base}/opds`); await f.addons.install(`${f.base}/xml`);
    assert.equal(f.addons.list().filter(a => a.kind === 'opds').length,2);
    const result = await f.addons.search('book','Dom Casmurro & livros');
    assert.equal(result.errors.length,0,JSON.stringify(result.errors)); assert.equal(result.items.length,2);
    assert.ok(f.requests.some(url => url.includes('q=Dom%20Casmurro%20%26%20livros')));
    const book = result.items.find(item => item.name === 'Livro JSON')!;
    assert.deepEqual(book.authors,['Autora JSON']); assert.equal(book.description,'Um livro');
    const sources = await f.addons.sources(book.addonId,'book',book.id,book.id);
    assert.equal(sources.sources.length,2); assert.equal(sources.sources.filter(s => s.external).length,1);
    assert.ok(!JSON.stringify(sources).includes('private-book-key')); assert.ok(!JSON.stringify(result).includes('private-book-key'));
    assert.ok(!(await readFile(path.join(f.directory,'credentials','book-links.json'),'utf8')).includes('private-book-key'));
    f.store.personal('book',book.id,{ ...book.personal,watchlist: true });
    const restarted = new Addons(f.credentials,f.store); await restarted.initialize();
    const saved = restarted.saved()[0]; assert.equal(saved.type,'book');
    assert.equal((await restarted.sources(saved.addonId,'book',saved.id,saved.id)).sources.length,2);
    assert.equal((await restarted.meta(saved.addonId,'book',saved.id)).name,'Livro JSON');
    await restarted.change('disable',book.addonId); assert.equal((await restarted.sources(book.addonId,'book',book.id,book.id)).sources.length,0);
  } finally { await f.close(); }
});

test('livro HTTP usa a fila de downloads e mantém formato PDF na pasta Livros',async () => {
  const f = await fixture(); const local = await library();
  const downloads = new Downloads(f.credentials,path.resolve('src/downloads/torrent-worker.py'),() => {},() => {});
  try {
    await f.addons.install(`${f.base}/opds`); const book = (await f.addons.search('book','livro')).items[0];
    const sources = await f.addons.sources(book.addonId,'book',book.id,book.id);
    await downloads.initialize(); await downloads.enqueue([f.addons.source(sources.sources.find(s => !s.external)!.id)],local.root,local.store.manifest.id);
    await until(() => ['completed','error'].includes(downloads.list()[0]?.state),10000);
    const job = downloads.list()[0]; assert.equal(job.state,'completed',job.error); assert.equal(job.fileName,'Livro JSON (2026).pdf');
    assert.equal(await readFile(path.join(local.root,'Livros','Livro JSON (2026)',job.fileName),'utf8'),'%PDF-1.4\nSynthetic book.');
  } finally { await downloads.close(); await local.store.close(); await rm(local.root,{ recursive: true,force: true }); await f.close(); }
});

test('OPDS rejeita XML com entidades e links inseguros; resolve navegação e modelos relativos',() => {
  assert.throws(() => parseXML('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed>&x;</feed>'),/inválido/);
  assert.throws(() => parseXML('<feed><title>x</feed>'),/inválido/);
  const feed = parseOPDS(JSON.stringify({ metadata: { title: 'Livros' },navigation: [{ title: 'Novos',href: '/new',type: 'application/opds+json' }] }),'https://example.org/opds');
  assert.equal(feed.navigation[0].url,'https://example.org/new');
  assert.equal(searchURL('https://example.org/search%7B?query,title,author%7D','ação & paz'),'https://example.org/search?query=a%C3%A7%C3%A3o%20%26%20paz');
  assert.equal(searchURL('https://example.org/search?q=%7BsearchTerms%7D&count=%7Bcount?%7D','ação & paz'),'https://example.org/search?q=a%C3%A7%C3%A3o%20%26%20paz&count=100');
});


for (const kind of ['book','audiobook'] as const) test(`torrent de ${kind} seleciona a mídia correta em pacote com vídeo`,async () => {
  const extension = kind === 'book' ? 'epub' : 'mp3';
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-book-torrent-'));
  const seed = path.join(directory,'seed'),target = path.join(directory,'target'); await mkdir(seed); await mkdir(path.join(seed,'pack')); await mkdir(target);
  const payload = Buffer.alloc(64*1024,23);
  await writeFile(path.join(seed,'pack',`book.${extension}`),payload); await writeFile(path.join(seed,'pack','preview.mp4'),Buffer.alloc(128*1024,42));
  const script = path.join(directory,'seed.py');
  await writeFile(script,`import sys,json,time,libtorrent as lt
root=sys.argv[1]
files=lt.file_storage()
files.add_file('pack/book.${extension}',65536)
files.add_file('pack/preview.mp4',131072)
t=lt.create_torrent(files,16384,lt.create_torrent.v1_only)
lt.set_piece_hashes(t,root)
ti=lt.torrent_info(t.generate())
s=lt.session({'listen_interfaces':'127.0.0.1:0','enable_dht':False,'enable_lsd':False,'enable_upnp':False,'enable_natpmp':False,'allow_multiple_connections_per_ip':True})
p=lt.add_torrent_params()
p.ti=ti
p.save_path=root
p.flags|=lt.torrent_flags.seed_mode
p.flags&=~lt.torrent_flags.paused
h=s.add_torrent(p)
while not s.listen_port(): time.sleep(.05)
print(json.dumps({'hash':str(ti.info_hashes().v1),'port':s.listen_port()}),flush=True)
while True: time.sleep(.2)
`);
  const seeder = spawn('/usr/bin/python',['-u',script,seed]); let output = '',seedError = '';
  seeder.stdout.on('data',chunk => output += chunk); seeder.stderr.on('data',chunk => seedError += chunk);
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    await until(() => output.includes('\n') || seeder.exitCode !== null,10000); assert.equal(seeder.exitCode,null,seedError);
    const info = JSON.parse(output.trim()); const events: any[] = []; let buffer = '';
    worker = spawn('/usr/bin/python',['-u',path.resolve('src/downloads/torrent-worker.py')]);
    worker.stdout!.on('data',chunk => { buffer += chunk; let index: number; while ((index = buffer.indexOf('\n')) >= 0) { events.push(JSON.parse(buffer.slice(0,index))); buffer = buffer.slice(index+1); } });
    worker.stdin!.write(JSON.stringify({ id: 'synthetic-book',directory: target,filePrefix: 'Livro',book: kind === 'book',audiobook: kind === 'audiobook',magnet: `magnet:?xt=urn:btih:${info.hash}`,peers: [['127.0.0.1',info.port]] })+'\n');
    await until(() => events.some(event => ['complete','error'].includes(event.event)) || worker!.exitCode !== null,25000);
    assert.ok(events.some(event => event.event === 'complete'),JSON.stringify(events.map(({ data,...event }) => event)));
    assert.deepEqual(await readFile(path.join(target,`Livro.${extension}`)),payload);
    assert.deepEqual((await readdir(target)).filter(name => !name.startsWith('.')),[`Livro.${extension}`]);
    if (kind === 'audiobook') {
      const streamer = new TorrentStreamer({ workerPath: path.resolve('src/downloads/torrent-worker.py'),pythonPath: '/usr/bin/python' });
      try {
        const stream = await streamer.startStream({ infoHash: info.hash,audiobook: true,sources: [`peer:127.0.0.1:${info.port}`] });
        assert.equal(stream.fileName,`book.${extension}`);
        const response = await fetch(stream.url,{ headers: { Range: 'bytes=0-1023' } });
        assert.equal(response.status,206); assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload.subarray(0,1024));
      } finally { await streamer.stopStream(); }
    }
  } finally { worker?.kill(); seeder.kill(); await rm(directory,{ recursive: true,force: true }); }
});


test('audiobooks OPDS ficam separados de livros, expandem capítulos e recuperam fontes ao reiniciar',async () => {
  const f = await fixture();
  try {
    await f.addons.install(`${f.base}/audio`);
    const provider = f.addons.list()[0]; assert.ok(provider.types.includes('audiobook'));
    assert.equal((await f.addons.search('book','teste')).items.length,0);
    const result = await f.addons.search('audiobook','teste'); assert.equal(result.items.length,2);
    const audio = result.items.find(item => item.name === 'Audiobook de teste')!;
    assert.deepEqual(audio.narrators,['Narradora']); assert.deepEqual(audio.authors,['Autora']);
    const sources = await f.addons.sources(audio.addonId,audio.type,audio.id,audio.id,provider.id);
    assert.equal(sources.sources.length,2); assert.equal(sources.sources.find(source => !source.external)?.format,'m4b');
    assert.ok(!JSON.stringify(sources).includes('private-audio-key'));
    f.store.personal(audio.type,audio.id,{ ...audio.personal,watchlist: true });
    const restarted = new Addons(f.credentials,f.store); await restarted.initialize();
    assert.equal(restarted.saved()[0].type,'audiobook');
    assert.equal((await restarted.sources(provider.id,audio.type,audio.id,audio.id)).sources.length,2);
    const chapters = result.items.find(item => item.name === 'Obra em capítulos')!;
    const options = await f.addons.sources(provider.id,chapters.type,chapters.id,chapters.id);
    assert.deepEqual(options.sources.map(source => [source.name,source.part]),[['Capítulo 1',1],['Capítulo 2',2]]);
    const addon = await f.install('audio-addon');
    assert.equal((await f.addons.search('audiobook','teste',addon)).items[0].type,'audiobook');
  } finally { await f.close(); }
});

test('downloads de audiobook preservam M4B e separam partes na mesma pasta',async () => {
  const f = await fixture(); const local = await library();
  const downloads = new Downloads(f.credentials,path.resolve('src/downloads/torrent-worker.py'),() => {},() => {});
  try {
    await f.addons.install(`${f.base}/audio`); const result = await f.addons.search('audiobook','teste');
    const audio = result.items.find(item => item.name === 'Audiobook de teste')!;
    const direct = (await f.addons.sources(audio.addonId,audio.type,audio.id,audio.id)).sources.find(source => !source.external)!;
    const chapterBook = result.items.find(item => item.name === 'Obra em capítulos')!;
    const chapters = (await f.addons.sources(chapterBook.addonId,chapterBook.type,chapterBook.id,chapterBook.id)).sources;
    await downloads.initialize(); await downloads.enqueue([direct,...chapters].map(source => f.addons.source(source.id)),local.root,local.store.manifest.id);
    await until(() => downloads.list().every(job => ['completed','error'].includes(job.state)),10000);
    assert.ok(downloads.list().every(job => job.state === 'completed'),JSON.stringify(downloads.list()));
    assert.equal(await readFile(path.join(local.root,'Audiobooks','Audiobook de teste (2026)','Audiobook de teste (2026).m4b'),'utf8'),'synthetic-audiobook');
    assert.deepEqual((await readdir(path.join(local.root,'Audiobooks','Obra em capítulos'))).filter(name => !name.startsWith('.')).sort(),['Obra em capítulos - Parte 001.m4b','Obra em capítulos - Parte 002.m4b']);
  } finally { await downloads.close(); await local.store.close(); await rm(local.root,{ recursive: true,force: true }); await f.close(); }
});

test('OPDS identifica áudio XML e edições mistas; manifesto com DRM exige acesso na fonte',() => {
  const xml = parseOPDS('<feed xmlns="http://www.w3.org/2005/Atom"><title>Áudio</title><entry><id>audio:1</id><title>Livro falado</title><link rel="http://opds-spec.org/acquisition/open-access" type="audio/mpeg" href="/file.mp3"/></entry></feed>','https://example.org/opds');
  assert.equal(xml.books[0].type,'audiobook'); assert.equal(xml.books[0].links[0].format,'mp3');
  const mixed = parseOPDS(JSON.stringify({ metadata: { title: 'Edições' },publications: [{ metadata: { title: 'Obra',identifier: 'mixed' },links: [{ rel: 'download',href: '/book.epub',type: 'application/epub+zip' },{ rel: 'download',href: '/audio.mp3',type: 'audio/mpeg' }] }] }),'https://example.org/opds');
  assert.deepEqual(mixed.books.map(book => book.type),['book','audiobook']);
  assert.throws(() => audioManifest(JSON.stringify({ readingOrder: [{ href: '/protected.mp3',type: 'audio/mpeg',properties: { encrypted: { scheme: 'lcp' } } }] }),'https://example.org/'),/DRM/);
});

test('fontes OPDS antigas recebem catálogo de audiobooks sem perder livros ou identificadores',async () => {
  const f = await fixture();
  try {
    await f.addons.install(`${f.base}/audio`); const id = f.addons.list()[0].id;
    const legacy = await f.credentials.loadDocument('addons') as any[];
    legacy[0].manifest.types = ['book']; legacy[0].manifest.catalogs = legacy[0].manifest.catalogs.filter((catalog: any) => catalog.type === 'book');
    await f.credentials.saveDocument('addons',legacy);
    const restarted = new Addons(f.credentials,f.store); await restarted.initialize();
    assert.equal(restarted.list()[0].id,id); assert.deepEqual(restarted.list()[0].types,['book','audiobook']);
    assert.equal((await restarted.search('audiobook','teste')).items.length,2);
  } finally { await f.close(); }
});
