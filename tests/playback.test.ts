import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { library, media } from './helpers';
import { Scanner } from '../src/library/scanner';
import { EmbeddedPlayer, shiftWebVTT } from '../src/playback/embedded';

test('embedded playback: conversion, seek, session persistence, stale reports and end',async () => {
  const { root,store } = await library(); const player = new EmbeddedPlayer(() => {});
  try {
    media(path.join(root,'Filmes','Sessão de teste (2026).mp4'));
    await new Scanner(() => {}).start(store); const file = store.works()[0].files[0];
    await player.play(store,file.id); assert.equal(player.state.source?.mode,'stream');
    const first = player.state.source!;
    const response = await player.response(new Request(first.url));
    const converted = Buffer.from(await response.arrayBuffer()); assert.ok(converted.length > 1000); assert.equal(converted.toString('ascii',4,8),'ftyp');
    await player.control('pause'); await player.control('seek',2);
    await player.report(first.token,4,false); assert.equal(player.state.position,2);
    await player.control('volume',30); await player.control('speed',2);
    await player.stop(); assert.ok(store.file(file.id).position >= 1.9);
    await player.play(store,file.id); assert.equal(player.state.position,2);
    await player.report(player.state.source!.token,5,true);
    assert.equal(player.state.active,false); assert.ok(store.file(file.id).completed);
    const sessions = store.detail(store.works()[0].id).sessions!; assert.equal(sessions.length,2); assert.ok(sessions.every(x => x.endedAt !== null));
  } finally { await player.stop(); await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('native playback uses authenticated byte ranges and external subtitles',async () => {
  const { root,store } = await library(); const player = new EmbeddedPlayer(() => {});
  try {
    const video = path.join(root,'Filmes','Native (2026).mp4');
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=navy:s=320x180:d=3','-c:v','libx264','-pix_fmt','yuv420p',video]);
    await writeFile(video.replace('.mp4','.pt.srt'),'1\n00:00:00,500 --> 00:00:02,500\nUma legenda em português.\n');
    await new Scanner(() => {}).start(store); await player.play(store,store.works()[0].files[0].id);
    assert.equal(player.state.source?.mode,'file'); const url = player.state.source!.url;
    const range = await player.response(new Request(url,{ headers: { range: 'bytes=0-11' } }));
    assert.equal(range.status,206); assert.equal((await range.arrayBuffer()).byteLength,12);
    assert.match(range.headers.get('content-range')! ,/^bytes 0-11\//);
    assert.equal((await player.response(new Request(url,{ headers: { range: 'bytes=999999999-' } }))).status,416);
    assert.equal((await player.response(new Request(url.replace(player.state.source!.token,'wrong')))).status,404);
    const track = player.state.tracks.find(x => x.type === 'subtitle')!; await player.control('subtitle',track.id);
    const subtitle = await player.response(new Request(player.state.source!.subtitleUrl!)); assert.match(await subtitle.text(),/WEBVTT[\s\S]*Uma legenda em português/);
    await player.control('subtitle','no'); assert.equal(player.state.source?.subtitleUrl,undefined);
  } finally { await player.stop(); await store.close(); await rm(root,{ recursive: true,force: true }); }
});
test('WebVTT seeks discard past cues and keep overlapping cues',() => {
  const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPassada\n\n00:00:02.500 --> 00:00:04.000\nAtual\n\n00:00:06.000 --> 00:00:07.000\nFutura';
  const result = shiftWebVTT(source,3); assert.ok(!result.includes('Passada')); assert.match(result,/00:00:00.000 --> 00:00:01.000/); assert.match(result,/00:00:03.000 --> 00:00:04.000/);
});
