import http from 'node:http';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {createPromoService, PromoError} from './promo-core.mjs';

// A confirmed incoming-lead connector is required. This is NOT BookNow /bookings.
const webhook = process.env.LEAD_WEBHOOK_URL;
if (process.env.PROMO_ENABLED !== 'true' || !webhook) throw new Error('Promo disabled: configure a confirmed incoming-lead webhook and PROMO_ENABLED=true');
if (new URL(webhook).protocol !== 'https:') throw new Error('LEAD_WEBHOOK_URL must use HTTPS');
if (!process.env.LEAD_WEBHOOK_TOKEN) throw new Error('Set LEAD_WEBHOOK_TOKEN');
const allowedOrigin = process.env.ALLOWED_ORIGIN;
if (!allowedOrigin || new URL(allowedOrigin).origin !== allowedOrigin) throw new Error('Set ALLOWED_ORIGIN to the exact website origin');
const prizes = JSON.parse(process.env.PRIZES_JSON || 'null');
const validityDays = Number(process.env.VALIDITY_DAYS);
const databasePath = resolve(process.env.PROMO_DB_PATH || '.data/promo.sqlite');
mkdirSync(dirname(databasePath), {recursive:true});
const service = createPromoService({databasePath, secret:process.env.PROMO_SECRET, prizes, validityDays});
const send = async lead => {
  const response = await fetch(webhook, {method:'POST', redirect:'error',
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+process.env.LEAD_WEBHOOK_TOKEN, 'Idempotency-Key':lead.id},
    body:JSON.stringify(lead), signal:AbortSignal.timeout(10000)});
  await response.body?.cancel();
  if (!response.ok) throw new Error('Lead delivery failed');
};
const retry = setInterval(() => service.dispatch(send).catch(() => console.error('Outbox retry failed')), 15000);
retry.unref();

const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Vary','Origin');
  const json = (status,body) => res.writeHead(status).end(JSON.stringify(body));
  if (req.headers.origin !== allowedOrigin) return json(403,{error:'ORIGIN',message:'Недоступно для этого сайта'});
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  if (req.method==='OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods','GET, POST');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    return res.writeHead(204).end();
  }
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname==='/api/promo/config' && req.method==='GET') return json(200,{mode:'live',prizes,validityDays});
  if (pathname!=='/api/promo/claim' || req.method!=='POST') return json(404,{message:'Не найдено'});
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) return json(415,{message:'Нужен JSON'});
  try {
    let size=0,parts=[];
    for await (const part of req) {size+=part.length;if(size>4096)throw new PromoError(413,'SIZE','Слишком большой запрос');parts.push(part);}
    let input;
    try {input=JSON.parse(Buffer.concat(parts).toString('utf8'));} catch {throw new PromoError(400,'JSON','Некорректный запрос');}
    if (!input || typeof input!=='object' || Array.isArray(input)) throw new PromoError(400,'JSON','Некорректный запрос');
    // IP headers from the public client are deliberately ignored. Use a trusted proxy
    // with its own rate limit if deploying behind a reverse proxy.
    const result=service.claim(input,req.socket.remoteAddress||'unknown');
    json(result.repeated?200:201,result);
    void service.dispatch(send).catch(()=>console.error('Outbox dispatch failed'));
  } catch(error) {
    if(error instanceof PromoError)json(error.status,{error:error.code,message:error.message});
    else {console.error('Promo request failed');json(500,{message:'Не удалось сохранить заявку. Попробуйте позже'});}
  }
});
server.requestTimeout=15000;
server.listen(Number(process.env.PROMO_PORT||4180),'127.0.0.1',()=>console.log('Promo API listening on 127.0.0.1:'+Number(process.env.PROMO_PORT||4180)));
// Run behind HTTPS on the chosen hosting. The SQLite file must be on persistent storage.
