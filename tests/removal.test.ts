import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Store } from '../src/storage/store';
import { identify } from '../src/library/identify';
import { Scanner } from '../src/library/scanner';
import { removeWork } from '../src/library/removal';
import { library, media } from './helpers';

async function video(store: Store,relative: string,content = randomUUID()) {
  const absolute = path.join(store.root,relative);
  await mkdir(path.dirname(absolute),{ recursive: true }); await writeFile(absolute,content);
  const value = await stat(absolute);
  const id = store.importFile({ path: relative,size: value.size,mtime: value.mtimeMs,fingerprint: content,duration: 100,width: 320,height: 180,videoCodec: 'mpeg4',tracks: [],available: true },identify(relative));
  return { id,absolute,content };
}
function complete(store: Store,id: string,position = 90) {
  const session = store.startSession(id); store.progress(id,session,position,100,position,true); return session;
}
function journal(store: Store,workId: string,state: 'preparing' | 'committed') {
  const job = { id: randomUUID(),workId,files: store.detail(workId).files.filter(file => file.available).map(file => ({ id: file.id,path: file.path,size: file.size,mtime: store.rows().find(row => row.id === file.id)!.mtime })) };
  store.db.prepare('INSERT INTO file_removals VALUES (?,?,?)').run(job.id,state,JSON.stringify(job)); return job;
}
async function stage(store: Store,job: ReturnType<typeof journal>,count = job.files.length) {
  const directory = path.join(store.directory,'.exclusoes',job.id); await mkdir(directory,{ recursive: true });
  for (const file of job.files.slice(0,count)) await rename(path.join(store.root,file.path),path.join(directory,file.id));
  return directory;
}

