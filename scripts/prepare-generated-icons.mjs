import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// The generated PNG masters stay outside the web bundle; only alpha WebP assets ship.
const input = process.argv[2];
const sharpEntry = process.argv[3];
if (!input || !sharpEntry) throw new Error('Pass an image manifest and the installed sharp package path.');
const sharp = createRequire(import.meta.url)(sharpEntry);
const project = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(input, 'utf8'));
const output = path.join(project, 'dist/assets/icons');
const masters = path.resolve(project, '../output/generated-icons');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(masters, { recursive: true });
let bytes = 0;
for (const { name, source } of manifest) {
  if (!/^[a-z]+$/.test(name)) throw new Error('Invalid icon name.');
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error(`Missing transparency: ${name}`);
  await fs.copyFile(source, path.join(masters, `${name}.png`));
  const target = path.join(output, `${name}.webp`);
  await sharp(source).trim({ threshold: 8 }).resize(256, 256, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }
  }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(target);
  bytes += (await fs.stat(target)).size;
  if (name === 'bolt') await sharp(source).trim({ threshold: 8 }).resize(64, 64, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }
  }).png().toFile(path.join(project, 'dist/assets/favicon.png'));
}
await fs.mkdir(path.join(project, 'design'), { recursive: true });
await fs.writeFile(path.join(project, 'design/icon-generation.json'), JSON.stringify({
  mode: 'built-in image_gen', background: 'transparent',
  icons: manifest.map(({ name, prompt }) => ({ name, asset: `dist/assets/icons/${name}.webp`, prompt }))
}, null, 2) + '\n');
console.log(JSON.stringify({ icons: manifest.length, webBundleBytes: bytes, masters }));
