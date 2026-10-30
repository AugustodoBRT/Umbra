import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Addons } from '../src/online/addons';
import { Credentials } from '../src/storage/credentials';
import { OnlineStore } from '../src/storage/online';
import { parseAbbList, parseAbbDetail, splitAbbTitle, abbItemId, abbItemPath, abbDomain } from '../src/online/audiobookbay';

const hash = '0123456789abcdef0123456789abcdef01234567';
const list = (query = '') => `<div class="post"><div class="postTitle"><h2><a href="/abss/dune/" rel="bookmark">Dune &#8211; Frank Herbert [M4B]${query}</a></h2></div><div class="postContent"><img src="/covers/dune.jpg"></div></div>
<div class="post"><div class="postTitle"><h2><a href="/abss/the-hobbit/" rel="bookmark">The Hobbit - J. R. R. Tolkien</a></h2></div></div><a href="https://elsewhere.test/abss/x/" rel="bookmark">Fora</a>`;
const detail = `<p>Written by Judi Dench Format: M4B Bitrate: 64 Kbps Unabridged</p><table><tr><td>Announce URL:</td><td>udp://tracker.example.org:1337/announce</td></tr><tr><td>Info Hash:</td><td>${hash.toUpperCase()}</td></tr><tr><td>File Size:</td><td><span style='color:#00f;'>350.5</span> MBs</td></tr></table><a href="/x">udp://tracker.example.org:1337/announcehttp://glued.example.org/announce</a>`;

test('lê a lista e a página de detalhes do AudiobookBay',() => {
  const entries = parseAbbList(list(),'https://abb.test/');
  assert.deepEqual(entries.map(entry => [entry.path,entry.title]),[['/abss/dune/','Dune – Frank Herbert [M4B]'],['/abss/the-hobbit/','The Hobbit - J. R. R. Tolkien']]);
  assert.equal(entries[0].poster,'https://abb.test/covers/dune.jpg'); assert.equal(entries[1].poster,undefined);
  assert.deepEqual(splitAbbTitle(entries[0].title),{ name: 'Dune',authors: ['Frank Herbert'] });
  const info = parseAbbDetail(detail);
  assert.equal(info.infoHash,hash); assert.equal(info.format,'M4B'); assert.equal(info.bitrate,'64 Kbps'); assert.equal(info.size,Math.round(350.5*1024**2)); assert.deepEqual(info.trackers,['udp://tracker.example.org:1337/announce']);
  assert.throws(() => parseAbbDetail('<p>sem hash</p>'),/hash/);
  assert.equal(abbItemPath(abbItemId('/abss/dune/')),'/abss/dune/'); assert.throws(() => abbItemPath('abb:L2V0Yy9wYXNzd2Q'),/inválido/);
  assert.equal(abbDomain('audiobookbay.lu'),'https://audiobookbay.lu/'); assert.throws(() => abbDomain('localhost'),/AudiobookBay/);
});

test('instala o AudiobookBay, lista lançamentos, busca e devolve o torrent como fonte',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-abb-')); const requests: { url: string; agent?: string }[] = [];
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' }); await credentials.saveDocument('addons',[]);
  const store = new OnlineStore(directory); const addons = new Addons(credentials,store); await addons.initialize();
  const server = createServer((request,response) => {
    requests.push({ url: request.url!,agent: request.headers['user-agent'] }); const url = new URL(request.url!,'http://localhost'); response.setHeader('content-type','text/html');
    if (url.pathname === '/') response.end(list(url.searchParams.get('s') ? ' busca' : ''));
    else if (url.pathname === '/abss/dune/') response.end(detail);
    else { response.statusCode = 404; response.end('não encontrado'); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    await addons.install(base);
    const addon = addons.list().find(a => a.kind === 'abb')!; assert.equal(addon.name,'AudiobookBay'); assert.deepEqual(addon.types,['audiobook']);
    assert.equal(addon.catalogs[0].search,true); assert.equal(addon.catalogs[0].searchRequired,false);
    const latest = await addons.catalog(addon.id,'latest','audiobook'); assert.deepEqual(latest.map((entry: { name: string }) => entry.name),['Dune','The Hobbit']); assert.deepEqual(latest[0].authors,['Frank Herbert']);
    const found = await addons.search('audiobook','dune'); assert.equal(found.searched,1); assert.match(found.items[0].description,/busca/);
    assert.ok(requests.some(request => request.url === '/?s=dune')); assert.ok(requests.filter(request => request.url.startsWith('/?s=') || request.url.startsWith('/abss/')).every(request => /Mozilla/.test(request.agent ?? '')));
    const item = await addons.meta(addon.id,'audiobook',latest[0].id); assert.equal(item.name,'Dune');
    const result = await addons.sources(addon.id,'audiobook',latest[0].id,latest[0].id);
    assert.equal(result.errors.length,0); assert.equal(result.sources.length,1);
    const bound = addons.getStreamForSource(result.sources[0].id);
    assert.equal(bound.raw.infoHash,hash); assert.deepEqual(bound.raw.sources,['tracker:udp://tracker.example.org:1337/announce']);
    assert.equal(result.sources[0].transport,'torrent'); assert.equal(result.sources[0].format,'m4b'); assert.match(result.sources[0].name,/M4B · 64 Kbps · 351 MB/);
    await addons.install(`${base}abss/dune/`); assert.equal(addons.list().filter(a => a.kind === 'abb').length,1);
  } finally { addons.cancel(); server.close(); server.closeAllConnections(); store.close(); await rm(directory,{ recursive: true,force: true }); }
});
