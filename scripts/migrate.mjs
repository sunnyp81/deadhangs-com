#!/usr/bin/env node
// Migrates old static HTML pages into Astro article pages.
// Extracts title, description, body content, and schema from each directory's index.html.

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

const ROOT = process.cwd();
const SRC_PAGES = join(ROOT, 'src', 'pages');

// Directories to skip (not content pages, or already handled)
const SKIP = new Set([
  'public', 'src', 'node_modules', 'dist', '.git', '.wrangler', 'images',
  'scripts', '404.html',
]);

// Files at root level that aren't directories
const ROOT_FILES = new Set([
  '.gitignore', '404.html', 'ads.txt', 'favicon.svg', 'index.html',
  'INTERNAL_LINKING_STRUCTURE.md', 'LINKING_EXAMPLES.md', 'logo.svg',
  'og-image.svg', 'README.md', 'robots.txt', 'sitemap.xml', 'styles.css',
  '_headers', 'astro.config.mjs', 'package.json', 'package-lock.json',
  'tsconfig.json',
]);

function extractBetween(html, startTag, endTag) {
  const s = html.indexOf(startTag);
  if (s === -1) return '';
  const e = html.indexOf(endTag, s);
  if (e === -1) return '';
  return html.slice(s + startTag.length, e).trim();
}

function extractTag(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : '';
}

function extractSchemas(html) {
  const schemas = [];
  const re = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    schemas.push(m[1].trim());
  }
  return schemas;
}

function extractArticleContent(html) {
  // Try to extract content inside <article class="article">...</article>
  const articleStart = html.indexOf('<article');
  if (articleStart === -1) return extractMainContent(html);
  const articleEnd = html.indexOf('</article>', articleStart);
  if (articleEnd === -1) return extractMainContent(html);
  return html.slice(articleStart, articleEnd + '</article>'.length);
}

function extractMainContent(html) {
  // Fallback: extract between <main> tags
  const mainStart = html.indexOf('<main');
  if (mainStart === -1) return '';
  const mainEnd = html.indexOf('</main>', mainStart);
  if (mainEnd === -1) return '';
  return html.slice(mainStart, mainEnd + '</main>'.length);
}

function extractBodyContent(html) {
  // Extract the content inside <div class="container"> within the article
  // but skip navigation, footer, etc.
  let content = extractArticleContent(html);
  if (!content) {
    // Last resort: grab everything in <body> minus nav and footer
    const bodyStart = html.indexOf('<body');
    const bodyEnd = html.indexOf('</body>');
    if (bodyStart !== -1 && bodyEnd !== -1) {
      content = html.slice(bodyStart, bodyEnd);
    }
  }
  return content;
}

function stripNavAndFooter(html) {
  // Remove <nav>...</nav> blocks
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  // Remove <footer>...</footer> blocks
  html = html.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // Remove cookie banner
  html = html.replace(/<div class="cookie-banner[\s\S]*?<\/div>\s*<\/div>/gi, '');
  // Remove ambient-bg div
  html = html.replace(/<div class="ambient-bg[\s\S]*?<\/div>\s*<\/div>/gi, '');
  // Remove mobile-nav
  html = html.replace(/<div class="mobile-nav[\s\S]*?<\/div>\s*<\/div>/gi, '');
  return html;
}

function cleanContent(html) {
  // Remove old style and script tags (except schema and calculator scripts)
  html = html.replace(/<link rel="stylesheet"[^>]*>/gi, '');
  html = html.replace(/<style>[\s\S]*?<\/style>/gi, '');
  // Keep inline styles on elements but remove standalone style blocks
  // Remove old JS that handles nav, cookie banner, etc
  html = html.replace(/<script(?!\s+type="application\/ld\+json")[\s\S]*?<\/script>/gi, '');
  // Remove Google Fonts links (handled by layout)
  html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, '');
  html = html.replace(/<link[^>]*fonts\.gstatic[^>]*>/gi, '');
  // Remove meta tags (handled by layout)
  html = html.replace(/<meta[^>]*>/gi, '');
  // Remove title tag
  html = html.replace(/<title>[\s\S]*?<\/title>/gi, '');
  // Remove html, head, body wrapper tags
  html = html.replace(/<\/?html[^>]*>/gi, '');
  html = html.replace(/<head>[\s\S]*?<\/head>/gi, '');
  html = html.replace(/<\/?body[^>]*>/gi, '');
  html = html.replace(/<!doctype[^>]*>/gi, '');
  // Remove schema scripts (moved to layout)
  html = html.replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');
  return html.trim();
}

function fixInternalLinks(html) {
  // Ensure internal links use relative paths
  html = html.replace(/href="https?:\/\/deadhangs\.com\//g, 'href="/');
  return html;
}

// CTR-optimized titles for top pages
const TITLE_OVERRIDES = {
  'dead-hang-time-by-age': 'Dead Hang Time by Age: Standards, Charts & Percentiles (2026)',
  'dead-hang-world-record': 'Dead Hang World Record: Male & Female Records by Age (2026)',
  'deadhang-guide': 'Dead Hang Guide: How to Hang, Benefits & Training Protocol',
};

const DESC_OVERRIDES = {
  'dead-hang-time-by-age': 'Average dead hang times by age and gender. See where you rank with our percentile charts for men and women aged 13-70+.',
  'dead-hang-world-record': 'Current dead hang world records for men and women. Harald Riise holds 16:03. Full record history, rules, and age-group records.',
  'deadhang-guide': 'Complete dead hang guide covering form, grip positions, benefits, programming, and a 12-week protocol for beginners to advanced.',
};

async function migrate() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map(e => e.name);

  console.log(`Found ${dirs.length} content directories to migrate.\n`);

  let migrated = 0;
  let skipped = 0;

  for (const dir of dirs) {
    const htmlPath = join(ROOT, dir, 'index.html');
    if (!existsSync(htmlPath)) {
      console.log(`  SKIP ${dir} — no index.html`);
      skipped++;
      continue;
    }

    let html = await readFile(htmlPath, 'utf-8');

    // Extract metadata
    const title = TITLE_OVERRIDES[dir] || extractTag(html, /<title>([^<]+)<\/title>/i) || dir;
    const desc = DESC_OVERRIDES[dir] || extractTag(html, /<meta\s+name="description"\s+content="([^"]+)"/i) || '';
    const schemas = extractSchemas(html);

    // Extract and clean content
    html = stripNavAndFooter(html);
    html = cleanContent(html);
    html = fixInternalLinks(html);

    // Build schema string
    let schemaHtml = '';
    if (schemas.length) {
      schemaHtml = schemas.map(s => `<script type="application/ld+json">${s}</script>`).join('\n');
    }

    // Escape backticks and ${} in content for Astro template
    const safeContent = html
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');

    // Create Astro page
    const astroPage = `---
import Article from '../../layouts/Article.astro';
---

<Article
  title="${title.replace(/"/g, '&quot;')}"
  description="${desc.replace(/"/g, '&quot;')}"
  canonical="https://deadhangs.com/${dir}/"
  schema={\`${schemaHtml.replace(/`/g, '\\`')}\`}
>
  <div class="article-header">
    <div class="article-breadcrumb">
      <a href="/">Home</a><span class="sep">/</span>${title.split(':')[0].trim()}
    </div>
  </div>
  <div class="article-body">
    <Fragment set:html={\`${safeContent}\`} />
  </div>
</Article>
`;

    const outDir = join(SRC_PAGES, dir);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'index.astro'), astroPage, 'utf-8');
    console.log(`  ✓ ${dir}`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
}

migrate().catch(console.error);
