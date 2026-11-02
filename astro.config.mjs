// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import pwaServiceWorker from './scripts/pwa-sw.mjs';
import externalLinksNewTab from './scripts/external-links.mjs';

// lastmod comes from the page's own dateModified; pages without one get no lastmod rather than a made-up date.
const lastmodFor = (url) => {
  const slug = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  const file = slug ? `src/pages/${slug}/index.astro` : 'src/pages/index.astro';
  try {
    const m = fs.readFileSync(file, 'utf8').match(/dateModified['"]?\s*[:=]\s*['"](\d{4}-\d{2}-\d{2})['"]/);
    return m ? m[1] : undefined;
  } catch { return undefined; }
};

export default defineConfig({
  // Preserve Astro 6 spacing between inline elements after the security upgrade.
  compressHTML: true,
  site: 'https://deadhangs.com',
  integrations: [react(), sitemap({
    filter: (page) => !page.includes('/bar-card/'),
    serialize(item) {
      const lastmod = lastmodFor(item.url);
      if (lastmod) item.lastmod = new Date(lastmod).toISOString();
      return item;
    },
  }), externalLinksNewTab(), pwaServiceWorker()],
  vite: {
    plugins: [tailwindcss()],
  },
});
