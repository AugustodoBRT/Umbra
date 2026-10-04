import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceDetails, sourceLanguages, readableSourceText } from '../src/shared/sourceDetails';

test('idiomas do Torrentio permanecem indícios; bandeiras não inventam faixas de áudio ou legenda',() => {
  const details = sourceDetails({ name: '[RD+] Torrentio\n1080p',title: 'Backrooms.2026.bluray.sdr.1080p.av1.5.1.opus.subs-Dust\n👤 113 💾 3.45 GB ⚙️ ThePirateBay\n🇧🇷 / 🇬🇧 / 🇫🇷 / 🇮🇳',behaviorHints: { filename: 'Backrooms.2026.bluray.sdr.1080p.av1.5.1.opus.subs-Dust.mkv' } });
  assert.equal(details.size,'3,45 GB'); assert.equal(details.seeders,113);
  assert.deepEqual(details.audio,[]); assert.deepEqual(details.subtitles,[]);
  assert.deepEqual(details.languages.map(language => language.code),['pt-BR','en','fr','region-IN']);
  assert.ok(details.quality.includes('1080p') && details.quality.includes('AV1') && details.quality.includes('5.1'));
  assert.match(details.languages.at(-1)!.label,/não especificado/);
  assert.deepEqual(sourceLanguages('It (2017) WEB-DL ID-GROUP.mkv'),[]);
  assert.equal(sourceDetails({ title: 'Arquivo sem detalhes' }).seeders,null);
  assert.equal(sourceDetails({ title: 'Arquivo\n👤 0' }).seeders,0);
});
test('áudio e legendas explicitamente anunciados ficam separados; links privados não são expostos nos detalhes',() => {
  const details = sourceDetails({ title: 'Filme.Dual.Audio.1080p.mkv\nÁudio: 🇧🇷 / eng\nLegendas: Português / Francês',subtitles: [{ lang: 'pt-BR',url: 'https://example.com/private?token=secret' },{ lang: 'en',url: 'http://localhost:11470/private' },{ lang: 'und' },null],behaviorHints: { videoSize: 2*1024**3 } });
  assert.deepEqual(details.audio.map(language => language.code),['pt-BR','en']);
  assert.deepEqual(details.subtitles.map(language => language.code),['pt','fr','pt-BR','en']);
  assert.equal(details.audioNote,'Áudio duplo anunciado'); assert.equal(details.linkedSubtitles,true);
  assert.equal(details.size,'2 GB'); assert.ok(!JSON.stringify(details).includes('secret')); assert.ok(!JSON.stringify(details).includes('11470'));
  const unknown = sourceDetails({ title: 'Filme.Dual.Audio.Multi.Subs.mkv' });
  assert.deepEqual(unknown.audio,[]); assert.deepEqual(unknown.subtitles,[]); assert.equal(unknown.subtitleNote,'Múltiplas legendas anunciadas');
});
test('descrição legível substitui os emojis do provedor e conserva o texto',() => {
  const description = readableSourceText('Vídeo.mkv\n👤 12 💾 2 GB ⚙️ Provedor\n🇧🇷 / 🇬🇧');
  assert.match(description,/Pessoas compartilhando: 12/); assert.match(description,/Português \(Brasil\)/); assert.match(description,/Inglês/);
  assert.ok(!/[\p{Regional_Indicator}\p{Extended_Pictographic}]/u.test(description));
});
