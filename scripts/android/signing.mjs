import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
export async function signingEnvironment(javaHome) {
  if (process.env.UMBRA_KEYSTORE) return { ...process.env };
  if (process.env.CI) throw new Error('Configure os segredos Android de assinatura antes de publicar.');
  const directory = path.join(os.homedir(),'.local/share/umbra/android-signing'); await mkdir(directory,{ recursive: true,mode: 0o700 }); await chmod(directory,0o700);
  const file = path.join(directory,'signing.json'); let settings;
  try { settings = JSON.parse(await readFile(file,'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = { store: path.join(directory,'umbra.jks'),password: randomBytes(32).toString('base64url'),alias: 'umbra' };
    const env = { ...process.env,UMBRA_GENERATE_PASSWORD: settings.password };
    execFileSync(path.join(javaHome,'bin/keytool'),['-genkeypair','-keystore',settings.store,'-storetype','PKCS12','-storepass:env','UMBRA_GENERATE_PASSWORD','-keypass:env','UMBRA_GENERATE_PASSWORD','-alias',settings.alias,'-keyalg','RSA','-keysize','4096','-validity','10000','-dname','CN=Umbra, O=Umbra, C=BR'],{ env,stdio: ['ignore','ignore','pipe'] });
    await writeFile(file,JSON.stringify(settings),{ mode: 0o600 }); await chmod(settings.store,0o600);
  }
  await readFile(settings.store); // Fail before a release if the permanent key is unavailable.
  return { ...process.env,UMBRA_KEYSTORE: settings.store,UMBRA_STORE_PASSWORD: settings.password,UMBRA_KEY_ALIAS: settings.alias,UMBRA_KEY_PASSWORD: settings.password };
}
