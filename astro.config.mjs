// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Preserve Astro 6 spacing between inline elements after the security upgrade.
  compressHTML: true,
  site: 'https://deadhangs.com',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
