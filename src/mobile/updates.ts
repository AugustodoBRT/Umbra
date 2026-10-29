import { z } from 'zod';
export const updateFeed = 'https://github.com/AugustodoBRT/Umbra/releases/download/android-latest/android-update.json';
const apkURL = 'https://github.com/AugustodoBRT/Umbra/releases/download/android-latest/Umbra-android.apk';
export const updateSchema = z.object({ schemaVersion: z.literal(1),applicationId: z.literal('io.cinessd.android'),versionCode: z.number().int().positive().max(2100000000),versionName: z.string().min(1).max(80),url: z.literal(apkURL),sha256: z.string().regex(/^[a-f0-9]{64}$/),minSdk: z.number().int().min(28).max(36),notes: z.string().max(10000).default('Uma nova versão do Umbra está disponível.') });
export type AndroidUpdate = z.infer<typeof updateSchema>;
export function availableUpdate(value: unknown,currentVersion: number) { const update = updateSchema.parse(value); return update.versionCode > currentVersion ? update : null; }
