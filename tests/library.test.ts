import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, rm, copyFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { identify, ignored } from '../src/library/identify';
import { relativePath, resolvePath, existingPath } from '../src/library/paths';
import { Scanner, fingerprint } from '../src/library/scanner';
import { Store, migrate, migrations } from '../src/storage/store';
import { library, media } from './helpers';
test('nomes técnicos, temporadas especiais e vários episódios',() => {
  assert.deepEqual(identify('Filmes/Interestelar.2014.1080p.BluRay.x264-GROUP.mkv'),{ title: 'Interestelar',year: 2014,kind: 'movie',season: null,episodes: [] });
  assert.deepEqual(identify('Series/Dark/Dark.S01E02E03.1080p.WEB-DL.mkv'),{ title: 'Dark',year: null,kind: 'episode',season: 1,episodes: [2,3] });
  assert.deepEqual(identify('Series/Doctor Who/Season 0/S00E01.mkv').season,0);
  assert.equal(identify('Series/Dark/Temporada 1/1x02.mkv').title,'Dark');
  assert.equal(identify('Filmes/A Chegada (2016)/filme.mkv').year,2016);
  assert.deepEqual(identify('Filmes/Blade Runner 2049 (2017).mkv'),{ title: 'Blade Runner 2049',year: 2017,kind: 'movie',season: null,episodes: [] });
  assert.deepEqual(identify('Filmes/1917 (2019).mp4'),{ title: '1917',year: 2019,kind: 'movie',season: null,episodes: [] });
  assert.deepEqual(identify('Series/Dark (2017)/Temporada 01/Dark (2017) - S01E02.mkv'),{ title: 'Dark',year: 2017,kind: 'episode',season: 1,episodes: [2] });
  assert.ok(ignored('movie.sample.mkv')); assert.ok(ignored('Extras')); assert.ok(!ignored('Samples of Life (2020).mkv'));
});
test('caminhos portáteis e bloqueio de travessia e links externos',async () => {
  const { root,store } = await library();
  try {
    assert.equal(relativePath(root,path.join(root,'Filmes','a.mkv')),'Filmes/a.mkv');
    for (const p of ['../segredo','/etc/passwd','C:/Windows','Filmes/../../etc/passwd','Filmes\\a.mkv']) assert.throws(() => resolvePath(root,p));
    await symlink('/etc',path.join(root,'Filmes','externo'));
    await assert.rejects(existingPath(root,'Filmes/externo/passwd'));
    assert.throws(() => store.addSource('/etc'));
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('migrações idempotentes, versão futura recusada e rollback de transação',async () => {
  const db = new DatabaseSync(':memory:'); migrate(db); migrate(db);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version,migrations.length);
  db.exec('PRAGMA user_version=999'); assert.throws(() => migrate(db)); db.close();
  const { root,store } = await library();
  try {
    assert.throws(() => store.transaction(() => { store.setSetting('x',1); throw new Error('falha'); }));
    assert.equal(store.setting('x',null),null);
    await assert.rejects(Store.open(root),/bloqueada/);
    const backup = await store.backup(); const saved = new DatabaseSync(backup); assert.equal((saved.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok'); saved.close();
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('importação real incremental, identidade após renomear e persistência após mudar a raiz',async () => {
  const { root,store } = await library(); let active = store; let finalRoot = root;
  try {
    const file = path.join(root,'Filmes','Minha História (2026).mp4'); media(file);
    const scanner = new Scanner(() => {}); await scanner.start(store);
    assert.equal(scanner.state.added,1); assert.deepEqual(scanner.state.errors,[]);
    const work = store.works()[0]; assert.equal(work.title,'Minha História'); assert.equal(work.files[0].width,320); assert.ok(work.files[0].duration >= 4.9); assert.equal(work.files[0].tracks[0].type,'audio');
    store.savePersonal(work.id,{ ...work.personal,rating: 8.5,review: 'Uma resenha privada.',favorite: true });
    const session = store.startSession(work.files[0].id); store.progress(work.files[0].id,session,2,5,1,true);
    await scanner.start(store); assert.equal(scanner.state.added,0); assert.equal(scanner.state.updated,0);
    await rename(file,path.join(root,'Filmes','Outro nome.mp4')); await scanner.start(store);
    assert.equal(store.works().length,1); assert.equal(store.works()[0].files[0].id,work.files[0].id); assert.equal(store.detail(work.id).personal.rating,8.5); assert.equal(store.detail(work.id).files[0].position,2);
    const newRoot = `${root}-movido`; await store.close(); await rename(root,newRoot); finalRoot = newRoot; active = await Store.open(newRoot);
    assert.equal(active.detail(work.id).personal.review,'Uma resenha privada.'); assert.equal(active.detail(work.id).files[0].path,'Filmes/Outro nome.mp4');
    await rm(path.join(newRoot,'Filmes','Outro nome.mp4')); await scanner.start(active);
    assert.equal(active.detail(work.id).available,false); assert.equal(active.detail(work.id).personal.rating,8.5); assert.equal(active.detail(work.id).sessions?.length,1);
  } finally { await active.close(); await rm(finalRoot,{ recursive: true,force: true }); }
});
test('cópias idênticas presentes continuam arquivos separados; séries agrupam episódios',async () => {
  const { root,store } = await library();
  try {
    const a = path.join(root,'Filmes','Obra (2026).mp4'); media(a); await copyFile(a,path.join(root,'Filmes','Obra (2026) 1080p.mp4'));
    await mkdir(path.join(root,'Series')); store.addSource(path.join(root,'Series'));
    media(path.join(root,'Series','Teste.S01E01E02.mp4'),'red');
    const scanner = new Scanner(() => {}); await scanner.start(store);
    const works = store.works(); assert.equal(works.filter(x => x.kind === 'movie').length,1); assert.equal(works.find(x => x.kind === 'movie')?.files.length,2);
    const series = store.detail(works.find(x => x.kind === 'series')!.id); assert.equal(series.children?.[0].children?.length,2); assert.equal(series.files.length,1);
    const episodes = series.children![0].children!; assert.equal(episodes[0].files[0].id,episodes[1].files[0].id);
    assert.equal(episodes[0].metadata.imdb,undefined);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('cancelamento e pasta inacessível não apagam dados nem marcam falsos ausentes',async () => {
  const { root,store } = await library();
  try {
    media(path.join(root,'Filmes','Teste.mp4'));
    const scanner = new Scanner(() => {}); await scanner.start(store); const id = store.works()[0].id;
    await rename(path.join(root,'Filmes'),path.join(root,'Desmontada')); await scanner.start(store);
    assert.ok(scanner.state.errors.length); assert.ok(store.detail(id).available);
    await rename(path.join(root,'Desmontada'),path.join(root,'Filmes'));
    let cancelling: Scanner; cancelling = new Scanner(state => { if (state.running && state.phase === 'inspecting') cancelling.cancel(); });
    await cancelling.start(store); assert.ok(cancelling.state.cancelled); assert.ok(store.detail(id).available);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('substituir conteúdo no mesmo caminho cria uma identidade nova e mantém a sessão original',async () => {
  const { root,store } = await library();
  try {
    const file = path.join(root,'Filmes','Título (2026).mp4'); media(file);
    const scanner = new Scanner(() => {}); await scanner.start(store); const work = store.works()[0]; const original = work.files[0];
    const session = store.startSession(original.id); store.progress(original.id,session,2,5,1,true);
    await rm(file); media(file,'red',6); await scanner.start(store);
    const result = store.detail(work.id); assert.equal(result.files.length,2);
    assert.equal(result.files.find(x => x.id === original.id)?.available,false);
    assert.ok(result.files.find(x => x.available)?.id !== original.id); assert.equal(result.files.find(x => x.available)?.position,0);
    assert.equal(result.sessions?.[0].fileId,original.id);
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('migração v2 para v3 preserva referências, arquivos e histórico',() => {
  const db = new DatabaseSync(':memory:'); db.exec(migrations[0]); db.exec(migrations[1]); db.exec('PRAGMA user_version=2; PRAGMA foreign_keys=ON');
  db.prepare("INSERT INTO works(id,kind,title,added_at) VALUES ('work','movie','Teste','2026')").run();
  db.prepare("INSERT INTO files VALUES ('file','Filmes/a.mp4',1,1,'hash',5,10,10,'mpeg4','[]',1)").run();
  db.prepare("INSERT INTO file_works VALUES ('file','work')").run();
  db.prepare("INSERT INTO sessions(id,file_id,started_at) VALUES ('session','file','2026')").run();
  migrate(db); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal((db.prepare('SELECT file_id FROM sessions').get() as any).file_id,'file'); assert.equal((db.prepare('SELECT count(*) AS n FROM file_works').get() as any).n,1); db.close();
});
