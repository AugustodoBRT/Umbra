import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  root: 'src/renderer',base: './',plugins: [react(),{ name: 'android-entry',transformIndexHtml: { order: 'pre',handler(html) { return html.replace('src="/main.tsx"','src="/mobile-entry.tsx"').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https: http: data:; connect-src \'self\' https: http:; media-src \'self\' https: http: blob:; font-src \'self\'; object-src \'none\'; base-uri \'none\'; frame-src \'none\'"/>'); } } }],
  resolve: { alias: { '/mobile-entry.tsx': path.resolve('src/mobile/main.tsx'),'node:crypto': path.resolve('src/mobile/crypto.ts'),'node:path': path.resolve('src/mobile/path.ts') } },
  build: { outDir: '../../dist/mobile',emptyOutDir: true },server: { host: '127.0.0.1' }
});
