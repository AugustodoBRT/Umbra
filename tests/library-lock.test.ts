import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/storage/store';

async function stoppedPid() {
  const child = spawn(process.execPath,['-e',''],{ stdio: 'ignore' });
  await once(child,'exit');
  return child.pid!;
}
async function fixture(owner: unknown) {
  const root = await mkdtemp(path.join(tmpdir(),'library-lock-'));
  const lock = path.join(root,'Biblioteca','.catalogo.lock');
  await mkdir(lock,{ recursive: true });
  await writeFile(path.join(lock,'owner.json'),JSON.stringify(owner));
  return { root,lock };
}
test('reabre o catálogo depois que outro processo é encerrado abruptamente',async () => {
  const root = await mkdtemp(path.join(tmpdir(),'library-crash-'));
  const child = spawn(process.execPath,['--import','tsx','--input-type=module','-e',
    "import { Store } from './src/storage/store.ts'; const store = await Store.open(process.argv[1]); store.setSetting('crash-persistence',9); process.send(store.manifest.id); setInterval(() => {},1000);",root],
    { stdio: ['ignore','ignore','inherit','ipc'] });
  let store: Store | undefined;
  try {
    const [id] = await once(child,'message');
    await assert.rejects(Store.open(root),/bloqueada/);
    const exited = once(child,'exit');
    child.kill('SIGKILL');
    await exited;
    store = await Store.open(root);
    assert.equal(store.manifest.id,id);
    assert.equal(store.setting('crash-persistence',null),9);
    await store.assertDisk();
  } finally { child.kill(); await store?.close(); await rm(root,{ recursive: true,force: true }); }
});
test('recupera bloqueio antigo de processo encerrado e preserva dados do catálogo',async () => {
  const root = await mkdtemp(path.join(tmpdir(),'library-lock-'));
  let store = await Store.open(root);
  const id = store.manifest.id;
  store.setSetting('test-persistence',8.5);
  await store.close();
  const lock = path.join(root,'Biblioteca','.catalogo.lock');
  await mkdir(lock);
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({ host: hostname(),pid: await stoppedPid(),token: randomUUID() }));
  try {
    store = await Store.open(root);
    assert.equal(store.manifest.id,id);
    assert.equal(store.setting('test-persistence',null),8.5);
    assert.equal(JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8')).pid,process.pid);
    await store.assertDisk();
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('preserva bloqueios ativos, de outro computador, inválidos e em recuperação',async () => {
  for (const owner of [
    { host: hostname(),pid: process.pid,token: randomUUID() },
    { host: `${hostname()}-outro`,pid: await stoppedPid(),token: randomUUID() },
    { host: hostname(),pid: -1,token: randomUUID() },
    {}
  ]) {
    const { root,lock } = await fixture(owner);
    try {
      const original = await readFile(path.join(lock,'owner.json'),'utf8');
      await assert.rejects(Store.open(root),/bloqueada|confirmar/);
      assert.equal(await readFile(path.join(lock,'owner.json'),'utf8'),original);
    } finally { await rm(root,{ recursive: true,force: true }); }
  }
  const { root,lock } = await fixture({ host: hostname(),pid: await stoppedPid(),token: randomUUID() });
  try {
    await writeFile(path.join(lock,'recovery.json'),'interrompida');
    await assert.rejects(Store.open(root),/bloqueada/);
    assert.equal(await readFile(path.join(lock,'recovery.json'),'utf8'),'interrompida');
  } finally { await rm(root,{ recursive: true,force: true }); }
});
test('recupera bloqueio de outro boot e identifica PID reutilizado no Linux', { skip: process.platform !== 'linux' },async () => {
  for (const identity of [{ bootId: 'boot-anterior' },{ processStart: 'inicio-anterior' }]) {
    const { root } = await fixture({ host: hostname(),pid: process.pid,token: randomUUID(),...identity });
    let store: Store | undefined;
    try { store = await Store.open(root); await store.assertDisk(); }
    finally { await store?.close(); await rm(root,{ recursive: true,force: true }); }
  }
});
test('duas recuperações simultâneas deixam apenas um dono e preservam o bloqueio vencedor',async () => {
  const { root,lock } = await fixture({ host: hostname(),pid: await stoppedPid(),token: randomUUID() });
  const results = await Promise.allSettled([Store.open(root),Store.open(root)]);
  const stores = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  try {
    assert.equal(stores.length,1);
    await stores[0].assertDisk();
    await assert.rejects(Store.open(root),/bloqueada/);
    assert.equal(JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8')).pid,process.pid);
  } finally { await Promise.all(stores.map(store => store.close())); await rm(root,{ recursive: true,force: true }); }
});
test('recupera bloqueio da mesma sessão depois que o SSD retorna',async () => {
  const root = await mkdtemp(path.join(tmpdir(),'library-lock-'));
  let store = await Store.open(root);
  const moved = `${root}-ausente`;
  try {
    await rename(root,moved);
    await store.close();
    await rename(moved,root);
    store = await Store.open(root);
    await store.assertDisk();
  } finally { await store.close(); await rm(root,{ recursive: true,force: true }); await rm(moved,{ recursive: true,force: true }); }
});
