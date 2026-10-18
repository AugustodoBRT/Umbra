import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

export interface TorrentStreamSource {
  infoHash: string;
  fileIdx?: number;
  sources?: string[];
}

export interface TorrentStreamResult {
  url: string;
  port: number;
  fileName: string;
}

export interface TorrentStreamStatus {
  event?: string;
  state?: string;
  progress?: number;
  download_rate?: number;
  downloadRate?: number;
  num_peers?: number;
  numPeers?: number;
  downloaded?: number;
  total?: number;
  speed?: number;
  peers?: number;
  [key: string]: any;
}

export interface TorrentStreamerOptions {
  workerPath?: string;
  pythonPath?: string;
}

function getDirname(): string {
  try {
    if (typeof __dirname !== 'undefined') return __dirname;
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

export function resolveDefaultWorker(): string {
  const dir = getDirname();
  const candidates = [
    path.resolve(dir, 'torrent-worker.py'),
    path.resolve(dir, '../torrent-worker.py'),
    path.resolve(process.cwd(), 'dist/torrent-worker.py'),
    path.resolve(process.cwd(), 'src/downloads/torrent-worker.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return path.resolve(dir, 'torrent-worker.py');
}

export class TorrentStreamer extends EventEmitter {
  private child: ChildProcess | null = null;
  private workerPath: string;
  private pythonPath: string;
  private isStopping = false;
  private stopPromise?: Promise<void>;
  private currentStream: TorrentStreamResult | null = null;
  private lastStatus: TorrentStreamStatus | null = null;

  constructor(options?: TorrentStreamerOptions | string, pythonPath?: string) {
    super();
    if (typeof options === 'string') {
      this.workerPath = options;
      this.pythonPath = pythonPath || process.env.CINESSD_PYTHON || (process.platform === 'linux' ? 'python3' : 'python3');
    } else {
      const opts = options || {};
      this.workerPath = opts.workerPath || resolveDefaultWorker();
      this.pythonPath = opts.pythonPath || process.env.CINESSD_PYTHON || (process.platform === 'linux' ? 'python3' : 'python3');
    }
  }

  get isStreaming(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed && this.currentStream !== null;
  }

  get streamResult(): TorrentStreamResult | null {
    return this.currentStream;
  }

  get status(): TorrentStreamStatus | null {
    return this.lastStatus;
  }

  get process(): ChildProcess | null {
    return this.child;
  }

  async startStream(source: TorrentStreamSource): Promise<TorrentStreamResult> {
    if (!source || !source.infoHash) {
      throw new Error('infoHash é obrigatório para iniciar o stream de torrent.');
    }

    if (this.child) {
      await this.stopStream();
    }

    this.isStopping = false;
    this.currentStream = null;
    this.lastStatus = null;

    return new Promise<TorrentStreamResult>((resolve, reject) => {
      let isResolved = false;
      let lastErrorMessage: string | undefined;
      let stderrOutput = '';

      const isExe = this.workerPath.endsWith('.exe');
      const bin = isExe ? this.workerPath : this.pythonPath;
      const args = isExe ? [] : [this.workerPath];

      const child = spawn(bin, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      this.child = child;

      child.stdin?.on('error', () => {
        // Prevent EPIPE crashes if worker exits early
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderrOutput += chunk.toString();
        if (stderrOutput.length > 65536) {
          stderrOutput = stderrOutput.slice(-65536);
        }
      });

      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        if (buffer.length > 16_000_000) {
          buffer = '';
          return;
        }

        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;

          try {
            const data = JSON.parse(line);
            this.handleWorkerEvent(data, (result) => {
              if (!isResolved) {
                isResolved = true;
                this.currentStream = result;
                resolve(result);
              }
            }, (err) => {
              lastErrorMessage = err.message;
              if (!isResolved) {
                isResolved = true;
                try {
                  child.kill('SIGTERM');
                } catch {}
                this.cleanup();
                reject(err);
              }
            });
          } catch {
            // Non-JSON output (debug/log) is ignored
          }
        }
      });

      child.on('error', (err) => {
        const error = new Error(`Falha ao iniciar o worker Python (${bin}): ${err.message}`);
        lastErrorMessage = error.message;
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
        if (this.listenerCount('error') > 0) {
          this.emit('error', error);
        }
        this.cleanup();
      });

      child.on('exit', (code, signal) => {
        if (!isResolved) {
          isResolved = true;
          const detail = lastErrorMessage || stderrOutput.trim() || `Código de saída: ${code ?? signal ?? 'desconhecido'}`;
          reject(new Error(`O worker de streaming encerrou antes de iniciar. ${detail}`));
        } else if (!this.isStopping) {
          const unexpectedErr = new Error(`O worker de streaming encerrou inesperadamente (código: ${code ?? signal}).`);
          if (this.listenerCount('error') > 0) {
            this.emit('error', unexpectedErr);
          }
          this.emit('unexpected-exit', { code, signal });
        }
        this.cleanup();
      });

      // Send initial stream command via stdin
      const command = {
        action: 'stream',
        info_hash: source.infoHash,
        file_idx: source.fileIdx ?? 0,
        sources: source.sources ?? [],
      };

      try {
        child.stdin?.write(JSON.stringify(command) + '\n');
      } catch (err: any) {
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Falha ao enviar comando para o worker: ${err.message}`));
        }
      }
    });
  }

  private handleWorkerEvent(
    data: any,
    onReady: (result: TorrentStreamResult) => void,
    onError: (err: Error) => void
  ) {
    if (!data || typeof data !== 'object') return;

    if (data.event === 'ready') {
      const result: TorrentStreamResult = {
        url: String(data.url || `http://127.0.0.1:${data.port}/stream`),
        port: Number(data.port),
        fileName: String(data.file_name ?? data.fileName ?? ''),
      };
      onReady(result);
      this.emit('ready', result);
    } else if (data.event === 'status') {
      this.lastStatus = data;
      this.emit('status', data);
    } else if (data.event === 'error') {
      const errorMsg = data.message || data.error || 'Erro no motor de streaming de torrent.';
      const err = new Error(errorMsg);
      onError(err);
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    } else if (data.event) {
      this.emit(data.event, data);
    }
  }

  async stopStream(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    const child = this.child;
    if (!child || child.killed || child.exitCode !== null) {
      this.cleanup();
      return;
    }

    this.isStopping = true;

    this.stopPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          this.cleanup();
          this.emit('stop');
          resolve();
        }
      };

      child.once('exit', finish);

      // Attempt graceful termination via stdin
      try {
        if (child.stdin && child.stdin.writable) {
          child.stdin.write(JSON.stringify({ action: 'stop' }) + '\n', (err) => {
            if (err) {
              try { child.kill('SIGTERM'); } catch {}
            }
          });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try { child.kill('SIGTERM'); } catch {}
      }

      // Force kill fallback if not terminated in 2.5s
      const timer = setTimeout(() => {
        try {
          if (child.exitCode === null && !child.killed) {
            child.kill('SIGKILL');
          }
        } catch {}
        finish();
      }, 2500);
      if (timer.unref) timer.unref();
    }).finally(() => {
      this.stopPromise = undefined;
    });

    return this.stopPromise;
  }

  private cleanup() {
    this.child = null;
    this.isStopping = false;
    this.currentStream = null;
  }
}

export default TorrentStreamer;
