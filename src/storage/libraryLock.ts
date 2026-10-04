import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const ownerSchema = z.object({ host: z.string().min(1), pid: z.number().int().positive(), token: z.string().uuid(), bootId: z.string().optional(), processStart: z.string().optional() });
type Owner = z.infer<typeof ownerSchema>;
async function bootId() {
  if (process.platform !== 'linux') return undefined;
  try { return (await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(); } catch { return undefined; }
}
async function processStart(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`,'utf8');
  // comm can contain spaces and parentheses; starttime is field 22.
  return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
}
export class LibraryLock {
  private static retired = new Set<string>();
  readonly token = randomUUID();
  private held = false;
  constructor(readonly directory: string) {}
  private async owner(): Promise<Owner | undefined> {
    try { return ownerSchema.parse(JSON.parse(await readFile(path.join(this.directory,'owner.json'),'utf8'))); } catch { return undefined; }
  }
  private async recoverable(owner: Owner | undefined) {
    if (!owner || owner.host !== hostname()) return false;
    if (owner.pid === process.pid && LibraryLock.retired.has(owner.token)) return true;
    const currentBoot = await bootId();
    if (owner.bootId && currentBoot && owner.bootId !== currentBoot) return true;
    try { process.kill(owner.pid,0); }
    catch (error: any) { return error.code === 'ESRCH'; }
    if (process.platform === 'linux' && owner.processStart) {
      try { return owner.processStart !== await processStart(owner.pid); } catch { return false; }
    }
    return false;
  }
  private blocked(owner?: Owner) {
    return new Error(owner
      ? `Esta biblioteca está bloqueada pelo processo ${owner.pid} em ${owner.host}. Feche o aplicativo nesse computador e tente conectar novamente.`
      : 'Não foi possível confirmar quem está usando esta biblioteca. Feche os aplicativos que usam o SSD e confira Biblioteca/.catalogo.lock/owner.json antes de recuperar o bloqueio conforme o README.');
  }
  async acquire() {
    try { await mkdir(this.directory); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      // Claim recovery inside the existing directory before reading its owner.
      // Only one contender may remove it; others leave the lock untouched.
      const guard = path.join(this.directory,'recovery.json');
      try { await writeFile(guard,JSON.stringify({ token: this.token }),{ flag: 'wx' }); }
      catch (error: any) { if (['EEXIST','ENOENT'].includes(error.code)) throw this.blocked(await this.owner()); throw error; }
      try {
        const previous = await this.owner();
        if (!await this.recoverable(previous)) throw this.blocked(previous);
        await rm(this.directory,{ recursive: true });
        try { await mkdir(this.directory); }
        catch (error: any) { if (error.code === 'EEXIST') throw this.blocked(await this.owner()); throw error; }
        LibraryLock.retired.delete(previous!.token);
      } finally {
        // A new directory may already belong to another process.
        try { if (JSON.parse(await readFile(guard,'utf8')).token === this.token) await rm(guard); } catch { /* Removed with the retired directory. */ }
      }
    }
    this.held = true;
    const owner: Owner = { host: hostname(),pid: process.pid,token: this.token,bootId: await bootId() };
    if (process.platform === 'linux') { try { owner.processStart = await processStart(process.pid); } catch { /* PID liveness remains available. */ } }
    try { await writeFile(path.join(this.directory,'owner.json'),JSON.stringify(owner),{ flag: 'wx' }); }
    catch (error) { await this.release(); throw error; }
  }
  async release() {
    if (!this.held) return;
    this.held = false;
    try {
      if ((await this.owner())?.token === this.token) await rm(this.directory,{ recursive: true });
      else LibraryLock.retired.add(this.token);
    } catch { LibraryLock.retired.add(this.token); /* Never recreate a disconnected drive. */ }
  }
}
