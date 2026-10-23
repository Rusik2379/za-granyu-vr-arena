import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = path.join(root, 'dist');
const output = path.join(root, 'docs');
const base = process.env.PAGES_BASE || '/za-granyu-vr-arena/';
if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base)) throw new Error('PAGES_BASE must be an absolute directory path ending in /.');
const prefix = base.slice(0, -1);
let count = 0;

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
      // HTML attributes also occur inside the application's template strings.
      text = text.replace(/\b(href|src)=(['"])\/(?!\/)/g, (_match, attr, quote) => `${attr}=${quote}${base}`);
      if (name === 'app.js') {
        text = text.replace("'use strict';", `'use strict';\nconst SITE_BASE = ${JSON.stringify(prefix)};`);
        text = text.replace('location.pathname.replace', 'location.pathname.slice(SITE_BASE.length).replace');
        // Inline background styles are constructed separately from src/href.
        text = text.replaceAll("url('/assets/", `url('${base}assets/`);
      }
      if (name.endsWith('.css')) text = text.replaceAll("url('/assets/", `url('${base}assets/`);
      await writeFile(to, text, 'utf8');
    } else {
      await copyFile(from, to);
    }
    count += 1;
  }
}

await mkdir(output, { recursive: true });
await build(source);
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`GitHub Pages: ${count} files in docs/, base ${base}`);
