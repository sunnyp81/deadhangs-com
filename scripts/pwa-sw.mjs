// Astro integration: writes dist/sw.js with a precache list and a build id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.join(import.meta.dirname, 'sw-template.js');
const SHELL_PAGE = 'training-log/index.html';
const STATIC_EXTRAS = ['/manifest.webmanifest', '/favicon.svg'];
const ABSOLUTE_REF = /\/(?:_astro|fonts|icons)\/[A-Za-z0-9._~-]+/g;
const RELATIVE_REF = /["'`](\.{1,2}\/[A-Za-z0-9._~/-]+\.(?:js|css))["'`]/g;

/** Every same-origin build file the shell page needs, found by following references. */
export function collectPrecache(distDir, shellPage = SHELL_PAGE) {
  const found = new Set(STATIC_EXTRAS);
  const seen = new Set();
  const queue = [];
  const take = (urlPath) => {
    if (found.has(urlPath)) return;
    if (!fs.existsSync(path.join(distDir, urlPath))) return;
    found.add(urlPath);
    if (/\.(js|css)$/.test(urlPath)) queue.push(urlPath);
  };
  const scan = (text, fromUrlPath) => {
    for (const m of text.matchAll(ABSOLUTE_REF)) take(m[0]);
    if (fromUrlPath) {
      for (const m of text.matchAll(RELATIVE_REF)) {
        take(path.posix.normalize(path.posix.join(path.posix.dirname(fromUrlPath), m[1])));
      }
    }
  };
  const html = fs.readFileSync(path.join(distDir, shellPage), 'utf8');
  scan(html, null);
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    scan(fs.readFileSync(path.join(distDir, next), 'utf8'), next);
  }
  return [...found].sort();
}

export function renderWorker(template, precache, shellHtml) {
  const hash = crypto.createHash('sha256');
  hash.update(shellHtml);
  hash.update(template);
  for (const p of precache) hash.update(p);
  const buildId = hash.digest('hex').slice(0, 12);
  return {
    buildId,
    source: template.replace('__BUILD_ID__', buildId).replace('__PRECACHE__', JSON.stringify(precache)),
  };
}

export default function pwaServiceWorker() {
  return {
    name: 'deadhangs-pwa-sw',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const distDir = fileURLToPath(dir);
        const precache = collectPrecache(distDir);
        const shellHtml = fs.readFileSync(path.join(distDir, SHELL_PAGE), 'utf8');
        const { source, buildId } = renderWorker(fs.readFileSync(TEMPLATE, 'utf8'), precache, shellHtml);
        fs.writeFileSync(path.join(distDir, 'sw.js'), source);
        console.log(`[pwa] sw.js ${buildId}, ${precache.length} precached files`);
      },
    },
  };
}
