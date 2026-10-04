import path from 'node:path';
import { realpath } from 'node:fs/promises';
export function relativePath(root: string, absolute: string): string {
  const value = path.relative(root, absolute);
  if (value === '..' || value.startsWith(`..${path.sep}`) || path.isAbsolute(value)) throw new Error('Escolha uma pasta dentro da raiz da biblioteca.');
  return value.split(path.sep).join('/') || '.';
}
export function resolvePath(root: string, relative: string): string {
  if (relative.includes('\\') || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative) || relative.split('/').includes('..') || relative.includes('\0')) throw new Error('Caminho inválido.');
  const absolute = path.resolve(root, relative);
  relativePath(root, absolute);
  return absolute;
}
export async function existingPath(root: string, relative: string): Promise<string> {
  const absolute = await realpath(resolvePath(root, relative));
  relativePath(await realpath(root), absolute);
  return absolute;
}
