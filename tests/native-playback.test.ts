import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,rm,mkdtemp,stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { library,until,media } from './helpers';
import { Scanner } from '../src/library/scanner';
import { NativePlayer } from '../src/playback/native';
import { defaultSubtitleAppearance } from '../src/shared/subtitles';
import { mpvTool,mediaTool } from '../src/runtime/tools';

test('mpv plays HEVC 10-bit above 1080p with AC3 and native ASS, exact seek and persisted preferences',async () => {
  const {root,store}=await library();
  const player=new NativePlayer(() => {},{mpv:mpvTool(),host:'',parent:()=>'0',appearance:()=>defaultSubtitleAppearance,input:()=>{},headless:true});
  try {
    const subtitle=path.join(root,'captions.ass');
    await writeFile(subtitle,'[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1088\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,36,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,{\\i1}Legenda ASS nativa\n');
    const video=path.join(root,'Filmes','Ação — HEVC (2026).mkv');
    execFileSync(mediaTool('ffmpeg'),['-nostdin','-v','error','-f','lavfi','-i','color=navy:size=1920x1088:rate=8:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4','-f','lavfi','-i','sine=frequency=880:duration=4','-i',subtitle,'-map','0:v','-map','1:a','-map','2:a','-map','3:s','-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p10le','-x265-params','log-level=error:pools=2','-c:a','ac3','-c:s','ass','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=por','-metadata:s:s:0','language=por',video],{windowsHide:true});
    await new Scanner(()=>{}).start(store); const file=store.works()[0].files[0];
    await player.play(store,file.id);await player.control('pause');
    await until(()=>!!player.state.video);
    assert.equal(player.state.engine,'mpv');assert.equal(player.state.source,undefined);
    assert.equal(player.state.video!.height,1088);assert.equal(player.state.video!.codec,'hevc');assert.match(player.state.video!.pixelFormat,/10/);
    const audio=player.state.tracks.filter(x=>x.type==='audio');assert.equal(audio.length,2);assert.ok(audio.every(x=>x.codec==='ac3'));
    const sub=player.state.tracks.find(x=>x.type==='subtitle')!;assert.equal(sub.codec,'ass');
    await player.control('audio',audio[1].id);await player.control('subtitle',sub.id);await player.control('subtitleDelay',.5);
    await player.control('seek',2.25);await player.checkpoint();await player.stop();
    assert.ok(Math.abs(store.file(file.id).position-2.25)<.2);assert.equal(store.file(file.id).completed,false);
    await player.play(store,file.id);await player.control('pause');
    assert.equal(player.state.audio,audio[1].id);assert.equal(player.state.subtitle,sub.id);assert.equal(player.state.subtitleDelay,.5);
    assert.ok(Math.abs(player.state.position-2.25)<.3);
    await player.stop();const sessions=store.detail(store.works()[0].id).sessions!;
    assert.equal(sessions.length,2);assert.ok(sessions.every(x=>x.endedAt));
    assert.ok(sessions.every(x=>x.watchedSeconds<1),'Seeking must not count as watched time.');
  } finally {await player.stop();await store.close();await rm(root,{recursive:true,force:true});}
});

test('failed mpv or surface startup closes the session without hanging, allowing a retry',{timeout:15000},async()=>{
 const {root,store}=await library();
 const options={mpv:mpvTool(),host:path.join(root,'missing-surface'),parent:()=>'1',appearance:()=>defaultSubtitleAppearance,input:()=>{}};
 try {
  media(path.join(root,'Filmes','Teste (2026).mp4'),'teal',3);await new Scanner(()=>{}).start(store);const file=store.works()[0].files[0];
  for(const override of [{mpv:path.join(root,'missing-mpv'),headless:true},{headless:false}]){
   const player=new NativePlayer(()=>{},{...options,...override});
   await assert.rejects(player.play(store,file.id));assert.equal(player.state.active,false);await player.stop();
  }
  const retry=new NativePlayer(()=>{},{...options,headless:true});
  try{await retry.play(store,file.id);assert.equal(retry.state.engine,'mpv');}finally{await retry.stop();}
  assert.ok(store.detail(store.works()[0].id).sessions!.every(x=>x.endedAt));
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test('playStream plays HTTP streaming directly without Store, manages events, and executes onStop on teardown',async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'stream-test-'));
  const filePath = path.join(dir,'video.mp4');
  media(filePath,'teal',4);
  const size = (await stat(filePath)).size;
  const server = createServer((req,res) => {
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : size-1;
      res.writeHead(206,{
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end-start+1,
        'Content-Type': 'video/mp4'
      });
      createReadStream(filePath,{ start,end }).pipe(res);
    } else {
      res.writeHead(200,{
        'Content-Length': size,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes'
      });
      createReadStream(filePath).pipe(res);
    }
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/video.mp4`;

  let stopped = false;
  let playerStateHistory: any[] = [];
  const player = new NativePlayer(
    state => playerStateHistory.push({ ...state }),
    { mpv: mpvTool(),host: '',parent: () => '0',appearance: () => defaultSubtitleAppearance,input: () => {},headless: true }
  );

  try {
    await player.playStream(url,'Transmissão Ao Vivo',{
      streamId: 'stream-test-42',
      onStop: () => { stopped = true; }
    });

    assert.equal(player.state.engine,'mpv');
    assert.equal(player.state.active,true);
    assert.equal(player.state.title,'Transmissão Ao Vivo');
    assert.equal(player.state.fileId,'stream-test-42');

    await until(() => !!player.state.video && player.state.duration > 0);
    assert.ok(player.state.duration > 3);
    assert.ok(player.state.tracks.length > 0);

    await until(() => !player.state.paused);
    // Test pause / unpause
    await player.control('pause');
    await until(() => player.state.paused === true);
    assert.equal(player.state.paused,true);
    await player.control('pause');
    await until(() => player.state.paused === false);
    assert.equal(player.state.paused,false);

    // Test volume and mute
    await player.control('volume',65);
    assert.equal(player.state.volume,65);
    await player.control('mute',true);
    assert.equal(player.state.mute,true);
    await player.control('mute',false);
    assert.equal(player.state.mute,false);

    // Test stop executes onStop
    assert.equal(stopped,false);
    await player.stop();
    assert.equal(stopped,true);
    assert.equal(player.state.active,false);
  } finally {
    await player.stop();
    server.close();
    await rm(dir,{ recursive: true,force: true });
  }
});

