import { copyFile, lstat, mkdir, realpath, rename, rm, rmdir, utimes } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from '../storage/store';
import type { RemovalResult } from '../shared/types';
import { extensions } from './identify';
import { resolvePath } from './paths';

const jobSchema = z.object({ id: z.string().uuid(),workId: z.string().uuid(),files: z.array(z.object({ id: z.string().uuid(),path: z.string(),size: z.number().nonnegative(),mtime: z.number().finite() })) });
type RemovalJob = z.infer<typeof jobSchema>;
function stagedDirectory(store: Store,job: RemovalJob) { return path.join(store.directory,'.exclusoes',job.id); }
function stagedFile(store: Store,job: RemovalJob,file: RemovalJob['files'][number]) { return path.join(stagedDirectory(store,job),file.id); }
function authorizedPath(store: Store,relative: string) {
  const absolute = resolvePath(store.root,relative);
  if (absolute === store.directory || absolute.startsWith(`${store.directory}${path.sep}`) || !extensions.has(path.extname(relative).toLowerCase()) || !store.sources().some(source => source === '.' || relative.startsWith(`${source}/`))) throw new Error('O arquivo não está em uma pasta de vídeos autorizada.');
  return absolute;
}
async function info(file: string) { try { return await lstat(file); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; } }
async function verify(file: string,expected: RemovalJob['files'][number]) {
  const value = await info(file);
  if (!value) return null;
  if (!value.isFile() || value.isSymbolicLink() || await realpath(file) !== file) throw new Error('A exclusão não aceita links simbólicos ou caminhos alterados.');
  if (value.size !== expected.size || Math.abs(value.mtimeMs-expected.mtime) >= 1) throw new Error('Um arquivo mudou desde a importação. Faça uma nova varredura antes de excluí-lo.');
  return value;
}
async function verifyStaging(store: Store,job: RemovalJob) {
  for (const directory of [store.directory,path.join(store.directory,'.exclusoes'),stagedDirectory(store,job)]) {
    const value = await info(directory);
    if (!value) return false;
    if (!value.isDirectory() || value.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('A pasta de recuperação da exclusão foi alterada. Os arquivos foram preservados.');
  }
  return true;
}
async function finishJob(store: Store,job: RemovalJob) {
  await store.assertDisk();
  if (await verifyStaging(store,job)) await rmdir(stagedDirectory(store,job));
  store.db.prepare('DELETE FROM file_removals WHERE id=?').run(job.id);
}
async function restore(store: Store,job: RemovalJob) {
  const hasStaging = await verifyStaging(store,job);
  for (const file of job.files) {
    await store.assertDisk();
    const staged = stagedFile(store,job,file);
    const original = authorizedPath(store,file.path);
    const saved = hasStaging ? await verify(staged,file) : null;
    if (!saved) {
      if (!await verify(original,file)) throw new Error('Um vídeo da exclusão interrompida não foi encontrado. Preserve Biblioteca/.exclusoes para recuperação.');
      continue;
    }
    // Exclusive copy works on exFAT and never overwrites a replacement file.
    if (await info(original)) throw new Error('Há um arquivo no caminho original. A cópia preservada em Biblioteca/.exclusoes precisa ser recuperada antes de conectar.');
    const parent = path.dirname(original);
    if (await realpath(parent) !== parent) throw new Error('A pasta original foi alterada. Os vídeos foram preservados em Biblioteca/.exclusoes.');
    await copyFile(staged,original,constants.COPYFILE_EXCL);
    await utimes(original,saved.atime,new Date(file.mtime));
    await rm(staged);
  }
  await finishJob(store,job);
}
async function cleanup(store: Store,job: RemovalJob) {
  if (await verifyStaging(store,job)) for (const file of job.files) {
    await store.assertDisk();
    const staged = stagedFile(store,job,file);
    if (await verify(staged,file)) await rm(staged);
  }
  await finishJob(store,job);
}
export async function recoverRemovals(store: Store): Promise<boolean> {
  let cleanupPending = false;
  const jobs = store.db.prepare('SELECT state,data FROM file_removals').all() as { state: string; data: string }[];
  for (const row of jobs) {
    const job = jobSchema.parse(JSON.parse(row.data));
    if (row.state === 'preparing') await restore(store,job);
    else { try { await cleanup(store,job); } catch { cleanupPending = true; } }
  }
  return cleanupPending;
}
export async function removeWork(store: Store,id: string): Promise<RemovalResult> {
  await store.assertDisk();
  store.removalPreview(id);
  const work = store.detail(id);
  const ids = new Set([work.id,...(work.children ?? []).flatMap(season => [season.id,...(season.children ?? []).map(episode => episode.id)])]);
  const rows = store.rows();
  const files: RemovalJob['files'] = [];
  for (const file of work.files.filter(file => file.available)) {
    const links = store.db.prepare('SELECT work_id FROM file_works WHERE file_id=?').all(file.id) as { work_id: string }[];
    if (links.some(link => !ids.has(link.work_id))) throw new Error('Um vídeo também pertence a outro título. Corrija a associação antes de excluí-lo.');
    const row = rows.find(row => row.id === file.id)!;
    const expected = { id: file.id,path: file.path,size: file.size,mtime: row.mtime };
    if (await verify(authorizedPath(store,file.path),expected)) files.push(expected);
  }
  const job: RemovalJob = { id: randomUUID(),workId: id,files };
  if (await realpath(store.directory) !== store.directory) throw new Error('A pasta do catálogo foi alterada.');
  const staging = path.join(store.directory,'.exclusoes');
  await mkdir(staging,{ recursive: true });
  if (await realpath(staging) !== staging) throw new Error('A pasta de recuperação não pode ser um link simbólico.');
  await mkdir(stagedDirectory(store,job));
  store.db.prepare("INSERT INTO file_removals VALUES (?,'preparing',?)").run(job.id,JSON.stringify(job));
  let keptHistory: boolean;
  try {
    for (const file of files) {
      await store.assertDisk();
      const original = authorizedPath(store,file.path);
      if (!await verify(original,file)) throw new Error('Um vídeo ficou indisponível durante a exclusão. Tente novamente.');
      await rename(original,stagedFile(store,job,file));
    }
    for (const file of files) if (!await verify(stagedFile(store,job,file),file)) throw new Error('Um vídeo ficou indisponível durante a exclusão.');
    await store.assertDisk();
    keptHistory = store.removeCatalogWork(id,job.id);
  } catch (error) {
    try { await restore(store,job); }
    catch { throw new Error('A exclusão foi interrompida. Os vídeos foram preservados em Biblioteca/.exclusoes; reconecte a biblioteca para restaurá-los.'); }
    throw error;
  }
  try { await cleanup(store,job); return { keptHistory,cleanupPending: false }; }
  catch { return { keptHistory,cleanupPending: true }; }
}
