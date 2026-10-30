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
import { RealDebrid } from '../src/online/realdebrid';

const hash = '0123456789abcdef0123456789abcdef01234567';
interface Fake { calls: string[]; torrents: Map<string,any>; premium: boolean; downloaded: boolean; files: { id: number; path: string; bytes: number }[] }
function fake(): { fetch: typeof fetch; state: Fake } {
  const state: Fake = { calls: [],torrents: new Map(),premium: true,downloaded: true,files: [{ id: 1,path: '/Livro/cover.jpg',bytes: 10 },{ id: 2,path: '/Livro/Cap 10.mp3',bytes: 3_000_000 },{ id: 3,path: '/Livro/Cap 2.mp3',bytes: 2_000_000 }] };
  const respond = (body: unknown,status = 200) => new Response(status === 204 ? null : JSON.stringify(body),{ status });
  const handler = async (input: any,init: any = {}) => {
    const url = new URL(String(input)); const route = `${init.method ?? 'GET'} ${url.pathname.replace('/rest/1.0','')}`; state.calls.push(route);
    if (url.hostname !== 'api.real-debrid.com') return fetch(input,init);
    if (init.headers?.authorization !== 'Bearer chave-ok') return respond({ error: 'bad_token' },401);
    const form = new URLSearchParams(String(init.body ?? ''));
    if (route === 'GET /user') return respond({ username: 'augusto',type: state.premium ? 'premium' : 'free' });
    if (route === 'GET /torrents') return respond([...state.torrents.values()].map(t => ({ id: t.id,hash: t.hash,status: t.status })));
    if (route === 'POST /torrents/addMagnet') { assert.match(form.get('magnet')!,new RegExp(`btih:${hash}`)); state.torrents.set('T1',{ id: 'T1',hash,status: 'waiting_files_selection' }); return respond({ id: 'T1' },201); }
    if (route === 'POST /torrents/selectFiles/T1') { state.calls.push(`select ${form.get('files')}`); state.torrents.get('T1').status = state.downloaded ? 'downloaded' : 'downloading'; return respond(null,204); }
    if (route === 'GET /torrents/info/T1') { const t = state.torrents.get('T1'); const audio = state.files.filter(f => f.path.endsWith('.mp3')); return respond({ id: 'T1',status: t.status,progress: t.status === 'downloaded' ? 100 : 37,files: state.files.map(f => ({ ...f,selected: t.status === 'waiting_files_selection' ? 0 : Number(audio.includes(f)) })),links: audio.map(f => `https://real-debrid.com/d/${f.id}`) }); }
    if (route === 'POST /unrestrict/link') { const id = form.get('link')!.split('/').pop()!; const file = state.files.find(f => String(f.id) === id)!; return respond({ filename: file.path.split('/').pop(),filesize: file.bytes,download: `https://cdn.real-debrid.test/${id}/${encodeURIComponent(file.path.split('/').pop()!)}` }); }
    return respond({ error: 'unknown' },404);
  };
  return { fetch: handler as typeof fetch,state };
}

test('Real-Debrid prepara o torrent, escolhe só os áudios e devolve links diretos em ordem natural',async () => {
  const { fetch: request,state } = fake(); const debrid = new RealDebrid('chave-ok',request);
  assert.deepEqual(await debrid.user(),{ username: 'augusto',premium: true });
  const result = await debrid.resolve(hash.toUpperCase(),['udp://tracker.example.org:1337/announce']);
  assert.equal(result.state,'ready'); if (result.state !== 'ready') return;
  assert.deepEqual(result.files.map(f => f.name),['Cap 2.mp3','Cap 10.mp3']); assert.match(result.files[0].url,/^https:\/\/cdn\.real-debrid\.test\//);
  assert.ok(state.calls.includes('select 2,3'),'seleciona apenas os arquivos de áudio');
  state.calls.length = 0; await debrid.resolve(hash,[]); assert.ok(!state.calls.includes('POST /torrents/addMagnet'),'reaproveita o torrent que já está na conta');
});

test('Real-Debrid informa progresso quando ainda não terminou e rejeita chave inválida',async () => {
  const { fetch: request,state } = fake(); state.downloaded = false;
  const pending = await new RealDebrid('chave-ok',request).resolve(hash,[],10); assert.deepEqual(pending,{ state: 'pending',progress: 37,status: 'downloading' });
  await assert.rejects(new RealDebrid('errada',request).user(),/inválida/);
});

test('AudiobookBay usa o Real-Debrid quando há chave e cai no torrent quando ele falha',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-rd-')); const { fetch: request,state } = fake();
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' }); await credentials.saveDocument('addons',[]);
  const store = new OnlineStore(directory); const addons = new Addons(credentials,store,undefined,{ fetch: request,debridWait: 10 }); await addons.initialize();
  const server = createServer((req,response) => {
    response.setHeader('content-type','text/html'); const url = new URL(req.url!,'http://localhost');
    if (url.pathname === '/') response.end('<a href="/abss/livro/" rel="bookmark">Livro - Autor</a>');
    else if (url.pathname === '/abss/livro/') response.end(`<p>Format: MP3 Bitrate: 64 Kbps</p><table><tr><td>udp://tracker.example.org:1337/announce</td></tr><tr><td>Info Hash:</td><td>${hash}</td></tr><tr><td>File Size:</td><td><span>5</span> MBs</td></tr></table>`);
    else { response.statusCode = 404; response.end(); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    await addons.install(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const addon = addons.list().find(a => a.kind === 'abb')!; const [item] = await addons.catalog(addon.id,'latest','audiobook');
    const sem = await addons.sources(addon.id,'audiobook',item.id,item.id); assert.equal(sem.sources.length,1); assert.equal(sem.sources[0].transport,'torrent'); assert.match(sem.sources[0].description,/Real-Debrid/);
    await assert.rejects(addons.saveDebrid('errada'),/inválida/); assert.equal(addons.debrid().realDebrid,false);
    state.premium = false; await assert.rejects(addons.saveDebrid('chave-ok'),/premium/); state.premium = true;
    await addons.saveDebrid('chave-ok'); assert.deepEqual(addons.debrid(),{ realDebrid: true,username: 'augusto' });
    assert.deepEqual(await credentials.loadDocument('debrid'),{ realDebrid: 'chave-ok',username: 'augusto' });
    const com = await addons.sources(addon.id,'audiobook',item.id,item.id); assert.equal(com.errors.length,0);
    assert.deepEqual(com.sources.map(s => [s.name,s.part,s.format,s.transport,s.provider]),[['Cap 2.mp3',1,'mp3','http','Real-Debrid'],['Cap 10.mp3',2,'mp3','http','Real-Debrid']]);
    assert.deepEqual(com.sources[0].tags,['RD+','Parte 1 de 2','MP3','64 Kbps','2 MB']); assert.match(com.sources[0].description,/^Livro/);
    assert.match(addons.getStreamForSource(com.sources[0].id).raw.url!,/^https:\/\/cdn\.real-debrid\.test\//);
    state.torrents.clear(); state.downloaded = false; (addons as any).debridKey = 'chave-ok';
    const lento = await addons.sources(addon.id,'audiobook',item.id,item.id); assert.equal(lento.sources.length,1); assert.equal(lento.sources[0].transport,'torrent'); assert.match(lento.errors[0],/Real-Debrid.*37%/); assert.equal(lento.sources[0].tags![0],'RD 37%');
    await addons.saveDebrid(null); assert.equal(addons.debrid().realDebrid,false);
  } finally { addons.cancel(); server.close(); server.closeAllConnections(); store.close(); await rm(directory,{ recursive: true,force: true }); }
});
