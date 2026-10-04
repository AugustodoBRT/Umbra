import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Credentials, type SystemCipher } from '../src/storage/credentials';
import { loadComputerConfig, saveComputerConfig, rememberedManifest } from '../src/storage/computer';
import { library } from './helpers';
import { defaultSubtitleAppearance } from '../src/shared/subtitles';
const unavailable: SystemCipher = { available: () => false,encrypt: () => { throw new Error('Indisponível'); },decrypt: () => { throw new Error('Indisponível'); } };
test('chaves persistem entre instâncias sem cofre do sistema, criptografadas e privadas',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'cinessd-credentials-'));
  try {
    const keys = { tmdb: 'chave-tmdb-de-teste',omdb: 'chave-omdb-de-teste' };
    const first = new Credentials(directory,unavailable); await first.save(keys);
    const raw = await readFile(path.join(first.directory,'providers.json'),'utf8');
    assert.ok(!raw.includes(keys.tmdb)); assert.ok(!raw.includes(keys.omdb));
    const reopened = new Credentials(directory,unavailable); assert.deepEqual(await reopened.load(),keys);
    assert.equal((await stat(first.directory)).mode & 0o777,0o700);
    for (const file of ['providers.json','device.key']) assert.equal((await stat(path.join(first.directory,file))).mode & 0o777,0o600);
    await reopened.save({ ...keys,omdb: 'outra-chave' }); assert.deepEqual(await first.load(),{ ...keys,omdb: 'outra-chave' });
    await first.save({ tmdb: '',omdb: '' }); assert.deepEqual(await reopened.load(),{ tmdb: '',omdb: '' });
  } finally { await rm(directory,{ recursive: true,force: true }); }
});
test('credenciais alteradas ou sem a chave local falham sem apagar o arquivo',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'cinessd-credentials-'));
  try {
    const credentials = new Credentials(directory,unavailable); await credentials.save({ tmdb: 'teste',omdb: '' });
    const file = path.join(credentials.directory,'providers.json'); const raw = await readFile(file,'utf8'); const envelope = JSON.parse(raw);
    envelope.tag = Buffer.alloc(16).toString('base64'); await writeFile(file,JSON.stringify(envelope));
    await assert.rejects(credentials.load(),/recuperar/); assert.ok(await readFile(file,'utf8'));
    await writeFile(file,raw); await rm(path.join(credentials.directory,'device.key'));
    await assert.rejects(credentials.load(),/recuperar/); assert.equal(await readFile(file,'utf8'),raw);
  } finally { await rm(directory,{ recursive: true,force: true }); }
});
test('migra credenciais legadas pelo cofre disponível e não as sobrescreve se indisponível',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'cinessd-credentials-'));
  try {
    const system: SystemCipher = { available: () => true,encrypt: value => Buffer.from(value.split('').reverse().join('')),decrypt: value => value.toString().split('').reverse().join('') };
    const keys = { tmdb: 'teste-legado',omdb: '' };
    const legacy = system.encrypt(JSON.stringify(keys)); await writeFile(path.join(directory,'providers.enc'),legacy);
    await assert.rejects(new Credentials(directory,unavailable).load(),/cofre/);
    assert.deepEqual(await readFile(path.join(directory,'providers.enc')),legacy);
    assert.deepEqual(await new Credentials(directory,system).load(),keys);
    assert.equal(JSON.parse(await readFile(path.join(directory,'credentials','providers.json'),'utf8')).backend,'system');
    await assert.rejects(new Credentials(directory,unavailable).load(),/recuperar/);
  } finally { await rm(directory,{ recursive: true,force: true }); }
});
test('lembra seleção antiga e verifica identidade sem criar biblioteca quando o SSD falta',async () => {
  const { root,store } = await library(); const computer = await mkdtemp(path.join(tmpdir(),'cinessd-computer-'));
  try {
    await writeFile(path.join(computer,'library.json'),JSON.stringify({ lastRoot: root }));
    const legacy = await loadComputerConfig(computer); assert.equal(legacy.reopenLastLibrary,true);
    assert.equal((await rememberedManifest(legacy))?.id,store.manifest.id);
    const config = { lastRoot: root,libraryId: store.manifest.id,libraryName: store.manifest.name,reopenLastLibrary: true };
    await saveComputerConfig(computer,config); assert.deepEqual(await loadComputerConfig(computer),config);
    await assert.rejects(rememberedManifest({ ...config,libraryId: randomUUID() }));
    assert.equal(await rememberedManifest({ ...config,reopenLastLibrary: false }),null);
    const absent = path.join(computer,'SSD-ausente'); await assert.rejects(rememberedManifest({ ...config,lastRoot: absent }));
    await assert.rejects(stat(absent),{ code: 'ENOENT' });
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); await rm(computer,{ recursive: true,force: true }); }
});
test('preferências de legenda persistem no computador sem biblioteca conectada',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-subtitle-settings-'));
  try {
    const old = await loadComputerConfig(directory);
    assert.equal(old.subtitleAppearance,undefined);
    const appearance = { ...defaultSubtitleAppearance,fontSize: 36,color: '#ffe066',bottom: 12 };
    await saveComputerConfig(directory,{ ...old,subtitleAppearance: appearance });
    assert.deepEqual((await loadComputerConfig(directory)).subtitleAppearance,appearance);
    await assert.rejects(saveComputerConfig(directory,{ ...old,subtitleAppearance: { ...appearance,fontSize: 0 } }));
    assert.deepEqual((await loadComputerConfig(directory)).subtitleAppearance,appearance);
  } finally { await rm(directory,{ recursive: true,force: true }); }
});
