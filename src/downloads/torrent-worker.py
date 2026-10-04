"""One active selected file; JSON stdin/stdout only. System libtorrent, no shell."""
import base64
import ctypes
import json
import os
import queue
import re
import sys
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
        request = json.loads(sys.stdin.readline())
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

commands = queue.Queue()


def reader():
    pending = b''
    while True:
        chunk = os.read(sys.stdin.fileno(), 65536)
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
job = commands.get()
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
                # libtorrent 2.0 exposes the renamed paths through torrent_info.
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
        # Explicit peers can be supplied by the local integration harness. A resumed
        # torrent checks storage first and may ignore a connection requested too early.
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
    # Remove the handle and wait for libtorrent to release and flush storage before publishing.
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
    # Do not emit libtorrent errors containing private tracker URLs.
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
