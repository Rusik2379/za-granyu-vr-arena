import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pages = process.argv.includes('--pages');
const port = Number(process.env.PORT || (pages ? 4174 : 4175));
const base = pages ? (process.env.PAGES_BASE || '/za-granyu-vr-arena/') : '/';
const root = path.resolve(fileURLToPath(new URL(pages ? './docs/' : './dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pages && pathname === base.slice(0, -1)) { res.writeHead(302, { Location: base }).end(); return; }
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    let file = path.resolve(root, '.' + '/' + pathname.slice(base.length));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Страница не найдена');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}${base}`));
