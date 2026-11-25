import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildStyles } from './build-styles.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = path.join(root, 'dist');
const output = path.join(root, 'docs');
const base = process.env.PAGES_BASE || '/za-granyu-vr-arena/';
if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base)) throw new Error('PAGES_BASE must be an absolute directory path ending in /.');
const prefix = base.slice(0, -1);
let count = 0;
const htmlFiles = [];

async function build(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    const from = path.join(source, name);
    const to = path.join(output, name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await build(from, name);
      continue;
    }
    if (['.html', '.css', '.js'].includes(path.extname(name))) {
      let text = await readFile(from, 'utf8');
      // Show the complete form in review builds without contacting the live CRM.
      if (name === 'booknow-config.js') text = "'use strict';\nwindow.ZG_BOOKING_CONFIG=Object.freeze({enabled:true,preview:true,apiBase:'/api/booking'});\n";
      if (name.endsWith('.html')) text = text.replace('<script src="/booking.js" defer></script>', '<script src="/booking-preview.js" defer></script>\n  <script src="/booking.js" defer></script>');
      // HTML attributes also occur inside the application's template strings.
      text = text.replace(/\b(href|src|poster)=(['"])\/(?!\/)/g, (_match, attr, quote) => `${attr}=${quote}${base}`);
      text = text.replace(/\b(srcset|imagesrcset)=(['"])(.*?)\2/g, (_match, attr, quote, value) =>
        `${attr}=${quote}${value.replace(/(^|,\s*)\/(?!\/)/g, '$1' + base)}${quote}`);
      if (name === 'app.js') {
        text = text.replace("'use strict';", `'use strict';\nconst SITE_BASE = ${JSON.stringify(prefix)};`);
        text = text.replace('location.pathname.replace', 'location.pathname.slice(SITE_BASE.length).replace');
        // Inline background styles are constructed separately from src/href.
        text = text.replaceAll("url('/assets/", `url('${base}assets/`);
      }
      if (name.endsWith('.css')) text = text.replaceAll("url('/assets/", `url('${base}assets/`);
      await writeFile(to, text, 'utf8');
      if (name.endsWith('.html')) htmlFiles.push(to);
    } else {
      await copyFile(from, to);
    }
    count += 1;
  }
}

await buildStyles();
await mkdir(output, { recursive: true });
await build(source);
// Pages caches assets; content versions make a normal refresh load the current UI.
const versions = new Map();
for (const file of htmlFiles) {
  let html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/\b(?:href|src)=(['"])(\/[^'"]+\.(?:css|js))\1/g)) {
    const [, quote, url] = match;
    if (!url.startsWith(base)) continue;
    if (!versions.has(url)) versions.set(url, createHash('sha256').update(await readFile(path.join(output, url.slice(base.length)))).digest('hex').slice(0, 12));
    html = html.replaceAll(url + quote, url + '?v=' + versions.get(url) + quote);
  }
  await writeFile(file, html, 'utf8');
}
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`GitHub Pages: ${count} files in docs/, base ${base}`);
