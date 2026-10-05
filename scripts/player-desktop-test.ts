import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { until } from '../tests/helpers';
import { mediaTool } from '../src/runtime/tools';
import { Credentials } from '../src/storage/credentials';
import { MpvIPC } from '../src/playback/mpv-ipc';
const directory=await mkdtemp(path.join(tmpdir(),'umbra-player-'));
const root=path.join(directory,'Coleção de teste — ação'),config=path.join(directory,'computer');
await mkdir(root);await mkdir(config);await mkdir('test-results',{recursive:true});
await new Credentials(config,{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}).saveDocument('addons',[]);
const subtitle=path.join(root,'captions.srt');await writeFile(subtitle,'1\n00:00:00,000 --> 00:00:40,000\nUma sessão dentro do Umbra.\n');
const ffmpeg=mediaTool('ffmpeg');
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=40','-f','lavfi','-i','sine=frequency=440:duration=40','-f','lavfi','-i','sine=frequency=880:duration=40','-i',subtitle,'-map','0:v','-map','1:a','-map','2:a','-map','3:s','-c:v','libx264','-pix_fmt','yuv420p','-c:a','ac3','-c:s','srt','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=por','-metadata:s:s:0','language=por',path.join(root,'Sessão Integrada (2026).mkv')],{windowsHide:true});
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=teal:size=640x360:rate=24:duration=4','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'Sessão Direta (2026).mp4')],{windowsHide:true});
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=navy:size=1920x1088:rate=8:duration=6','-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p10le','-x265-params','log-level=error:pools=2',path.join(root,'Sessão HEVC (2026).mkv')],{windowsHide:true});
let runtime: Awaited<ReturnType<typeof electron.launch>>|undefined,probe: MpvIPC|undefined;
const errors:string[]=[];let nativeLogs='';
const address=process.platform==='win32'?`\\\\.\\pipe\\umbra-test-${randomUUID()}`:path.join(directory,'ipc');
try {
 const packaged=process.env.UMBRA_PACKAGED_EXECUTABLE;
 runtime=await electron.launch({executablePath:packaged||process.env.CINESSD_ELECTRON||'/usr/bin/electron',args:[...(packaged?[]:[path.resolve('.')]),'--password-store=basic',...(process.platform==='linux'?['--ozone-platform=x11']:[])],env:Object.fromEntries(Object.entries({...process.env,CINESSD_DATA_DIR:config,CINESSD_MPV_IPC:address,CINESSD_MPV_AUDIO:'null'}).filter(([key])=>key.toUpperCase()!=='ELECTRON_RUN_AS_NODE')),timeout:60000});
 if(packaged) assert.equal(await runtime.evaluate(({app})=>app.getVersion()),JSON.parse(await readFile('package.json','utf8')).version);
 runtime.process().stderr?.on('data',data=>{nativeLogs=(nativeLogs+data).slice(-6000);});
 const page=await runtime.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.evaluate(()=>{(window as any).nativeInputs=[];window.cine.onEvent(event=>{if(event.type==='player-input'){(window as any).nativeInputs.push(event.action);if((window as any).nativeInputs.length>40)(window as any).nativeInputs.shift();}});});
 const capture=async(name:string)=>{
  if(process.platform==='linux' && process.env.CINESSD_CAPTURE_VIRTUAL_SCREEN==='1'){
   const size=await runtime!.evaluate(({screen})=>screen.getPrimaryDisplay().size);
   execFileSync(ffmpeg,['-v','error','-y','-f','x11grab','-video_size',`${size.width}x${size.height}`,'-i',process.env.DISPLAY!,'-frames:v','1','test-results/'+name],{windowsHide:true});return;
  }
  // OS window capture includes the native video child; webContents screenshots do not.
  try {const data=await runtime!.evaluate(async({desktopCapturer,BrowserWindow},isolated)=>{const win=BrowserWindow.getAllWindows()[0],sources=await desktopCapturer.getSources({types:isolated?['screen']:['window'],thumbnailSize:{width:1600,height:1000}});const source=isolated?sources[0]:sources.find(x=>x.id===win.getMediaSourceId());return source?.thumbnail.toPNG().toString('base64');},process.env.CINESSD_CAPTURE_VIRTUAL_SCREEN==='1');if(data){await writeFile('test-results/'+name,Buffer.from(data,'base64'));return;}}catch{}
  await page.screenshot({path:'test-results/'+name});
 };
 await page.getByRole('button',{name:'Umbra, início'}).waitFor();
 await runtime.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},root);
 await page.getByRole('button',{name:'Início',exact:true}).click();await page.getByRole('button',{name:'Conectar minha biblioteca',exact:true}).click();
 await until(async()=>{const s=await page.evaluate(()=>window.cine.snapshot());return !!s.library?.connected&&!s.scan.running&&s.works.length===3;},30000);
 const snapshot=()=>page.evaluate(()=>window.cine.snapshot());
 const file=(await snapshot()).works.find(x=>x.title.includes('Integrada'))!.files[0];
 await page.evaluate(id=>window.cine.play(id),file.id);
 await until(async()=>{const s=await snapshot();return s.player.engine==='mpv'&&!!s.player.video&&s.player.position>1&&!s.player.error;},30000);
 probe=new MpvIPC();await probe.connect(address,()=>true);
 const surface=await page.locator('.native-video-surface').evaluate(element=>{const r=element.getBoundingClientRect();return{width:Math.round(r.width*devicePixelRatio),height:Math.round(r.height*devicePixelRatio)};});
 await until(async()=>{const dimensions=await probe!.command('get_property','osd-dimensions');return Math.abs(dimensions.w-surface.width)<=2&&Math.abs(dimensions.h-surface.height)<=2;});
 assert.match(await probe.command('get_property','video-codec'),/H\.264|h264/i);assert.equal(await probe.command('get_property','audio-codec-name'),'ac3');
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 const tracks=(await snapshot()).player.tracks,audio=tracks.filter(x=>x.type==='audio');assert.equal(audio.length,2);
 const sub=tracks.find(x=>x.type==='subtitle')!;
 await page.getByRole('combobox',{name:'Faixa de áudio'}).selectOption(String(audio[1].id));await page.getByRole('combobox',{name:'Faixa de legenda'}).selectOption(String(sub.id));
 await page.evaluate(()=>window.cine.control('seek',5));
 await until(async()=>Math.abs(Number(await probe!.command('get_property','time-pos'))-5)<.15);
 assert.equal(await probe.command('get_property','aid'),audio[1].id);assert.equal(await probe.command('get_property','sid'),sub.id);
 await page.evaluate(()=>window.cine.control('volume',35));await page.getByRole('combobox',{name:'Velocidade'}).selectOption('1.5');
 assert.equal(await probe.command('get_property','volume'),35);assert.equal(await probe.command('get_property','speed'),1.5);assert.equal(await probe.command('get_property','pause'),true);
 await page.getByRole('button',{name:'Ajustar legenda'}).click();await page.getByRole('slider',{name:'Tamanho da legenda'}).fill('36');await page.getByLabel('Cor da legenda',{exact:true}).fill('#ffe066');await page.getByRole('combobox',{name:'Fundo da legenda'}).selectOption('none');await page.getByRole('checkbox',{name:'Contorno escuro'}).uncheck();await page.getByRole('slider',{name:'Altura da legenda'}).fill('12');await page.getByRole('slider',{name:'Sincronização da legenda'}).fill('0.5');
 await page.getByRole('button',{name:'Fechar ajustes de legenda'}).click();
 const appearance={fontSize:36,color:'#ffe066',background:'none',outline:false,bottom:12};
 await until(async()=>JSON.stringify(JSON.parse(await readFile(path.join(config,'library.json'),'utf8')).subtitleAppearance)===JSON.stringify(appearance));
 assert.equal(await probe.command('get_property','sub-delay'),.5);assert.equal(await probe.command('get_property','sub-font-size'),36);
 await probe.command('screenshot-to-file',path.resolve('test-results/24-native-mpv-frame.png'),'subtitles');await capture('19-player-integrado.png');
 if(process.env.CINESSD_CAPTURE_VIRTUAL_SCREEN==='1'){
  const pixels=await readFile('test-results/19-player-integrado.png');
  const colored=await runtime.evaluate(({nativeImage},base64)=>{const data=nativeImage.createFromBuffer(Buffer.from(base64,'base64')).toBitmap();let count=0;for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>100)count++;return count;},pixels.toString('base64'));
  assert.ok(colored>20000,'The real desktop must contain the native video image, not just an empty HTML surface.');
 }
 await page.getByRole('button',{name:'Tela cheia do player'}).click();await until(()=>runtime!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()));
 await page.getByRole('button',{name:'Tela cheia do player'}).hover();await page.waitForFunction(()=>document.querySelector('.embedded-player')?.classList.contains('controls-hidden'),{},{timeout:7000});
 const layout=await page.locator('.native-video-surface').evaluate(element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,w:innerWidth,h:innerHeight};});
 assert.equal(layout.x,0);assert.equal(layout.y,0);assert.equal(layout.width,layout.w);assert.equal(layout.height,layout.h);
 await capture('21-fullscreen-video.png');
 // Input comes from mpv's own native window, not from an HTML video element.
 await until(async()=>{await probe!.command('script-message','umbra-input','move');return page.evaluate(()=>!document.querySelector('.embedded-player')?.classList.contains('controls-hidden'));});
 await capture('20-fullscreen-controls.png');
 await probe.command('keypress','F11');await until(async()=>!(await runtime!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())));
 await page.keyboard.press('F11');await until(()=>runtime!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()));
 await page.waitForFunction(()=>document.querySelector('.embedded-player')?.classList.contains('fullscreen'));
 await probe.command('keypress','ESC');await until(async()=>!(await runtime!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())));
 await page.getByRole('button',{name:'Minimizar player'}).click();assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement).overflow),'hidden');await page.getByRole('button',{name:'Expandir player'}).click();
 await page.getByRole('button',{name:'Encerrar reprodução'}).click();probe.close();probe=undefined;
 assert.ok((await snapshot()).works.find(x=>x.files.some(f=>f.id===file.id))!.files[0].position>=4.9);
 await page.evaluate(id=>window.cine.play(id),file.id);await page.evaluate(()=>window.cine.control('pause'));
 const resumed=(await snapshot()).player;assert.equal(resumed.audio,audio[1].id);assert.equal(resumed.subtitle,sub.id);assert.equal(resumed.subtitleDelay,.5);assert.ok(resumed.position>=4.9);
 await page.evaluate(()=>window.cine.control('stop'));
 const hevc=(await snapshot()).works.flatMap(x=>x.files).find(x=>x.path.includes('HEVC'))!;await page.evaluate(id=>window.cine.play(id),hevc.id);await page.evaluate(()=>window.cine.control('pause'));
 await until(async()=>(await snapshot()).player.video?.height===1088);assert.equal((await snapshot()).player.video!.codec,'hevc');assert.match((await snapshot()).player.video!.pixelFormat,/10/);await page.evaluate(()=>window.cine.control('stop'));
 const direct=(await snapshot()).works.find(x=>x.title.includes('Direta'))!.files[0];await page.evaluate(id=>window.cine.play(id),direct.id);await until(async()=>!(await snapshot()).player.active,10000);assert.equal((await snapshot()).works.find(x=>x.files.some(f=>f.id===direct.id))!.files[0].completed,true);
 await page.evaluate(id=>window.cine.play(id),file.id);const work=(await snapshot()).works.find(x=>x.files.some(f=>f.id===file.id))!;await page.evaluate(id=>window.cine.removeWork(id),work.id);await assert.rejects(stat(path.join(root,file.path)),{code:'ENOENT'});
 assert.deepEqual(errors,[]);console.log('PLAYER OK: embedded native mpv, H264/MP4/MKV, AC3 dual audio, HEVC 10-bit above 1080p, subtitles, exact seek, volume, speed, subtitle delay/settings persistence, native fullscreen/input, resume, completion and release of Windows file handles.');
}catch(error){console.error(error,errors,nativeLogs);if(runtime)try{const page=await runtime.firstWindow();console.log(JSON.stringify((await page.evaluate(()=>window.cine.snapshot())).player));console.log('Native inputs',await page.evaluate(()=>(window as any).nativeInputs));await page.screenshot({path:'test-results/player-failure.png'});}catch{}throw error;}finally{probe?.close();await runtime?.close();await rm(directory,{recursive:true,force:true});}
