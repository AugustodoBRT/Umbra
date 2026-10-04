import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, chmod, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const keysSchema = z.object({ tmdb: z.string().trim().max(4096), omdb: z.string().trim().max(100) });
export type ProviderKeys = z.infer<typeof keysSchema>;
export interface SystemCipher { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
const envelopeSchema = z.object({ version: z.literal(1), backend: z.enum(['system','local']), data: z.string().max(32_000_000), iv: z.string().optional(), tag: z.string().optional() });

export async function atomicPrivateWrite(target: string, value: string | Buffer) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary,'wx',0o600);
    try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
    await rename(temporary,target);
  } finally { await rm(temporary,{ force: true }); }
}

/** OS vault first. Fallback is private local storage, not protection from this same account. */
export class Credentials {
  readonly directory: string;
  constructor(private computerDirectory: string, private system: SystemCipher) { this.directory = path.join(computerDirectory,'credentials'); }
  get backend(): 'system'|'local' { return this.system.available() ? 'system' : 'local'; }
  private async initialize() { await mkdir(this.directory,{ recursive: true,mode: 0o700 }); if (process.platform !== 'win32') await chmod(this.directory,0o700); }
  private async deviceKey(create: boolean) {
    const file = path.join(this.directory,'device.key');
    let key: Buffer;
    try { key = await readFile(file); }
    catch (error: any) {
      if (!create || error.code !== 'ENOENT') throw new Error('A chave local das credenciais está indisponível. Configure os provedores novamente.');
      key = randomBytes(32);
      try {
        const handle = await open(file,'wx',0o600);
        try { await handle.writeFile(key); await handle.sync(); } finally { await handle.close(); }
      } catch (error: any) { if (error.code !== 'EEXIST') throw error; key = await readFile(file); }
    }
    if (key.length !== 32) throw new Error('A chave local das credenciais está inválida.');
    if (process.platform !== 'win32') await chmod(file,0o600);
    return key;
  }
  async load(): Promise<ProviderKeys> {
    let encoded: string;
    try { encoded = await readFile(path.join(this.directory,'providers.json'),'utf8'); }
    catch (error: any) {
      if (error.code !== 'ENOENT') throw new Error('Não foi possível ler as credenciais salvas.');
      // Compatibility with keys previously protected by Electron safeStorage.
      let legacy: Buffer;
      try { legacy = await readFile(path.join(this.computerDirectory,'providers.enc')); }
      catch (error: any) { if (error.code === 'ENOENT') return { tmdb: '',omdb: '' }; throw new Error('Não foi possível ler as credenciais salvas.'); }
      if (!this.system.available()) throw new Error('O cofre do sistema usado pelas chaves anteriores está indisponível.');
      try { const keys = keysSchema.parse(JSON.parse(this.system.decrypt(legacy))); await this.save(keys); return keys; }
      catch { throw new Error('Não foi possível recuperar as credenciais do cofre do sistema.'); }
    }
    try {
      return keysSchema.parse(await this.decodeDocument(encoded,'providers'));
    } catch { throw new Error('Não foi possível recuperar as chaves salvas. Os arquivos foram preservados; verifique o cofre ou configure os provedores novamente.'); }
  }
  private async decodeDocument(encoded: string, name: string): Promise<unknown> {
      const envelope = envelopeSchema.parse(JSON.parse(encoded));
      let plaintext: string;
      if (envelope.backend === 'system') {
        if (!this.system.available()) throw new Error('O cofre do sistema está indisponível.');
        plaintext = this.system.decrypt(Buffer.from(envelope.data,'base64'));
      } else {
        const iv = Buffer.from(envelope.iv ?? '','base64'); const tag = Buffer.from(envelope.tag ?? '','base64');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('Credenciais inválidas.');
        const decipher = createDecipheriv('aes-256-gcm',await this.deviceKey(false),iv);
        decipher.setAAD(Buffer.from(`CineSSD ${name} v1`)); decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8');
      }
      return JSON.parse(plaintext);
  }
  async loadDocument(name: 'addons'|'downloads'): Promise<unknown | null> {
    try { return await this.decodeDocument(await readFile(path.join(this.directory,`${name}.json`),'utf8'),name); }
    catch (error: any) { if (error.code === 'ENOENT') return null; throw new Error(`Não foi possível ler ${name === 'addons' ? 'os complementos' : 'os downloads'} salvos. Os arquivos foram preservados.`); }
  }
  async save(value: ProviderKeys) { await this.saveDocument('providers',keysSchema.parse(value)); }
  async saveDocument(name: 'providers'|'addons'|'downloads', value: unknown) {
    await this.initialize();
    let envelope: z.infer<typeof envelopeSchema>;
    if (this.system.available()) envelope = { version: 1,backend: 'system',data: this.system.encrypt(JSON.stringify(value)).toString('base64') };
    else {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',await this.deviceKey(true),iv);
      cipher.setAAD(Buffer.from(`CineSSD ${name} v1`));
      const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      envelope = { version: 1,backend: 'local',data: data.toString('base64'),iv: iv.toString('base64'),tag: cipher.getAuthTag().toString('base64') };
    }
    await atomicPrivateWrite(path.join(this.directory,`${name}.json`),JSON.stringify(envelopeSchema.parse(envelope)));
  }
}
