import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicPrivateWrite } from './credentials';
const configSchema = z.object({ lastRoot: z.string().default(''), libraryId: z.string().uuid().optional(), libraryName: z.string().optional(), reopenLastLibrary: z.boolean().default(true),downloadRoot: z.string().optional(),downloadLibraryId: z.string().uuid().optional() });
export type ComputerConfig = z.infer<typeof configSchema>;
export async function loadComputerConfig(directory: string): Promise<ComputerConfig> {
  try { return configSchema.parse(JSON.parse(await readFile(path.join(directory,'library.json'),'utf8'))); }
  catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Não foi possível ler a biblioteca lembrada neste computador. Selecione a pasta novamente.'); return { lastRoot: '',reopenLastLibrary: true }; }
}
export async function saveComputerConfig(directory: string, config: ComputerConfig) {
  await mkdir(directory,{ recursive: true });
  await atomicPrivateWrite(path.join(directory,'library.json'),JSON.stringify(configSchema.parse(config)));
}
export async function rememberedManifest(config: ComputerConfig) {
  if (!config.lastRoot || !config.reopenLastLibrary) return null;
  const value = z.object({ id: z.string().uuid(),name: z.string(),formatVersion: z.literal(1) }).parse(JSON.parse(await readFile(path.join(config.lastRoot,'Biblioteca','biblioteca.json'),'utf8')));
  if (config.libraryId && config.libraryId !== value.id) throw new Error('A pasta lembrada agora contém outra biblioteca. Selecione o SSD novamente.');
  return value;
}
