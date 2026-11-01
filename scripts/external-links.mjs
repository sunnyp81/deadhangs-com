import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openExternalLinksInNewTab } from "../src/lib/external-links.mjs";

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(p);
    else if (entry.name.endsWith(".html")) yield p;
  }
}

export default function externalLinksNewTab({ siteHost = "deadhangs.com" } = {}) {
  return {
    name: "external-links-new-tab",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        let changed = 0;
        for await (const file of htmlFiles(fileURLToPath(dir))) {
          const before = await readFile(file, "utf8");
          const after = openExternalLinksInNewTab(before, siteHost);
          if (after !== before) { await writeFile(file, after, "utf8"); changed++; }
        }
        logger.info(`external links set to open in a new tab in ${changed} files`);
      },
    },
  };
}
