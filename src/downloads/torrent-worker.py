"""One active selected file; JSON stdin/stdout only. System libtorrent, no shell."""
import base64
import ctypes
import http.server
import json
import mimetypes
import os
import queue
import re
import shutil
import signal
import socket
import sys
import tempfile
import threading
import time


def emit(event, **value):
    print(json.dumps(dict(event=event, **value)), flush=True)


def publish(source, target):
    # Linux renameat2 works on exFAT too, without overwriting an existing video.
    if sys.platform.startswith('linux'):
        libc = ctypes.CDLL(None, use_errno=True)
        result = libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1)
        if result != 0:
            raise OSError(ctypes.get_errno(), 'Não foi possível concluir o arquivo sem substituir outro.')
    elif sys.platform == 'win32':
        os.rename(source, target)
    else:
        os.link(source, target)
        os.unlink(source)


if len(sys.argv) > 1 and sys.argv[1] == '--publish':
    try:
        # Electron sends UTF-8 bytes, regardless of the Windows ANSI pipe encoding.
        request = json.loads(sys.stdin.buffer.readline())
        publish(request['source'], request['target'])
        emit('published')
    except Exception:
        emit('error', message='O arquivo de destino já existe ou não foi possível concluir o download.')
        sys.exit(1)
    sys.exit(0)

try:
    import libtorrent as lt
except ImportError:
    emit('error', message='O motor de torrents não está disponível. Instale python-libtorrent no sistema.')
    sys.exit(1)

if len(sys.argv) > 1 and sys.argv[1] == '--check':
    emit('available', version=lt.__version__)
    sys.exit(0)

initial_job = None
if len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
    try:
        initial_job = json.loads(sys.argv[1])
    except Exception:
        pass
elif len(sys.argv) > 2 and sys.argv[1] == '--stream':
    try:
        initial_job = json.loads(sys.argv[2])
    except Exception:
        pass

commands = queue.Queue()


def reader():
    pending = b''
    while True:
        try:
            chunk = os.read(sys.stdin.fileno(), 65536)
        except Exception:
            break
        if not chunk:
            break
        pending += chunk
        if len(pending) > 16_000_000:
            break
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            try:
                commands.put(json.loads(line))
            except Exception:
                pass
    commands.put({'action': 'stop'})


threading.Thread(target=reader, daemon=True).start()


def sig_handler(signum, frame):
    commands.put({'action': 'stop'})


try:
    signal.signal(signal.SIGTERM, sig_handler)
    signal.signal(signal.SIGINT, sig_handler)
except Exception:
    pass


