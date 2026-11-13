import http from 'node:http';
import {createReadStream, mkdirSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPromoService, PromoError} from './promo-core.mjs';
import {createBookNowClient, BookNowError} from './booknow-client.mjs';
import {createBookingService} from './booking-service.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4'};

export function createSiteServer({client, databasePath, secret, origins = [], siteDirectory = root,
  promoEnabled = false, prizes = [5, 7, 10, 5, 7, 5], validityDays = 14} = {}) {
  let promo;
  let bookings;
  if (client) {
    mkdirSync(dirname(databasePath), {recursive: true});
    if (promoEnabled) promo = createPromoService({databasePath, secret, prizes, validityDays});
    bookings = createBookingService({client, promo, databasePath, secret});
  }
  const limits = new Map();
  const staticRoot = resolve(siteDirectory);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, data) => res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}).end(JSON.stringify(data));
    try {
      if (url.pathname === '/booknow-config.js' || url.pathname === '/promo-config.js') {
        const config = url.pathname === '/booknow-config.js'
          ? `window.ZG_BOOKING_CONFIG=Object.freeze(${JSON.stringify({enabled: !!bookings, apiBase: '/api/booking'})});`
          : `window.ZG_PROMO_CONFIG=Object.freeze(${JSON.stringify({mode: promo ? 'live' : 'preview', apiBase: '/api/promo', prizes, validityDays})});`;
        return res.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'}).end(config);
      }
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(405, {message: 'Метод недоступен'});
        let file = resolve(staticRoot, '.' + decodeURIComponent(url.pathname));
        if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return json(404, {message: 'Не найдено'});
        let info = await stat(file);
        if (info.isDirectory()) {file = resolve(file, 'index.html'); info = await stat(file);}
        const headers = {'Content-Type': mime[extname(file)] || 'application/octet-stream',
          'Content-Length': info.size, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'};
        let range;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!match) return res.writeHead(416, {'Content-Range': 'bytes */' + info.size}).end();
          const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
          if (start > end || start >= info.size) return res.writeHead(416, {'Content-Range': 'bytes */' + info.size}).end();
          range = {start, end};
          headers['Content-Length'] = end - start + 1;
          headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(file, range);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        return stream.pipe(res);
      }
      res.setHeader('Vary', 'Origin');
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) return json(403, {message: 'Недоступно для этого сайта'});
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.writeHead(204).end();
      }
      // The container is reached through a trusted reverse proxy, which replaces X-Real-IP.
      // Never publish the API container port directly with TRUST_PROXY=true.
      const identity = process.env.TRUST_PROXY === 'true' ? req.headers['x-real-ip'] || req.socket.remoteAddress : req.socket.remoteAddress;
      const time = Date.now(), current = limits.get(identity);
      const counter = current && current.until > time ? current : {count: 0, until: time + 60000};
      limits.set(identity, counter);
      for (const [key, value] of limits) if (value.until < time) limits.delete(key);
      if (++counter.count > 60) return json(429, {message: 'Слишком много запросов. Повторите через минуту'});
      if (url.pathname === '/api/health') return json(200, {bookingEnabled: !!bookings, promoEnabled: !!promo});
      if (!bookings) return json(503, {message: 'Онлайн-запись ещё не подключена'});
      if (req.method === 'GET') {
        const input = Object.fromEntries(url.searchParams);
        switch (url.pathname) {
          case '/api/booking/catalog': return json(200, await bookings.catalog());
          case '/api/booking/staffers': return json(200, await bookings.staffers(input));
          case '/api/booking/slots': return json(200, await bookings.slots(input));
          case '/api/booking/calendar': return json(200, await bookings.calendar(input));
          case '/api/promo/config': return json(200, {mode: promo ? 'live' : 'preview', prizes, validityDays});
          default: return json(404, {message: 'Не найдено'});
        }
      }
      if (req.method !== 'POST') return json(405, {message: 'Метод недоступен'});
      if (!origin || !origins.includes(origin)) return json(403, {message: 'Обновите страницу перед отправкой'});
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415, {message: 'Нужен JSON'});
      const parts = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 8192) throw new PromoError(413, 'SIZE', 'Слишком большой запрос');
        parts.push(part);
      }
      let input;
      try {input = JSON.parse(Buffer.concat(parts).toString('utf8'));}
      catch {throw new PromoError(400, 'JSON', 'Некорректный запрос');}
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PromoError(400, 'JSON', 'Некорректный запрос');
      if (url.pathname === '/api/booking/create') return json(200, await bookings.book(input));
      if (url.pathname === '/api/promo/claim') return promo ? json(200, promo.claim(input, identity || 'unknown'))
        : json(503, {message: 'Бонусы пока не подключены'});
      return json(404, {message: 'Не найдено'});
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof PromoError) return json(error.status, {error: error.code, message: error.message});
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return json(404, {message: 'Не найдено'});
      if (error instanceof BookNowError) console.error('BookNow status:', error.status);
      else console.error('Website request failed:', error.name);
      return json(503, {message: 'Сервис записи временно недоступен. Повторите позже'});
    }
  });
  server.requestTimeout = 30000;
  server.on('close', () => {bookings?.close(); promo?.close();});
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const enabled = process.env.BOOKNOW_ENABLED === 'true';
  const server = createSiteServer({
    client: enabled ? createBookNowClient({token: process.env.BOOKNOW_API_KEY, workspace: process.env.BOOKNOW_WORKSPACE}) : null,
    databasePath: resolve(process.env.PROMO_DB_PATH || '.data/promo.sqlite'), secret: process.env.PROMO_SECRET,
    promoEnabled: process.env.PROMO_ENABLED === 'true',
    origins: (process.env.ALLOWED_ORIGINS || 'https://za-granyu22.ru').split(',').map(value => value.trim())
  });
  const port = Number(process.env.PORT || 4180);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Website listening on port ' + port));
}
