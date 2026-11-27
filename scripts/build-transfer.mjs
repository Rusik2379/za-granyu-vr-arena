import {readdir,readFile,writeFile} from 'node:fs/promises';
import {brotliCompressSync,gzipSync,constants} from 'node:zlib';
import path from 'node:path';

// HTTP representations are produced with the release, so requests do no compression work.
export async function buildTransfer(directory=new URL('../dist/',import.meta.url)) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
    if(entry.isDirectory()){await buildTransfer(file);continue;}
    if(!['.html','.css','.js','.svg'].includes(path.extname(entry.name)))continue;
    const source=await readFile(file);
    if(source.length<1024)continue;
    await writeFile(new URL(file.href+'.br'),brotliCompressSync(source,{params:{[constants.BROTLI_PARAM_QUALITY]:9}}));
    await writeFile(new URL(file.href+'.gz'),gzipSync(source,{level:9}));
  }
}
