import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { signingEnvironment } from './signing.mjs';
const env = await signingEnvironment(process.env.JAVA_HOME || path.resolve('.local/android-tools/jdk'));
const secrets = { ANDROID_KEYSTORE_BASE64: (await readFile(env.UMBRA_KEYSTORE)).toString('base64'),ANDROID_STORE_PASSWORD: env.UMBRA_STORE_PASSWORD,ANDROID_KEY_ALIAS: env.UMBRA_KEY_ALIAS,ANDROID_KEY_PASSWORD: env.UMBRA_KEY_PASSWORD };
for (const [name,value] of Object.entries(secrets)) execFileSync('gh',['secret','set',name,'--repo','AugustodoBRT/Umbra'],{ input: value,stdio: ['pipe','ignore','pipe'] });
console.log('Assinatura Android configurada nos segredos do repositório. A chave não foi incluída no código.');