def run_stream(job):
    session = None
    handle = None
    temp_dir = None
    httpd = None
    stop_event = threading.Event()
    alert_event = threading.Event()

    try:
        info_hash = job.get('info_hash') or job.get('infoHash') or job.get('hash')
        file_idx = job.get('file_idx') if job.get('file_idx') is not None else job.get('fileIdx')
        sources = job.get('sources') or []
        peers = list(job.get('peers') or [])

        if not info_hash and not job.get('magnet'):
            raise ValueError('Nenhum info_hash ou magnet fornecido para streaming.')

        if job.get('magnet'):
            params = lt.parse_magnet_uri(job['magnet'])
        else:
            magnet_uri = f"magnet:?xt=urn:btih:{info_hash}"
            for s in sources:
                if s.startswith('tracker:'):
                    magnet_uri += f"&tr={s[8:]}"
                elif re.match(r'^(https?|udp|wss?):', s):
                    magnet_uri += f"&tr={s}"
                elif s.startswith('peer:'):
                    parts = s[5:].split(':')
                    if len(parts) == 2:
                        peers.append([parts[0], int(parts[1])])
            params = lt.parse_magnet_uri(magnet_uri)

        directory = job.get('directory')
        if directory:
            directory = os.path.realpath(directory)
            if not os.path.isdir(directory):
                os.makedirs(directory, exist_ok=True)
            params.save_path = directory
        else:
            temp_dir = tempfile.mkdtemp(prefix='meucinema-stream-')
            params.save_path = temp_dir

        session = lt.session({
            'listen_interfaces': '0.0.0.0:0',
            'enable_upnp': False,
            'enable_natpmp': False,
            'enable_lsd': False,
            'alert_mask': int(
                lt.alert.category_t.status_notification |
                lt.alert.category_t.storage_notification |
                lt.alert.category_t.error_notification |
                lt.alert.category_t.piece_progress_notification
            )
        })

        params.flags |= lt.torrent_flags.sequential_download
        params.flags |= lt.torrent_flags.default_dont_download
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused

        handle = session.add_torrent(params)
        handle.set_flags(lt.torrent_flags.sequential_download)

        for peer in peers:
            try:
                handle.connect_peer((peer[0], int(peer[1])))
            except Exception:
                pass

        emit('status', progress=0.0, download_rate=0, num_peers=0)
        started = time.monotonic()
        last_status = time.monotonic()
        last_peer_attempt = time.monotonic()

        # 1. Wait for metadata
        while not handle.status().has_metadata and not stop_event.is_set():
            while not commands.empty():
                cmd = commands.get_nowait()
                if cmd.get('action') == 'stop':
                    stop_event.set()
                    break
            if stop_event.is_set():
                break

            for alert in session.pop_alerts():
                alert_event.set()
                alert_event.clear()
                if isinstance(alert, (lt.file_error_alert, lt.torrent_error_alert)):
                    raise RuntimeError(f'Falha ao acessar o torrent: {alert.message()}')

            now = time.monotonic()
            if peers and now - last_peer_attempt > 1:
                for peer in peers:
                    try:
                        handle.connect_peer((peer[0], int(peer[1])))
                    except Exception:
                        pass
                last_peer_attempt = now

            if now - last_status >= 0.5:
                st = handle.status()
                emit('status', progress=float(st.progress), download_rate=int(st.download_payload_rate), num_peers=int(st.num_peers), downloaded=0, total=0, speed=int(st.download_payload_rate), peers=int(st.num_peers))
                last_status = now

            if now - started > 120:
                raise ValueError('Não foi possível obter os metadados do torrent a tempo.')

            time.sleep(0.05)

        if stop_event.is_set():
            emit('stopped')
            return

        # 2. Select file
        info = handle.torrent_file()
        files = info.files()
        if info.num_files() > 10000:
            raise ValueError('Torrent com arquivos demais.')

        eligible = [
            i for i in range(info.num_files())
            if re.search(r'\.(mkv|mp4|avi|webm|m4v|mov|ts|m2ts)$', files.file_path(i), re.I)
            and not (files.file_flags(i) & lt.file_storage.flag_symlink)
        ]

        selected = None
        if file_idx is not None and 0 <= int(file_idx) < info.num_files():
            selected = int(file_idx)
        elif eligible:
            selected = max(eligible, key=files.file_size)
        else:
            selected = 0

        priorities = [0] * info.num_files()
        priorities[selected] = 1
        handle.prioritize_files(priorities)
        handle.resume()

        file_size = files.file_size(selected)
        rel_path = files.file_path(selected)
        file_name = os.path.basename(rel_path)
        target_path = os.path.join(params.save_path, rel_path)

        if file_size > 0:
            start_piece = info.map_file(selected, 0, 1).piece
            end_piece = info.map_file(selected, file_size - 1, 1).piece
        else:
            start_piece = 0
            end_piece = 0

        # Prioritize urgent pieces (head 8 and tail 8)
        head_pieces = range(start_piece, min(start_piece + 8, end_piece + 1))
        tail_pieces = range(max(start_piece, end_piece - 7), end_piece + 1)
        urgent_pieces = sorted(set(list(head_pieces) + list(tail_pieces)))
        for p in urgent_pieces:
            handle.set_piece_deadline(p, 0)

        # 3. HTTP Server
        class StreamHandler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, format, *args):
                pass

            def send_stream_headers(self, status_code, content_length, s=None, e=None):
                self.send_response(status_code)
                content_type, _ = mimetypes.guess_type(file_name)
                if not content_type:
                    if file_name.lower().endswith('.mp4'):
                        content_type = 'video/mp4'
                    elif file_name.lower().endswith('.mkv'):
                        content_type = 'video/x-matroska'
                    elif file_name.lower().endswith('.webm'):
                        content_type = 'video/webm'
                    else:
                        content_type = 'application/octet-stream'

                self.send_header('Content-Type', content_type)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Connection', 'keep-alive')
                self.send_header('Content-Length', str(content_length))
                if status_code == 206 and s is not None and e is not None:
                    self.send_header('Content-Range', f'bytes {s}-{e}/{file_size}')
                self.end_headers()

            def parse_range(self, range_header):
                if not range_header:
                    return 0, max(0, file_size - 1), 200
                m = re.match(r'^bytes\s*=\s*(\d*)\s*-\s*(\d*)$', range_header.strip())
                if not m:
                    return None, None, 416
                s_str, e_str = m.groups()
                if s_str and e_str:
                    s, e = int(s_str), int(e_str)
                elif s_str:
                    s, e = int(s_str), file_size - 1
                elif e_str:
                    s, e = max(0, file_size - int(e_str)), file_size - 1
                else:
                    s, e = 0, file_size - 1
                if s >= file_size or s > e:
                    return None, None, 416
                e = min(e, file_size - 1)
                return s, e, 206

            def do_HEAD(self):
                range_header = self.headers.get('Range')
                s, e, status_code = self.parse_range(range_header)
                if status_code == 416:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{file_size}')
                    self.end_headers()
                    return
                content_length = (e - s + 1) if file_size > 0 else 0
                self.send_stream_headers(status_code, content_length, s, e)

            def do_GET(self):
                range_header = self.headers.get('Range')
                s, e, status_code = self.parse_range(range_header)
                if status_code == 416:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{file_size}')
                    self.end_headers()
                    return

                content_length = (e - s + 1) if file_size > 0 else 0
                self.send_stream_headers(status_code, content_length, s, e)

                if content_length == 0:
                    return

                curr = s
                f = None
                try:
                    while curr <= e and not stop_event.is_set():
                        req = info.map_file(selected, curr, 1)
                        p = req.piece
                        handle.set_piece_deadline(p, 0)
                        for lookahead in range(1, 9):
                            adj_p = p + lookahead
                            if adj_p <= end_piece:
                                handle.set_piece_deadline(adj_p, lookahead * 500)

                        while not handle.have_piece(p) and not stop_event.is_set():
                            alert_event.wait(timeout=0.02)
                        if stop_event.is_set():
                            break

                        if f is None:
                            for _ in range(50):
                                if os.path.exists(target_path):
                                    f = open(target_path, 'rb')
                                    break
                                time.sleep(0.02)
                            if f is None:
                                break

                        avail = info.piece_size(p) - req.start
                        needed = e - curr + 1
                        chunk_size = min(avail, needed, 65536)

                        f.seek(curr)
                        data = f.read(chunk_size)
                        if not data:
                            time.sleep(0.01)
                            f.seek(curr)
                            data = f.read(chunk_size)
                            if not data:
                                break

                        self.wfile.write(data)
                        curr += len(data)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.error):
                    pass
                finally:
                    if f is not None:
                        try:
                            f.close()
                        except Exception:
                            pass

        httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), StreamHandler)
        port = httpd.server_address[1]
        server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        server_thread.start()

        emit('ready', url=f'http://127.0.0.1:{port}/stream', port=port, file_name=file_name)

        # 4. Main streaming loop
        last_status = time.monotonic()
        while not stop_event.is_set():
            while not commands.empty():
                cmd = commands.get_nowait()
                if cmd.get('action') == 'stop':
                    stop_event.set()
                    break
            if stop_event.is_set():
                break

            for alert in session.pop_alerts():
                alert_event.set()
                alert_event.clear()
                if isinstance(alert, (lt.file_error_alert, lt.torrent_error_alert)):
                    raise RuntimeError(f'Falha no torrent: {alert.message()}')

            now = time.monotonic()
            if peers and now - last_peer_attempt > 2:
                for peer in peers:
                    try:
                        handle.connect_peer((peer[0], int(peer[1])))
                    except Exception:
                        pass
                last_peer_attempt = now

            if now - last_status >= 0.5:
                st = handle.status()
                fp = handle.file_progress()[selected] if handle.status().has_metadata else 0
                tot = file_size if file_size > 0 else 1
                prog = round(fp / tot, 4)
                emit('status', progress=prog, download_rate=int(st.download_payload_rate), num_peers=int(st.num_peers), downloaded=fp, total=file_size, speed=int(st.download_payload_rate), peers=int(st.num_peers))
                last_status = now

            time.sleep(0.05)

        emit('stopped')

    except Exception as error:
        if isinstance(error, AttributeError):
            print('Operação indisponível no motor: ' + re.sub(r'[^a-zA-Z0-9_]', '', error.name or '')[:100], file=sys.stderr, flush=True)
        message = str(error) if isinstance(error, ValueError) else 'O streaming falhou. Verifique a fonte, a conexão e os parâmetros.'
        emit('error', message=message)
        sys.exit(1)
    finally:
        stop_event.set()
        alert_event.set()
        if httpd is not None:
            try:
                httpd.shutdown()
                httpd.server_close()
            except Exception:
                pass
        if session is not None and handle is not None:
            try:
                session.remove_torrent(handle)
                session.pause()
            except Exception:
                pass
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass


