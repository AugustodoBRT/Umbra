import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.cinessd.android',appName: 'Umbra',webDir: 'dist/mobile',
  android: { allowMixedContent: true,backgroundColor: '#0b0e09' },
  server: { androidScheme: 'https' }
};
export default config;
