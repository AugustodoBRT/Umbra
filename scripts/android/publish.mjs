import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('release/android/android-update.json','utf8'));
if (createHash('sha256').update(await readFile('release/android/Umbra-android.apk')).digest('hex') !== manifest.sha256) throw new Error('O APK foi alterado depois da geração do manifesto.');
const head = execFileSync('git',['rev-parse','HEAD'],{ encoding: 'utf8' }).trim();
if (manifest.commit !== head) throw new Error('Gere o APK novamente a partir do commit atual antes de publicar.');
if (execFileSync('git',['status','--porcelain'],{ encoding: 'utf8' }).trim()) throw new Error('Faça commit das alterações antes de publicar uma atualização.');
const repository = 'AugustodoBRT/Umbra';
const exists = spawnSync('gh',['release','view','android-latest','--repo',repository],{ stdio: 'ignore' }).status === 0;
if (!exists) execFileSync('gh',['release','create','android-latest','--repo',repository,'--target',head,'--title','Umbra para Android','--notes-file','docs/ANDROID_RELEASE.md','--prerelease'],{ stdio: 'inherit' });
// Advertise a version only after its binary is available; checksum verification rejects a concurrent stale download.
execFileSync('gh',['release','upload','android-latest','release/android/Umbra-android.apk','release/android/SHA256SUMS.txt','--clobber','--repo',repository],{ stdio: 'inherit' });
execFileSync('gh',['release','upload','android-latest','release/android/android-update.json','--clobber','--repo',repository],{ stdio: 'inherit' });
execFileSync('gh',['release','edit','android-latest','--repo',repository,'--title',`Umbra Android ${manifest.versionName}`,'--notes-file','docs/ANDROID_RELEASE.md'],{ stdio: 'inherit' });
console.log('Atualização publicada: https://github.com/AugustodoBRT/Umbra/releases/tag/android-latest');