def run_download(job):
    session = None
    handle = None
    selected = None
    file_name = None
    stopping = False
    completed = False
    rename_pending = False
    started = time.monotonic()
    last_status = 0
    last_resume = 0
    last_peer_attempt = 0
    stop_time = None
    saved_after_stop = False

    try:
        directory = os.path.realpath(job['directory'])
        if directory != os.path.abspath(job['directory']) or not os.path.isdir(directory):
            raise ValueError('Pasta de download indisponível.')
        prefix = job['filePrefix']
        if not prefix or prefix != os.path.basename(prefix) or len(prefix) > 200:
            raise ValueError('Nome de arquivo inválido.')
        partial = '.cinessd-' + job['id'] + '.partial'
        session = lt.session({'listen_interfaces': '0.0.0.0:0', 'enable_upnp': False, 'enable_natpmp': False,
                              'enable_lsd': False, 'alert_mask': int(lt.alert.category_t.status_notification | lt.alert.category_t.storage_notification | lt.alert.category_t.error_notification)})
        if job.get('resume'):
            params = lt.read_resume_data(base64.b64decode(job['resume']))
        else:
            params = lt.parse_magnet_uri(job['magnet'])
        params.save_path = directory
        params.flags |= lt.torrent_flags.default_dont_download
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused
        params.piece_priorities = []
        # A previous resume may have priorities; do not download anything before validating the selected file.
        if params.ti:
            params.file_priorities = [0] * params.ti.num_files()
        handle = session.add_torrent(params)
        for peer in job.get('peers', []):
            handle.connect_peer((peer[0], int(peer[1])))
        emit('status', state='metadata', downloaded=0, total=0, speed=0, peers=0)
        while True:
            while not commands.empty():
                command = commands.get_nowait()
                if command.get('action') == 'stop' and not stopping:
                    stopping = True
                    stop_time = time.monotonic()
                    handle.pause()
                    if handle.status().has_metadata:
                        handle.save_resume_data(lt.save_resume_flags_t.save_info_dict | lt.save_resume_flags_t.flush_disk_cache)
                    else:
                        saved_after_stop = True
            for alert in session.pop_alerts():
                if isinstance(alert, lt.save_resume_data_alert):
                    emit('resume', data=base64.b64encode(bytes(lt.write_resume_data_buf(alert.params))).decode())
                    if stopping:
                        saved_after_stop = True
                elif isinstance(alert, lt.save_resume_data_failed_alert):
                    if stopping:
                        saved_after_stop = True
                elif isinstance(alert, lt.file_renamed_alert) and selected is not None and alert.index == selected:
                    rename_pending = False
                    if not stopping:
                        priorities = [0] * handle.torrent_file().num_files()
                        priorities[selected] = 7
                        handle.prioritize_files(priorities)
                elif isinstance(alert, (lt.file_error_alert, lt.torrent_error_alert, lt.file_rename_failed_alert)):
                    raise RuntimeError('Falha ao gravar o torrent. Verifique o SSD e o espaço disponível.')
            if stopping and (saved_after_stop or time.monotonic() - stop_time > 4):
                break
            if not stopping and handle.status().has_metadata and selected is None:
                info = handle.torrent_file()
                files = info.files()
                if info.num_files() > 10000:
                    raise ValueError('Torrent com arquivos demais.')
                eligible = [i for i in range(info.num_files()) if re.search(r'\.(mkv|mp4|avi|webm|m4v|mov|ts|m2ts)$', files.file_path(i), re.I)
                            and not (files.file_flags(i) & lt.file_storage.flag_symlink)]
                selected = job.get('fileIdx')
                if selected is None:
                    if not eligible:
                        raise ValueError('Esta fonte não contém um vídeo compatível.')
                    if job.get('episode') is not None and len(eligible) > 1:
                        season = int(job['season'])
                        episode = int(job['episode'])
                        pattern = re.compile(r'(?:S0*' + str(season) + r'E0*' + str(episode) + r'(?!\d)|\b0*' + str(season) + r'x0*' + str(episode) + r'(?!\d))', re.I)
                        matching = [i for i in eligible if pattern.search(files.file_path(i))]
                        if len(matching) != 1:
                            raise ValueError('A fonte não indicou qual arquivo corresponde ao episódio. Escolha outra opção.')
                        selected = matching[0]
                    else:
                        selected = max(eligible, key=files.file_size)
                if selected not in eligible:
                    raise ValueError('O arquivo indicado pela fonte não é um vídeo compatível.')
                extension = os.path.splitext(files.file_path(selected))[1].lower()
                file_name = prefix + extension
                if os.path.lexists(os.path.join(directory, file_name)):
                    raise ValueError('O vídeo de destino já existe. Ele foi preservado.')
                if os.path.islink(os.path.join(directory, partial)):
                    raise ValueError('Arquivo temporário inválido.')
                handle.prioritize_files([0] * info.num_files())
                if hasattr(handle, 'get_renamed_files'):
                    renamed = handle.get_renamed_files()
                    mapped = renamed.get(selected) if isinstance(renamed, dict) else renamed.file_path(files, selected)
                else:
                    mapped = files.file_path(selected)
                if mapped == partial:
                    priorities = [0] * info.num_files()
                    priorities[selected] = 7
                    handle.prioritize_files(priorities)
                    handle.resume()
                else:
                    rename_pending = True
                    handle.rename_file(selected, partial)
                emit('file', fileName=file_name)
                handle.save_resume_data(lt.save_resume_flags_t.save_info_dict)
            now = time.monotonic()
            if not stopping and job.get('peers') and now - last_peer_attempt > 1:
                for peer in job['peers']:
                    handle.connect_peer((peer[0], int(peer[1])))
                last_peer_attempt = now
            if not stopping and selected is not None and not rename_pending:
                status = handle.status()
                progress = handle.file_progress()[selected]
                total = handle.torrent_file().files().file_size(selected)
                if now - last_status >= 0.5:
                    emit('status', state='downloading', downloaded=progress, total=total,
                         speed=status.download_payload_rate, peers=status.num_peers)
                    last_status = now
                if total > 0 and progress >= total:
                    completed = True
                    stopping = True
                    stop_time = now
                    handle.pause()
                    handle.save_resume_data(lt.save_resume_flags_t.save_info_dict | lt.save_resume_flags_t.flush_disk_cache)
                elif now - last_resume > 10:
                    handle.save_resume_data(lt.save_resume_flags_t.save_info_dict)
                    last_resume = now
            elif not stopping and selected is None and now - started > 120:
                raise ValueError('Não foi possível obter os dados do torrent. Tente outra fonte ou retome mais tarde.')
            time.sleep(0.1)
        session.remove_torrent(handle)
        released = False
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            for alert in session.pop_alerts():
                if isinstance(alert, lt.torrent_removed_alert):
                    released = True
            if released:
                break
            time.sleep(0.05)
        session.pause()
        if completed:
            publish(os.path.join(directory, partial), os.path.join(directory, file_name))
            emit('complete', fileName=file_name)
        else:
            emit('stopped')
    except Exception as error:
        if isinstance(error, AttributeError):
            print('Operação indisponível no motor: ' + re.sub(r'[^a-zA-Z0-9_]', '', error.name or '')[:100], file=sys.stderr, flush=True)
        message = str(error) if isinstance(error, ValueError) else 'O download falhou. Verifique a fonte, a conexão e a pasta de destino.'
        emit('error', message=message)
        if handle is not None:
            try:
                handle.pause()
                handle.save_resume_data(lt.save_resume_flags_t.save_info_dict | lt.save_resume_flags_t.flush_disk_cache)
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    for alert in session.pop_alerts():
                        if isinstance(alert, lt.save_resume_data_alert):
                            emit('resume', data=base64.b64encode(bytes(lt.write_resume_data_buf(alert.params))).decode())
                    time.sleep(0.05)
            except Exception:
                pass
        sys.exit(1)


if initial_job is not None:
    job = initial_job
else:
    job = commands.get()

if job.get('action') == 'stream':
    run_stream(job)
else:
    run_download(job)
