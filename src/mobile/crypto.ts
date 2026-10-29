import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
export const randomUUID = () => crypto.randomUUID();
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error('Hash não suportado.');
  return { update(value: string) { return { digest(encoding: string) { if (encoding !== 'hex') throw new Error('Formato não suportado.'); return bytesToHex(sha256(utf8ToBytes(value))); } }; } };
}
