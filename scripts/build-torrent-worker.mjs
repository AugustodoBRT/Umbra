import { execFileSync } from 'node:child_process';
import { mkdir, cp, writeFile } from 'node:fs/promises';
if (process.platform !== 'win32') throw new Error('O worker Windows deve ser construído no Windows.');
execFileSync('python',['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','umbra-torrent','--distpath','packaging/windows/worker-dist','--workpath','packaging/windows/worker-build','--specpath','packaging/windows/worker-build','--hidden-import','libtorrent','src/downloads/torrent-worker.py'],{ stdio: 'inherit' });
await cp('packaging/windows/worker-dist/umbra-torrent','packaging/windows/bin/torrent',{ recursive: true });
execFileSync('packaging/windows/bin/torrent/umbra-torrent.exe',['--check'],{ stdio: 'inherit' });
await mkdir('packaging/windows/licenses',{ recursive: true });
// Include installed wheel metadata and its license files in the distribution.
execFileSync('python',['-c','import importlib.metadata,pathlib,shutil; d=importlib.metadata.distribution("libtorrent"); target=pathlib.Path("packaging/windows/licenses/libtorrent"); target.mkdir(parents=True,exist_ok=True); [(shutil.copy2(d.locate_file(f),target/pathlib.Path(str(f)).name)) for f in d.files if "dist-info" in str(f) and ("LICENSE" in str(f).upper() or "COPYING" in str(f).upper() or str(f).endswith("METADATA"))]'],{ stdio: 'inherit' });
await writeFile('packaging/windows/licenses/torrent-worker.txt','Umbra torrent worker: Python 3.12, libtorrent 2.1.1 (BSD) and PyInstaller 6.16.0 (GPL with bootloader exception).\nSources: https://www.libtorrent.org/ and https://github.com/pyinstaller/pyinstaller/tree/v6.16.0\nPython license: https://docs.python.org/3/license.html\n');
