import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TorrentStreamer } from '../src/downloads/streamer';
import { until } from './helpers';

test('TorrentStreamer validações básicas e ciclo de vida inativo', async () => {
  const streamer = new TorrentStreamer();
  assert.equal(streamer.isStreaming, false);
  assert.equal(streamer.streamResult, null);
  assert.equal(streamer.status, null);

  // Deve rejeitar quando infoHash não for informado
  await assert.rejects(
    streamer.startStream({ infoHash: '' }),
    /infoHash é obrigatório/
  );

  // Parar quando não há stream ativo deve resolver sem erro
  await assert.doesNotReject(async () => {
    await streamer.stopStream();
  });
  assert.equal(streamer.isStreaming, false);
});

test('TorrentStreamer falha ao iniciar com executável ou worker inválido', async () => {
  const streamer = new TorrentStreamer({
    workerPath: path.resolve('src/downloads/non-existent-worker.py'),
    pythonPath: 'non-existent-python-bin-xyz',
  });

  await assert.rejects(
    streamer.startStream({ infoHash: 'a'.repeat(40) }),
    /Falha ao iniciar o worker Python|O worker de streaming encerrou antes de iniciar/
  );
  assert.equal(streamer.isStreaming, false);
});

test('TorrentStreamer streaming real: servidor HTTP, Range requests e ciclo de vida', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cine-stream-test-'));
  const seedDir = path.join(directory, 'seed');
  await mkdir(seedDir);

  // Cria um arquivo de teste de 64KB com bytes pseudo-aleatórios determinísticos
  const fileSize = 64 * 1024;
  const fileContent = Buffer.alloc(fileSize);
  for (let i = 0; i < fileSize; i++) {
    fileContent[i] = (i * 31 + 7) & 0xff;
  }
  const videoFileName = 'SampleMovie.2026.1080p.mkv';
  await writeFile(path.join(seedDir, videoFileName), fileContent);

  // Script do seeder usando libtorrent em Python
  const seedScript = path.join(directory, 'seeder.py');
  await writeFile(
    seedScript,
    `import sys, json, time, libtorrent as lt
root = sys.argv[1]
files = lt.file_storage()
files.add_file('${videoFileName}', ${fileSize})
t = lt.create_torrent(files, 16384, lt.create_torrent.v1_only)
lt.set_piece_hashes(t, root)
ti = lt.torrent_info(t.generate())
s = lt.session({
    'listen_interfaces': '127.0.0.1:0',
    'enable_dht': False,
    'enable_lsd': False,
    'enable_upnp': False,
    'enable_natpmp': False,
    'allow_multiple_connections_per_ip': True
})
p = lt.add_torrent_params()
p.ti = ti
p.save_path = root
p.flags |= lt.torrent_flags.seed_mode
p.flags &= ~lt.torrent_flags.paused
h = s.add_torrent(p)
while not s.listen_port():
    time.sleep(0.05)
print(json.dumps({'hash': str(ti.info_hashes().v1), 'port': s.listen_port()}), flush=True)

import threading
stop = threading.Event()
def watch():
    sys.stdin.readline()
    stop.set()
threading.Thread(target=watch, daemon=True).start()
while not stop.wait(0.5):
    pass
`
  );

  const pythonBin = process.platform === 'linux' ? '/usr/bin/python' : 'python3';
  const seeder = spawn(pythonBin, ['-u', seedScript, seedDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let seedOutput = '';
  let seedError = '';
  seeder.stdout.on('data', (d) => { seedOutput += d; });
  seeder.stderr.on('data', (d) => { seedError += d; });

  const streamer = new TorrentStreamer({
    workerPath: path.resolve('src/downloads/torrent-worker.py'),
    pythonPath: pythonBin,
  });

  try {
    await until(() => seedOutput.includes('\n') || seeder.exitCode !== null, 10000);
    assert.equal(seeder.exitCode, null, `Falha no seeder: ${seedError}`);
    const seedInfo = JSON.parse(seedOutput.trim());

    // Inicia o stream apontando para o peer local do seeder
    const streamPromise = streamer.startStream({
      infoHash: seedInfo.hash,
      sources: [`peer:127.0.0.1:${seedInfo.port}`],
    });

    const streamResult = await streamPromise;
    assert.ok(streamResult.url, 'Deve retornar a URL de streaming');
    assert.ok(streamResult.port > 0, 'Porta deve ser válida');
    assert.equal(streamResult.fileName, videoFileName);
    assert.equal(streamer.isStreaming, true);

    // 1. Teste HEAD: verifica cabeçalhos HTTP
    const headRes = await fetch(streamResult.url, { method: 'HEAD' });
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(Number(headRes.headers.get('content-length')), fileSize);
    assert.match(headRes.headers.get('content-type') || '', /matroska|octet-stream/);

    // 2. Teste Range request inicial (bytes=0-1023)
    const range1Res = await fetch(streamResult.url, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(range1Res.status, 206);
    assert.equal(range1Res.headers.get('content-range'), `bytes 0-1023/${fileSize}`);
    assert.equal(Number(range1Res.headers.get('content-length')), 1024);
    const range1Buf = Buffer.from(await range1Res.arrayBuffer());
    assert.deepEqual(range1Buf, fileContent.subarray(0, 1024));

    // 3. Teste Range request intermediário com seek (bytes=8192-16383)
    const range2Res = await fetch(streamResult.url, {
      headers: { Range: 'bytes=8192-16383' },
    });
    assert.equal(range2Res.status, 206);
    assert.equal(range2Res.headers.get('content-range'), `bytes 8192-16383/${fileSize}`);
    assert.equal(Number(range2Res.headers.get('content-length')), 8192);
    const range2Buf = Buffer.from(await range2Res.arrayBuffer());
    assert.deepEqual(range2Buf, fileContent.subarray(8192, 16384));

    // 4. Teste Range request final (tail / fim do arquivo: bytes=61440-65535)
    const range3Res = await fetch(streamResult.url, {
      headers: { Range: `bytes=${fileSize - 4096}-${fileSize - 1}` },
    });
    assert.equal(range3Res.status, 206);
    assert.equal(range3Res.headers.get('content-range'), `bytes ${fileSize - 4096}-${fileSize - 1}/${fileSize}`);
    const range3Buf = Buffer.from(await range3Res.arrayBuffer());
    assert.deepEqual(range3Buf, fileContent.subarray(fileSize - 4096, fileSize));

    // 5. Teste Range inválido além do tamanho do arquivo (status 416)
    const invalidRangeRes = await fetch(streamResult.url, {
      headers: { Range: `bytes=${fileSize + 1000}-${fileSize + 2000}` },
    });
    assert.equal(invalidRangeRes.status, 416);

    // 6. Teste de status recebido pelo streamer
    await until(() => streamer.status !== null, 5000);
    assert.ok(streamer.status !== null, 'Status deve ter sido emitido');

    // 7. Teste de encerramento do stream
    await streamer.stopStream();
    assert.equal(streamer.isStreaming, false);
    assert.equal(streamer.streamResult, null);

    // Conexões subsequentes à URL devem falhar pois o servidor foi fechado
    await assert.rejects(
      fetch(streamResult.url, { signal: AbortSignal.timeout(1000) })
    );
  } finally {
    await streamer.stopStream().catch(() => {});
    seeder.stdin?.write('\n');
    seeder.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
