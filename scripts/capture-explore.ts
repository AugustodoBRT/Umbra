import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { until } from '../tests/helpers';

// Capture the real online catalog in a temporary profile, without touching the user's library.
const config = await mkdtemp(path.join(tmpdir(),'umbra-readme-'));
const output = path.resolve('assets/screenshots');
await mkdir(output,{ recursive: true });
let runtime: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  runtime = await electron.launch({ executablePath: process.env.CINESSD_ELECTRON || '/usr/bin/electron',args: [path.resolve('.'),'--password-store=basic',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env: Object.fromEntries(Object.entries({ ...process.env,CINESSD_DATA_DIR: config }).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')),timeout: 60000 });
  const page = await runtime.firstWindow();
  await page.getByRole('button',{ name: 'Umbra, início' }).waitFor();
  // Leave just the catalog enabled: this capture never consults download providers.
  const catalog = (await page.evaluate(() => window.cine.addons())).find(addon => addon.name === 'Cinemeta');
  if (!catalog) throw new Error('Catálogo Cinemeta indisponível.');
  for (const addon of await page.evaluate(() => window.cine.addons())) {
    if (addon.id !== catalog.id) await page.evaluate(id => window.cine.addon('disable',id),addon.id);
  }
  await runtime.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280,1080); });
  await page.setViewportSize({ width: 1280,height: 1080 });
  await page.getByRole('button',{ name: 'Explorar',exact: true }).click();
  await page.getByLabel('Gênero do catálogo online').selectOption('Sci-Fi');
  console.log('Carregando o catálogo real de ficção científica…');
  await until(async () => await page.locator('.media-card').count() >= 12,60000);
  await until(async () => await page.locator('.media-card .artwork img').evaluateAll(images => {
    const visible = images.filter(image => { const bounds = image.closest('.media-card')!.getBoundingClientRect(); return bounds.bottom > 0 && bounds.top < innerHeight; });
    return visible.length >= 6 && visible.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0);
  }),60000);
  await page.screenshot({ animations: 'disabled',path: path.join(output,'explore.png') });
  console.log('Print real do Explorar salvo em assets/screenshots/explore.png.');
  await runtime.evaluate(({ BrowserWindow },file) => BrowserWindow.getAllWindows()[0].loadFile(file),path.resolve('assets/brand/identity-preview.html'));
  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ animations: 'disabled',fullPage: true,path: path.resolve('assets/brand/identity-preview.png') });
} catch (error) {
  if (runtime) {
    const page = await runtime.firstWindow();
    console.error((await page.locator('main').innerText()).slice(0,3000));
    console.error(await page.locator('.media-card').evaluateAll(cards => cards.slice(0,18).map(card => ({ title: card.textContent,loaded: (card.querySelector('img') as HTMLImageElement)?.naturalWidth }))));
    await mkdir('test-results',{ recursive: true });
    await page.screenshot({ path: 'test-results/capture-explore-failure.png' });
  }
  throw error;
} finally {
  await runtime?.close();
  await rm(config,{ recursive: true,force: true });
}
