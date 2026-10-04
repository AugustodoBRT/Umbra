import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, safeStorage, session } from 'electron';
import { readFile, writeFile, mkdir, rename, realpath, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { Store } from '../storage/store';
import { Credentials } from '../storage/credentials';
import { loadComputerConfig, saveComputerConfig, rememberedManifest, type ComputerConfig } from '../storage/computer';
import { OnlineStore } from '../storage/online';
import { Addons } from '../online/addons';
import { Downloads } from '../downloads/downloads';
import { Scanner } from '../library/scanner';
import { EmbeddedPlayer } from '../playback/embedded';
import { mediaTool, torrentWorker } from '../runtime/tools';
import { Providers, emptyIdentification } from '../metadata/providers';
import { existingPath, resolvePath, relativePath } from '../library/paths';
import { removeWork as removeLocalWork } from '../library/removal';
import { idSchema, personalSchema, editSchema, candidateSchema, settingsSchema } from '../shared/validation';
import { defaultSubtitleAppearance, subtitleAppearanceSchema } from '../shared/subtitles';
import type { Snapshot, Event, Settings, LibraryInfo, RemovalResult } from '../shared/types';

protocol.registerSchemesAsPrivileged([{ scheme: 'cinessd', privileges: { standard: true, secure: true, supportFetchAPI: true,stream: true,corsEnabled: true } }]);
// Keep the existing profile when changing the public product name.
app.setPath('userData',process.env.CINESSD_DATA_DIR ? path.resolve(process.env.CINESSD_DATA_DIR) : path.join(app.getPath('appData'),'cinessd'));
app.setName('Umbra');
let window: BrowserWindow;
let store: Store | null = null;
let lastSnapshot: Snapshot | undefined;
let lastRoot = '';
let computer: ComputerConfig = { lastRoot: '',reopenLastLibrary: true };
let credentials: Credentials;
let onlineStore: OnlineStore;
let addons: Addons;
let downloads: Downloads;
let pendingDownloadScan = false;
let startupError: string | undefined;
let identification = emptyIdentification();
let enrichment: Promise<{ matched: number; pending: number }> | undefined;
let enrichmentRequested = false;
let enrichmentForce = false;
let savingKeys = false;
let shuttingDown = false;
let switching = false;
let monitor: NodeJS.Timeout | undefined;
let checkingDisk = false;
let removing: Promise<RemovalResult> | undefined;
const providers = new Providers();
const operations = new Set<Promise<unknown>>();
const emit = (event: Event) => { if (switching && event.type === 'changed') return; if (window && !window.isDestroyed()) window.webContents.send('cine:event',event); };
const scanner = new Scanner(data => { emit({ type: 'scan',data }); if (!data.running) { emit({ type: 'changed' }); if (pendingDownloadScan && store && !switching && !shuttingDown) { pendingDownloadScan = false; void scanner.start(store); } else scheduleEnrichment(); } });
const player = new EmbeddedPlayer(data => { emit({ type: 'player',data }); if (!data.active) { if (window?.isFullScreen()) window.setFullScreen(false); emit({ type: 'changed' }); } });
let diagnostic = { ffprobe: false, ffmpeg: false, platform: process.platform, electron: process.versions.electron };
function secureStorage() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
function settings(): Settings { return { tmdbConfigured: !!providers.tmdb, omdbConfigured: !!providers.omdb, secureStorage: secureStorage(), credentialStorage: credentials?.backend ?? 'local',reopenLastLibrary: computer.reopenLastLibrary,subtitleAppearance: computer.subtitleAppearance ?? defaultSubtitleAppearance,completedPercent: store?.setting('completedPercent',90) ?? 90, hideSpoilers: store?.setting('hideSpoilers',true) ?? true, autoScan: store?.setting('autoScan',true) ?? true, diagnostics: diagnostic }; }
function snapshot(): Snapshot {
  let library: LibraryInfo | null = null;
  if (store && !store.closed) library = { id: store.manifest.id,name: store.manifest.name,root: store.root,connected: true,sources: store.sources(),size: store.rows().filter(x => x.available).reduce((sum,x) => sum+x.size,0) };
  const value: Snapshot = { library,works: store && !store.closed ? store.works() : lastSnapshot?.works ?? [],history: store && !store.closed ? store.history() : lastSnapshot?.history ?? [],lists: store && !store.closed ? store.lists() : lastSnapshot?.lists ?? [],scan: scanner.state,player: player.state,settings: settings(),identification,error: startupError ?? (store?.removalCleanupPending ? 'Uma exclusão foi concluída, mas a limpeza dos vídeos temporários ainda está pendente. Reconecte a biblioteca para tentar novamente.' : undefined) };
  if (!store && lastSnapshot?.library) { value.library = { ...lastSnapshot.library,connected: false }; value.error = 'O SSD está desconectado. Reconecte a biblioteca para continuar.'; }
  if (store) lastSnapshot = value;
  return value;
}
async function requireStore() { if (!store || switching) throw new Error('Conecte uma biblioteca primeiro.'); await store.assertDisk(); return store; }
async function localConfig() { await saveComputerConfig(app.getPath('userData'),computer); }
function publishIdentification(value: typeof identification) { identification = value; emit({ type: 'identification',data: value }); emit({ type: 'changed' }); }
function startEnrichment(force = false) {
  if (enrichment) return enrichment;
  if (!store || switching || scanner.state.running) return Promise.resolve({ matched: 0,pending: 0 });
  const current = store;
  const task = providers.enrich(current,{ force,changed: publishIdentification });
  enrichment = task; operations.add(task);
  void task.catch(() => { /* Cancellation or disk errors are handled by the connection lifecycle. */ }).finally(() => {
    operations.delete(task); if (enrichment === task) enrichment = undefined;
    if (enrichmentRequested && !switching && !shuttingDown) scheduleEnrichment();
  });
  return task;
}
function scheduleEnrichment(force = false) {
  if (!store || switching || shuttingDown || (!providers.tmdb && !providers.omdb)) return;
  if (scanner.state.running || enrichment) { enrichmentRequested = true; enrichmentForce ||= force; return; }
  const shouldForce = force || enrichmentForce; enrichmentRequested = false; enrichmentForce = false;
  void startEnrichment(shouldForce).catch(() => {});
}
async function disconnect(lost = false) {
  if (removing) await removing.catch(() => {});
  const old = store; if (!old) return;
  switching = true;
  pendingDownloadScan = false;
  await downloads?.pauseRoot(old.root);
  enrichmentRequested = false; enrichmentForce = false;
  if (!lost) lastSnapshot = undefined;
  scanner.cancel(); providers.cancel(); await scanner.wait();
  await Promise.allSettled([...operations]);
  await player.stop(); store = null; await old.close(); identification = emptyIdentification(); switching = false;
  emit(lost ? { type: 'disconnected',message: 'O SSD ficou indisponível. As operações foram interrompidas; reconecte a biblioteca.' } : { type: 'changed' });
}
async function removeTitle(id: string): Promise<RemovalResult> {
  if (savingKeys || shuttingDown) throw new Error('A biblioteca está ocupada. Aguarde antes de excluir.');
  const current = await requireStore();
  let work = current.detail(id);
  current.removalPreview(id);
  let paths = work.files.map(file => file.path);
  downloads.assertNoPendingWork(current.root,work.title,work.metadata.originalTitle,paths,work.kind === 'series');
  switching = true;
  const resumeScan = scanner.state.running;
  enrichmentRequested = false; enrichmentForce = false;
  scanner.cancel(); providers.cancel();
  try {
    await scanner.wait(); await Promise.allSettled([...operations]);
    work = current.detail(id); paths = work.files.map(file => file.path);
    downloads.assertNoPendingWork(current.root,work.title,work.metadata.originalTitle,paths,work.kind === 'series');
    if (work.files.some(file => file.id === player.state.fileId)) { await player.checkpoint(); await player.stop(); }
    await current.assertDisk();
    const result = await removeLocalWork(current,id);
    current.removalCleanupPending ||= result.cleanupPending;
    try { await downloads.forgetRemovedFiles(current.root,paths); }
    catch { startupError = 'O título foi excluído, mas a atualização da fila de downloads não pôde ser salva.'; }
    identification = emptyIdentification();
    return result;
  } finally {
    switching = false; emit({ type: 'changed' });
    if (resumeScan || pendingDownloadScan) { pendingDownloadScan = false; void scanner.start(current); }
    else scheduleEnrichment();
  }
}
async function connect(root: string, expectedId?: string) {
  if (switching) throw new Error('A biblioteca está sendo desconectada. Aguarde.');
  if (store?.root === await Store.resolveRoot(root)) { emit({ type: 'changed' }); return snapshot(); }
  const next = await Store.open(root);
  if (expectedId && next.manifest.id !== expectedId) { await next.close(); throw new Error('A biblioteca no caminho lembrado foi trocada. Selecione a pasta novamente.'); }
  await disconnect(); store = next; lastRoot = next.root;
  computer = { ...computer,lastRoot,libraryId: next.manifest.id,libraryName: next.manifest.name }; startupError = undefined;
  await localConfig();
  if (!store.sources().length) store.addSource(store.root);
  emit({ type: 'changed' });
  if (store.setting('autoScan',true) && store.sources().length) void scanner.start(store);
  else scheduleEnrichment();
  return snapshot();
}
function register(name: string, handler: (...args: any[]) => unknown, tracked = false) {
  ipcMain.handle(`cine:${name}`,async (event,...args) => {
    const frame = event.senderFrame;
    if (event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame || !(frame.url.startsWith('cinessd://app/') || (process.env.CINESSD_DEV_URL && new URL(frame.url).origin === process.env.CINESSD_DEV_URL))) throw new Error('Origem IPC não autorizada.');
    const task = Promise.resolve().then(() => handler(...args));
    if (tracked) operations.add(task);
    try { return await task; }
    catch (error: any) {
      if (error instanceof z.ZodError) throw new Error('Os dados enviados não são válidos.');
      if (['ENOENT','EIO','ENODEV','ESTALE'].includes(error.code)) throw new Error('O arquivo ou SSD está indisponível. Verifique a conexão e faça uma varredura.');
      throw new Error(error.message || 'Não foi possível concluir a operação.');
    } finally { operations.delete(task); }
  });
}
function handlers() {
  const onlineType = z.enum(['movie','series']); const onlineId = z.string().min(1).max(500);
  register('addons',() => addons.list());
  register('installAddon',async url => { await addons.install(z.string().trim().max(12000).parse(url)); emit({ type: 'changed' }); },true);
  register('addon',async (action,id) => { await addons.change(z.enum(['remove','enable','disable']).parse(action),idSchema.parse(id)); emit({ type: 'changed' }); },true);
  register('configureAddon',async id => { await shell.openExternal(id === 'torrentio' ? 'https://torrentio.strem.fun/configure' : addons.configurationURL(idSchema.parse(id))); });
  register('onlineCatalog',(addonId,catalogId,type,query,skip,genre) => addons.catalog(idSchema.parse(addonId),onlineId.parse(catalogId),onlineType.parse(type),z.string().max(300).parse(query),z.number().int().min(0).max(10000).parse(skip),z.string().max(100).parse(genre)),true);
  register('onlineMeta',async (addonId,type,id) => {
    const item = await addons.meta(idSchema.parse(addonId),onlineType.parse(type),onlineId.parse(id));
    return { ...item,translationNote: item.metadataLanguage === 'pt-BR' ? undefined : providers.tmdb ? 'Sinopse em português indisponível no momento. Exibindo a descrição do catálogo.' : 'Configure o TMDB em Configurações → Configurar provedores para buscar sinopses em português.' };
  },true);
  register('onlineSources',(addonId,type,id,videoId) => addons.sources(idSchema.parse(addonId),onlineType.parse(type),onlineId.parse(id),onlineId.parse(videoId)),true);
  register('onlinePersonal',async (_addonId,type,id,personal) => { onlineStore.personal(onlineType.parse(type),onlineId.parse(id),personalSchema.parse(personal)); emit({ type: 'changed' }); });
  register('onlineSaved',() => addons.saved());
  register('planSeason',(addonId,id,season,sourceId) => addons.plan(idSchema.parse(addonId),onlineId.parse(id),z.number().int().min(0).max(1000).parse(season),idSchema.parse(sourceId)),true);
  register('downloadSource',async id => { const source = addons.source(idSchema.parse(id)); const target = await downloadTarget(); if (!target) return false; await enqueueDownloads(() => downloads.enqueue([source],target.root,target.manifest.id)); return true; });
  register('downloadSeason',async (id,selections) => { const sources = addons.planSources(idSchema.parse(id),z.record(z.string().max(500),idSchema).parse(selections)); const target = await downloadTarget(); if (!target) return false; await enqueueDownloads(() => downloads.enqueue(sources,target.root,target.manifest.id)); return true; });
  register('downloads',() => ({ jobs: downloads.list(),root: computer.downloadRoot ?? store?.root ?? '',torrentAvailable: downloads.available }));
  register('chooseDownloadFolder',async () => (await downloadTarget(true))?.root ?? null);
  register('downloadControl',async (action,id) => {
    if (switching) throw new Error('A biblioteca está ocupada. Aguarde antes de alterar os downloads.');
    const name = z.enum(['pause','resume','cancel','reveal']).parse(action); const jobId = idSchema.parse(id);
    if (name === 'reveal') { const job = downloads.list().find(j => j.id === jobId); if (!job) throw new Error('Download não encontrado.'); const directory = await existingPath(job.root,path.relative(job.root,job.directory)); if (job.state === 'completed') shell.showItemInFolder(await existingPath(job.root,path.relative(job.root,path.join(directory,job.fileName)))); else await shell.openPath(directory); }
    else await downloads.control(name,jobId);
  },true);
  register('snapshot',snapshot);
  register('chooseLibrary',async () => { const result = await dialog.showOpenDialog(window,{ title: 'Escolha o SSD ou a pasta da sua biblioteca',defaultPath: lastRoot || undefined,properties: ['openDirectory'],buttonLabel: 'Carregar minha biblioteca' }); return result.canceled ? null : connect(result.filePaths[0]); });
  register('disconnect',() => disconnect());
  register('addSource',async () => {
    const current = await requireStore();
    const result = await dialog.showOpenDialog(window,{ title: 'Adicione uma pasta de vídeos dentro do SSD',defaultPath: current.root,properties: ['openDirectory'],buttonLabel: 'Adicionar pasta' });
    if (result.canceled) return null;
    const absolute = await realpath(result.filePaths[0]); await current.assertDisk();
    current.addSource(absolute); emit({ type: 'changed' }); return relativePath(current.root,absolute);
  },true);
  register('scan',async () => { const current = await requireStore(); void scanner.start(current); });
  register('cancelScan',() => scanner.cancel());
  register('detail',async id => (await requireStore()).detail(idSchema.parse(id)));
  register('removalPreview',async id => {
    const current = await requireStore(); const workId = idSchema.parse(id);
    if (current.detail(workId).files.some(file => file.id === player.state.fileId)) await player.checkpoint();
    return current.removalPreview(workId);
  },true);
  register('removeWork',async id => {
    if (removing) throw new Error('Uma exclusão já está em andamento. Aguarde.');
    const task = removeTitle(idSchema.parse(id)); removing = task;
    try { return await task; } finally { if (removing === task) removing = undefined; }
  });
  register('personal',async (id,value) => { (await requireStore()).savePersonal(idSchema.parse(id),personalSchema.parse(value)); emit({ type: 'changed' }); });
  register('edit',async (id,value) => { (await requireStore()).edit(idSchema.parse(id),editSchema.parse(value)); emit({ type: 'changed' }); });
  register('play',async (id,restart) => { await player.play(await requireStore(),idSchema.parse(id),z.boolean().optional().parse(restart)); },true);
  register('control',async (action,value) => {
    const name = z.enum(['stop','pause','seek','volume','speed','audio','subtitle','fullscreen']).parse(action);
    if (['seek','volume','speed'].includes(name)) { value = z.number().finite().nonnegative().parse(value); if (name === 'volume' && value > 100 || name === 'speed' && (value < .25 || value > 4) || name === 'seek' && value > player.state.duration) throw new Error('Valor do controle inválido.'); }
    if (['audio','subtitle'].includes(name)) value = z.union([z.number().int().nonnegative(),z.enum(['no','auto'])]).parse(value);
    await player.control(name,value);
    if (name === 'fullscreen') window.setFullScreen(player.state.fullscreen);
  });
  register('playbackReport',async (token,position,ended,error) => player.report(idSchema.parse(token),z.number().finite().nonnegative().parse(position),z.boolean().parse(ended),z.boolean().optional().parse(error)));
  register('reveal',async id => { const current = await requireStore(); const file = current.file(idSchema.parse(id)); shell.showItemInFolder(await existingPath(current.root,file.path)); });
  register('searchMetadata',async (id,query) => { const current = await requireStore(); return providers.search(current.detail(idSchema.parse(id)),z.string().trim().min(1).max(300).parse(query)); },true);
  register('associate',async (id,candidate) => { const current = await requireStore(); await providers.associate(current,current.detail(idSchema.parse(id)),candidateSchema.parse(candidate)); emit({ type: 'changed' }); scheduleEnrichment(); },true);
  register('unmatch',async id => { (await requireStore()).unmatch(idSchema.parse(id)); emit({ type: 'changed' }); });
  register('loadSeason',async id => { const current = await requireStore(); await providers.season(current,current.detail(idSchema.parse(id))); emit({ type: 'changed' }); },true);
  register('enrich',async () => { await requireStore(); if (scanner.state.running) throw new Error('Aguarde a importação terminar para buscar metadados.'); return startEnrichment(true); });
  register('saveKeys',async (tmdb,omdb) => {
    if (savingKeys) throw new Error('As chaves estão sendo salvas. Aguarde.');
    savingKeys = true;
    try {
    const next = { tmdb: z.string().trim().max(4096).nullable().parse(tmdb) ?? providers.tmdb,omdb: z.string().trim().max(100).nullable().parse(omdb) ?? providers.omdb };
    await credentials.save(next);
    enrichmentRequested = false; enrichmentForce = false;
    providers.cancel(); await Promise.allSettled([...operations]);
    providers.tmdb = next.tmdb; providers.omdb = next.omdb; startupError = undefined;
    emit({ type: 'changed' });
    scheduleEnrichment(true);
    } finally { savingKeys = false; }
  });
  register('settings',async value => {
    const parsed = settingsSchema.parse(value);
    if (parsed.reopenLastLibrary !== undefined) { computer = { ...computer,reopenLastLibrary: parsed.reopenLastLibrary }; await localConfig(); }
    if (store) { const current = await requireStore(); current.transaction(() => { for (const [key,val] of Object.entries(parsed)) if (key !== 'reopenLastLibrary') current.setSetting(key,val); }); }
    emit({ type: 'changed' });
  });
  register('subtitleAppearance',async value => {
    computer = { ...computer,subtitleAppearance: subtitleAppearanceSchema.parse(value) };
    await localConfig(); emit({ type: 'changed' });
  });
  register('backup',async () => (await requireStore()).backup(),true);
  register('exportData',async () => {
    const current = await requireStore(); const data = current.exportData();
    const result = await dialog.showSaveDialog(window,{ title: 'Exportar avaliações e listas',defaultPath: 'cinessd-avaliacoes.json',filters: [{ name: 'JSON',extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    const target = result.filePath;
    if (/\.(mkv|mp4|avi|sqlite|exe|json)$/i.test(target) && path.resolve(target) === path.join(current.directory,'biblioteca.json')) throw new Error('Não substitua o manifesto da biblioteca.');
    if (current.rows().some(x => resolvePath(current.root,x.path) === path.resolve(target)) || path.resolve(target) === path.join(current.directory,'catalogo.sqlite')) throw new Error('Não substitua arquivos da biblioteca.');
    await writeFile(target,JSON.stringify(data,null,2)); return target;
  },true);
  register('list',async (action,id,value) => {
    const name = z.enum(['create','rename','delete','add','remove','move']).parse(action);
    const arg = name === 'create' ? z.string().trim().min(1).max(100).parse(id) : idSchema.parse(id);
    const extra = name === 'rename' ? z.string().trim().min(1).max(100).parse(value) : ['add','remove','move'].includes(name) ? idSchema.parse(value) : undefined;
    (await requireStore()).list(name,arg,extra); emit({ type: 'changed' });
  });
}
async function downloadTarget(choose = false): Promise<Store | null> {
  let root = choose ? undefined : computer.downloadRoot ?? store?.root;
  if (root && root !== store?.root) {
    try { const manifest = JSON.parse(await readFile(path.join(root,'Biblioteca','biblioteca.json'),'utf8')); if (manifest.id !== computer.downloadLibraryId) root = undefined; } catch { root = undefined; }
  }
  if (!root) {
    const result = await dialog.showOpenDialog(window,{ title: 'Escolha onde guardar os filmes e séries baixados',defaultPath: (computer.downloadRoot ?? lastRoot) || undefined,properties: ['openDirectory'],buttonLabel: 'Usar esta pasta' });
    if (result.canceled) return null; root = result.filePaths[0];
  }
  if (store?.root !== await realpath(root)) await connect(root);
  const target = await requireStore();
  computer = { ...computer,downloadRoot: target.root,downloadLibraryId: target.manifest.id }; await localConfig(); emit({ type: 'downloads' }); return target;
}
async function enqueueDownloads(action: () => Promise<void>) {
  if (switching || shuttingDown) throw new Error('A biblioteca está ocupada. Aguarde antes de iniciar downloads.');
  const task = action(); operations.add(task);
  try { await task; } finally { operations.delete(task); }
}
function executable(binary: string) { return new Promise<boolean>(resolve => { const child = spawn(binary,['-version'],{ stdio: 'ignore' }); child.on('error',() => resolve(false)); child.on('exit',code => resolve(code === 0)); setTimeout(() => { child.kill(); resolve(false); },3000).unref(); }); }
async function ready() {
  await mkdir(app.getPath('userData'),{ recursive: true });
  const [ffprobe,ffmpeg] = await Promise.all([executable(mediaTool('ffprobe')),executable(mediaTool('ffmpeg'))]); diagnostic = { ...diagnostic,ffprobe,ffmpeg };
  try { computer = await loadComputerConfig(app.getPath('userData')); lastRoot = computer.lastRoot; } catch (error: any) { startupError = error.message; }
  credentials = new Credentials(app.getPath('userData'),{ available: secureStorage,encrypt: value => safeStorage.encryptString(value),decrypt: value => safeStorage.decryptString(value) });
  try { const keys = await credentials.load(); providers.tmdb = keys.tmdb; providers.omdb = keys.omdb; } catch (error: any) { startupError = error.message; }
  onlineStore = new OnlineStore(app.getPath('userData')); addons = new Addons(credentials,onlineStore,item => providers.localizeOnline(item));
  try { await addons.initialize(); } catch (error: any) { startupError = error.message; }
  downloads = new Downloads(credentials,process.platform === 'win32' && app.isPackaged ? torrentWorker() : path.join(__dirname,'../torrent-worker.py'),() => emit({ type: 'downloads' }),root => {
    if (!store || store.root !== root || shuttingDown) return;
    if (switching) { pendingDownloadScan = true; return; }
    if (scanner.state.running) pendingDownloadScan = true; else void scanner.start(store);
  });
  try { await downloads.initialize(); } catch (error: any) { startupError = error.message; }
  if (lastRoot && computer.reopenLastLibrary) {
    try { const manifest = await rememberedManifest(computer); const error = startupError; await connect(lastRoot,manifest?.id); startupError = error; }
    catch {
      startupError = 'A última biblioteca não pôde ser reaberta. Conecte o SSD e selecione sua pasta novamente.';
      lastSnapshot = { ...snapshot(),library: { id: computer.libraryId ?? '',name: computer.libraryName ?? path.basename(lastRoot),root: lastRoot,connected: false,sources: [],size: 0 } };
    }
  }
  protocol.handle('cinessd',async request => {
    try {
      if (new URL(request.url).host === 'media') return await player.response(request);
      const url = new URL(request.url); const relative = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname === 'online-image') return addons.imageResponse(idSchema.parse(relative));
      let file: string;
      if (url.hostname === 'app') file = await existingPath(path.join(__dirname,'../renderer'),relative || 'index.html');
      else if (url.hostname === 'asset' && store && /^Biblioteca\/(?:capas|miniaturas)\/[a-zA-Z0-9_.-]+\.(jpg|png|webp)$/.test(relative)) file = await existingPath(store.root,relative);
      else return new Response('Não encontrado',{ status: 404 });
      return net.fetch(pathToFileURL(file).href);
    } catch { return new Response('Não encontrado',{ status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  window = new BrowserWindow({ width: 1440,height: 920,minWidth: 960,minHeight: 640,title: 'Umbra',backgroundColor: '#090b09',icon: path.join(__dirname,'../icon.png'),autoHideMenuBar: true,webPreferences: { preload: path.join(__dirname,'preload.cjs'),contextIsolation: true,nodeIntegration: false,sandbox: true,autoplayPolicy: 'no-user-gesture-required' } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate',event => event.preventDefault());
  window.on('enter-full-screen',() => player.setFullscreen(true));
  window.on('leave-full-screen',() => player.setFullscreen(false));
  handlers();
  const url = process.env.CINESSD_DEV_URL;
  if (url === 'http://127.0.0.1:5173') await window.loadURL(url); else await window.loadURL('cinessd://app/index.html');
  // First launch uses the picker; later launches restore only an existing, previously selected manifest.
  monitor = setInterval(async () => {
    if (!store || switching || checkingDisk) return;
    checkingDisk = true;
    try { await store.assertDisk(); } catch { await disconnect(true); } finally { checkingDisk = false; }
  },2000);
}
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit(); else {
  app.on('second-instance',() => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(ready).catch(error => { dialog.showErrorBox('Não foi possível iniciar Umbra',String(error.message)); app.quit(); });
  app.on('window-all-closed',() => app.quit());
  app.on('before-quit',event => {
    if (shuttingDown) return;
    event.preventDefault(); shuttingDown = true; if (monitor) clearInterval(monitor);
    addons?.cancel();
    void (downloads?.close() ?? Promise.resolve()).catch(() => {}).then(() => disconnect()).finally(() => { onlineStore?.close(); app.quit(); });
  });
}
