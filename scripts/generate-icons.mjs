// Builds the PWA icons from public/favicon.svg. Run: node scripts/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');
const favicon = fs.readFileSync(path.join(ROOT, 'public', 'favicon.svg'), 'utf8');
const figure = favicon
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replace(/<circle cx="16" cy="16" r="16"[^>]*\/>/, '');
if (figure.includes('r="16"')) throw new Error('favicon background circle was not removed');

// Full-bleed square, figure kept inside the central safe zone (maskable and iOS).
const fullBleed = (size) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">` +
  `<rect width="32" height="32" fill="#080c14"/>` +
  `<g transform="translate(16 16) scale(0.66) translate(-16 -16)">${figure}</g></svg>`);

fs.mkdirSync(OUT, { recursive: true });
const any = (size) => sharp(Buffer.from(favicon), { density: (72 * size) / 32 }).resize(size, size).png({ compressionLevel: 9 });
await any(192).toFile(path.join(OUT, 'icon-192.png'));
await any(512).toFile(path.join(OUT, 'icon-512.png'));
await sharp(fullBleed(512), { density: 72 * 16 }).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'icon-maskable-512.png'));
await sharp(fullBleed(180), { density: 72 * 6 }).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'apple-touch-icon.png'));
console.log('icons written to', OUT);
