import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
if(process.platform!=='win32')throw new Error('O pacote mpv Windows deve ser preparado no Windows.');
const provenance={
  name:'mpv win64 20261004 / shinchiro (x86_64 baseline)',
  url:'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261004/mpv-x86_64-20261004-git-413ff0b1cd.7z',
  sha256:'0703a0d62c60b2c68511c6a101db82a31c32c69bcdd86941632a1e76bb1699b7',
  source:'https://github.com/mpv-player/mpv/tree/413ff0b1cd',
  buildRecipes:'https://github.com/shinchiro/mpv-winbuild-cmake',
};
const base=path.resolve('packaging/windows'),archive=path.join(base,'cache/mpv.7z'),extracted=path.join(base,'cache/mpv-extracted');
await mkdir(path.dirname(archive),{recursive:true});
let bytes;try{bytes=await readFile(archive);}catch{}
if(!bytes||createHash('sha256').update(bytes).digest('hex')!==provenance.sha256){
 const response=await fetch(provenance.url);if(!response.ok)throw new Error(`mpv download: ${response.status}`);
 bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==provenance.sha256)throw new Error('Checksum mpv divergente.');await writeFile(archive,bytes);
}
await mkdir(extracted,{recursive:true});execFileSync('7z',['x',archive,'-o'+extracted,'-y'],{stdio:'inherit'});
// Keep the complete upstream package, including its manuals and notices.
await cp(extracted,path.join(base,'bin/mpv'),{recursive:true});
await mkdir(path.join(base,'licenses'),{recursive:true});await writeFile(path.join(base,'licenses/mpv-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const notices=path.join(base,'licenses/mpv');await mkdir(notices,{recursive:true});
for(const name of ['Copyright','LICENSE.GPL','LICENSE.LGPL']){
 const response=await fetch('https://raw.githubusercontent.com/mpv-player/mpv/413ff0b1cd/'+name);if(!response.ok)throw new Error('Aviso mpv indisponível: '+name);await writeFile(path.join(notices,name),await response.text());
}
execFileSync(path.join(base,'bin/mpv/mpv.exe'),['--version'],{stdio:'inherit',windowsHide:true});
