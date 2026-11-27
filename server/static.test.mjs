import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {get} from 'node:http';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {createSiteServer} from './site-server.mjs';
import {buildTransfer} from '../scripts/build-transfer.mjs';

test('compressed styles preserve content and type, respect encoding exclusions, HEAD and byte ranges',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'zg-static-'));
 const css='body{color:white;background:black}\n'.repeat(200);
 writeFileSync(join(directory,'test.css'),css);
 await buildTransfer(pathToFileURL(directory+'/'));
 const server=createSiteServer({siteDirectory:directory});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=(headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=get({host:'127.0.0.1',port:server.address().port,path:'/test.css',headers,method},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });req.on('error',reject);
 });
 try{
  const br=await request({'Accept-Encoding':'br,gzip'});
  assert.equal(br.headers['content-encoding'],'br');assert.match(br.headers['content-type'],/text\/css/);
  assert.equal(brotliDecompressSync(br.body).toString(),css);assert(br.body.length<css.length/5);
  assert.equal(Number(br.headers['content-length']),br.body.length);assert.equal(br.headers.vary,'Accept-Encoding');
  const gz=await request({'Accept-Encoding':'br;q=0, gzip'});
  assert.equal(gz.headers['content-encoding'],'gzip');assert.equal(gunzipSync(gz.body).toString(),css);
  const plain=await request();assert.equal(plain.headers['content-encoding'],undefined);assert.equal(plain.body.toString(),css);
  const range=await request({'Accept-Encoding':'br',Range:'bytes=0-15'});
  assert.equal(range.status,206);assert.equal(range.headers['content-encoding'],undefined);assert.equal(range.body.toString(),css.slice(0,16));
  const head=await request({'Accept-Encoding':'br'},'HEAD');assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],br.headers['content-length']);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
});