test('abaixo do limite: apaga só os vídeos e remove catálogo, listas e progresso sem histórico',async () => {
  const { root,store } = await library();
  try {
    const file = await video(store,'Filmes/Não concluído (2026).mp4');
    const work = store.works()[0]; store.setSetting('completedPercent',80); complete(store,file.id,79.9);
    store.savePersonal(work.id,{ ...work.personal,rating: 8,watchlist: true });
    store.list('create','Coleção'); store.list('add',store.lists()[0].id,work.id);
    const subtitle = path.join(root,'Filmes','Não concluído (2026).srt'); await writeFile(subtitle,'legenda');
    assert.equal(store.removalPreview(work.id).keepsHistory,false);
    assert.deepEqual(await removeWork(store,work.id),{ keptHistory: false,cleanupPending: false });
    await assert.rejects(stat(file.absolute),{ code: 'ENOENT' }); assert.equal(await readFile(subtitle,'utf8'),'legenda');
    assert.deepEqual(store.works(),[]); assert.deepEqual(store.history(),[]); assert.deepEqual(store.lists()[0].workIds,[]);
    for (const table of ['files','progress','sessions','personal','file_removals']) assert.equal((store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n,0);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('limite configurado e versões alternativas: assistido mantém capa, avaliação e sessões após reabrir',async () => {
  const { root,store } = await library(); let active = store;
  try {
    const a = await video(store,'Filmes/Assistido (2026).mp4'); const b = await video(store,'Filmes/Assistido (2026) 1080p.mp4');
    const work = store.works()[0]; store.setSetting('completedPercent',80); complete(store,a.id,80);
    assert.equal(store.detail(work.id).watched,true); assert.equal(store.history().length,1);
    store.saveMetadata(work.id,{ overview: 'Sinopse preservada',poster: 'Biblioteca/capas/poster.jpg' });
    store.savePersonal(work.id,{ ...work.personal,rating: 8.5,review: 'Minha resenha',tags: ['cinema'] });
    const poster = path.join(store.directory,'capas','poster.jpg'); await writeFile(poster,'capa');
    assert.equal(store.removalPreview(work.id).files.length,2);
    assert.equal((await removeWork(store,work.id)).keptHistory,true);
    for (const file of [a,b]) await assert.rejects(stat(file.absolute),{ code: 'ENOENT' });
    await store.close(); active = await Store.open(root);
    assert.equal(active.works().length,0); const entry = active.history()[0]; assert.ok(entry.removedAt);
    assert.equal(entry.work.personal.rating,8.5); assert.equal(entry.work.personal.review,'Minha resenha');
    assert.equal(entry.work.metadata.overview,'Sinopse preservada'); assert.equal(entry.work.sessions!.length,1);
    assert.ok(entry.work.files.every(file => !file.available)); assert.equal(await readFile(poster,'utf8'),'capa');
  } finally { await active.close(); await rm(root,{ recursive: true,force: true }); }
});

test('série parcial: exclui todos os vídeos e arquiva somente os episódios assistidos e suas sessões',async () => {
  const { root,store } = await library();
  try {
    await mkdir(path.join(root,'Series')); store.addSource(path.join(root,'Series'));
    const first = await video(store,'Series/Teste.S01E01E02.mp4'); const last = await video(store,'Series/Teste.S01E03.mp4');
    const series = store.detail(store.works()[0].id); complete(store,first.id); complete(store,last.id,50);
    const episode = series.children![0].children![0]; store.savePersonal(episode.id,{ ...episode.personal,rating: 9 });
    assert.equal(store.detail(series.id).watched,false);
    const preview = store.removalPreview(series.id); assert.equal(preview.watchedEpisodes,2); assert.equal(preview.totalEpisodes,3);
    await removeWork(store,series.id);
    await assert.rejects(stat(first.absolute),{ code: 'ENOENT' }); await assert.rejects(stat(last.absolute),{ code: 'ENOENT' });
    const entry = store.history()[0]; assert.equal(entry.watchedEpisodes,2); assert.equal(entry.totalEpisodes,3);
    assert.equal(entry.work.children![0].children!.length,2); assert.equal(entry.work.children![0].children![0].personal.rating,9);
    assert.deepEqual(entry.work.files.map(file => file.id),[first.id]); assert.deepEqual(entry.work.sessions!.map(session => session.fileId),[first.id]);
    assert.deepEqual(store.works(),[]); assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('marcações manuais entram no histórico, podem ser desfeitas e têm data estável',async () => {
  const { root,store } = await library();
  try {
    await video(store,'Filmes/Manual.mp4'); let work = store.works()[0];
    store.savePersonal(work.id,{ ...work.personal,watched: true }); const date = store.history()[0].watchedAt;
    store.savePersonal(work.id,{ ...store.detail(work.id).personal,rating: 9 });
    assert.equal(store.history()[0].watchedAt,date); assert.equal(store.removalPreview(work.id).keepsHistory,true);
    store.savePersonal(work.id,{ ...work.personal,watched: false }); assert.deepEqual(store.history(),[]);
    await mkdir(path.join(root,'Series')); store.addSource(path.join(root,'Series'));
    await video(store,'Series/Manual.S01E01.mp4'); await video(store,'Series/Manual.S01E02.mp4');
    work = store.works().find(work => work.kind === 'series')!;
    store.savePersonal(work.id,{ ...work.personal,watched: true });
    assert.ok(store.detail(work.id).children![0].children!.every(episode => episode.watched));
    assert.equal(store.removalPreview(work.id).watchedEpisodes,2); await removeWork(store,work.id);
    assert.equal(store.history()[0].work.children![0].children!.length,2);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('pré-verificação recusa arquivo modificado, links e associação compartilhada sem alterar catálogo',async () => {
  const { root,store } = await library();
  try {
    const file = await video(store,'Filmes/Seguro.mp4'); const work = store.works()[0];
    await writeFile(file.absolute,'novo conteúdo com outro tamanho');
    await assert.rejects(removeWork(store,work.id),/mudou/); assert.equal(store.works().length,1);
    await rm(file.absolute); const other = await video(store,'Filmes/Outro.mp4'); await symlink(other.absolute,file.absolute);
    await assert.rejects(removeWork(store,work.id),/links/); assert.equal(await readFile(other.absolute,'utf8'),other.content);
    await rm(file.absolute); await copyFile(other.absolute,file.absolute);
    const value = await stat(file.absolute); store.db.prepare('UPDATE files SET size=?,mtime=? WHERE id=?').run(value.size,value.mtimeMs,file.id);
    const otherWork = store.works().find(item => item.id !== work.id)!; store.db.prepare('INSERT INTO file_works VALUES (?,?)').run(file.id,otherWork.id);
    await assert.rejects(removeWork(store,work.id),/outro título/); assert.equal(store.works().length,2);
    assert.equal((store.db.prepare('SELECT count(*) AS n FROM file_removals').get() as any).n,0);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('falha na transação restaura os vídeos e preserva o catálogo e o histórico ao vivo',async () => {
  const { root,store } = await library();
  try {
    const file = await video(store,'Filmes/Rollback.mp4'); const work = store.works()[0]; complete(store,file.id);
    store.db.exec("CREATE TRIGGER fail_removal BEFORE DELETE ON works BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
    await assert.rejects(removeWork(store,work.id),/falha simulada/);
    assert.equal(await readFile(file.absolute,'utf8'),file.content); assert.equal(store.works().length,1); assert.equal(store.history()[0].removedAt,null);
    assert.equal((store.db.prepare('SELECT count(*) AS n FROM file_removals').get() as any).n,0);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('reconectar restaura exclusão interrompida antes do commit, incluindo lote parcial',async () => {
  const { root,store } = await library(); let active = store;
  try {
    const a = await video(store,'Filmes/Recuperar.mp4'); const b = await video(store,'Filmes/Recuperar 1080p.mp4');
    const work = store.works()[0]; const job = journal(store,work.id,'preparing'); await stage(store,job,1);
    await store.close(); active = await Store.open(root);
    assert.equal(await readFile(a.absolute,'utf8'),a.content); assert.equal(await readFile(b.absolute,'utf8'),b.content);
    assert.equal(active.works().length,1); assert.equal((active.db.prepare('SELECT count(*) AS n FROM file_removals').get() as any).n,0);
    assert.equal((await removeWork(active,work.id)).keptHistory,false);
  } finally { await active.close(); await rm(root,{ recursive: true,force: true }); }
});

test('reconectar termina limpeza após commit mantendo o histórico arquivado',async () => {
  const { root,store } = await library(); let active = store;
  try {
    const file = await video(store,'Filmes/Terminar.mp4'); const work = store.works()[0]; complete(store,file.id);
    const job = journal(store,work.id,'preparing'); const directory = await stage(store,job); store.removeCatalogWork(work.id,job.id);
    await store.close(); active = await Store.open(root);
    await assert.rejects(stat(directory),{ code: 'ENOENT' }); await assert.rejects(stat(file.absolute),{ code: 'ENOENT' });
    assert.equal(active.works().length,0); assert.ok(active.history()[0].removedAt); assert.equal(active.removalCleanupPending,false);
  } finally { await active.close(); await rm(root,{ recursive: true,force: true }); }
});

test('recuperação nunca sobrescreve um vídeo que surgiu no caminho original',async () => {
  const { root,store } = await library();
  try {
    const file = await video(store,'Filmes/Conflito.mp4'); const work = store.works()[0]; const job = journal(store,work.id,'preparing'); const directory = await stage(store,job);
    await writeFile(file.absolute,'substituto'); await store.close();
    await assert.rejects(Store.open(root),/caminho original/);
    assert.equal(await readFile(file.absolute,'utf8'),'substituto'); assert.equal(await readFile(path.join(directory,file.id),'utf8'),file.content);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});

test('biblioteca v3 recebe histórico dos assistidos existentes; scan não recria vídeos excluídos',async () => {
  const { root,store } = await library(); let active = store;
  try {
    const absolute = path.join(root,'Filmes','Importado.mp4'); media(absolute);
    const scanner = new Scanner(() => {}); await scanner.start(store); const work = store.works()[0]; complete(store,work.files[0].id);
    store.db.exec('DROP TABLE watched_history; DROP TABLE file_removals; PRAGMA user_version=3'); await store.close();
    active = await Store.open(root); assert.equal(active.history()[0].work.id,work.id);
    await removeWork(active,work.id); await scanner.start(active);
    assert.equal(active.works().length,0); assert.equal(active.history().length,1); assert.deepEqual(scanner.state.errors,[]);
  } finally { await active.close(); await rm(root,{ recursive: true,force: true }); }
});
