// Branded OG cards (1200x630). Run after `npm run build`: node scripts/generate-og.mjs
// Reads each built page's <h1>, writes public/images/og/<slug>.png.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const DIST = 'dist';
const OUT = 'public/images/og';
const C = { bg: '#080c14', surface: '#0e1420', text: '#eef2ff', muted: '#8090b0', cyan: '#00e5ff', divider: '#1c2840' };
const f = (n) => fs.readFileSync(path.join('scripts/og-fonts', n));
const fonts = [
  { name: 'Archivo Black', data: f('ab.ttf'), weight: 400, style: 'normal' },
  { name: 'Space Grotesk', data: f('sg700.ttf'), weight: 700, style: 'normal' },
  { name: 'Inter Tight', data: f('it500.ttf'), weight: 500, style: 'normal' },
  { name: 'JetBrains Mono', data: f('jb500.ttf'), weight: 500, style: 'normal' },
];
const h = (type, style, children, props = {}) => ({ type, props: { style: { display: 'flex', ...style }, children, ...props } });
const decode = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();

function split(h1) {
  const t = h1.replace(/\.$/, '');
  const i = t.indexOf(': ');
  if (i > 0) return [t.slice(0, i), t.slice(i + 2).replace(/^./, (c) => c.toUpperCase())];
  return [t, ''];
}
function size(len) { return len <= 14 ? 132 : len <= 24 ? 104 : len <= 36 ? 84 : 68; }

function card(slug, h1) {
  let head, sub, lines;
  if (slug === 'home') { lines = [['HANG.', C.text], ['LONGER.', C.cyan]]; sub = 'Grip strength, practice, progress'; }
  else { [head, sub] = split(h1); lines = [[head.toUpperCase(), C.text]]; }
  const fs_ = slug === 'home' ? 120 : size(lines[0][0].length);
  const mark = h('div', { flexDirection: 'column', alignItems: 'center', width: 40 }, [
    h('div', { width: 36, height: 5, background: C.cyan }, ''),
    h('div', { width: 4, height: 12, background: C.text }, ''),
    h('div', { width: 14, height: 14, borderRadius: 7, background: C.text }, ''),
  ]);
  return h('div', { width: 1200, height: 630, background: C.bg, flexDirection: 'column', justifyContent: 'space-between', padding: '56px 72px 56px', position: 'relative', boxSizing: 'border-box' }, [
    h('div', { position: 'absolute', top: 0, left: 0, width: 1200, height: 10, background: C.cyan }, ''),
    h('div', { alignItems: 'center', justifyContent: 'space-between' }, [
      h('div', { alignItems: 'center', gap: 14, fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 34, color: C.text }, [
        mark,
        h('div', { }, [h('span', {}, 'deadhangs'), h('span', { color: C.cyan }, '.com')]),
      ]),
      h('div', { fontFamily: 'JetBrains Mono', fontSize: 20, letterSpacing: 4, color: C.muted }, 'BUILT FOR PRACTICE'),
    ]),
    h('div', { flexDirection: 'column', gap: 28 }, [
      ...lines.map(([t, col]) => h('div', { fontFamily: 'Archivo Black', fontSize: fs_, lineHeight: 1.02, color: col, maxWidth: 1056 }, t)),
      h('div', { width: 120, height: 6, background: C.cyan }, ''),
      sub ? h('div', { fontFamily: 'Inter Tight', fontWeight: 500, fontSize: 36, color: C.muted, maxWidth: 1000, lineHeight: 1.25 }, sub) : h('div', {}, ''),
    ]),
    h('div', { height: 1 }, ''),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
const pages = [['home', 'index.html'], ...fs.readdirSync(DIST, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(DIST, d.name, 'index.html'))).map((d) => [d.name, `${d.name}/index.html`])];
for (const [slug, file] of pages) {
  if (slug === '404') continue;
  const m = fs.readFileSync(path.join(DIST, file), 'utf8').match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const h1 = m ? decode(m[1]) : '';
  const svg = await satori(card(slug, h1), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(path.join(OUT, `${slug}.png`));
  console.log(slug, '|', h1);
}
