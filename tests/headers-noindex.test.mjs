import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("noindex only applies to pages.dev hosts, never to the apex", () => {
  const blocks = readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split(/\n\s*\n/);
  for (const block of blocks) {
    const [rule, ...headers] = block.trim().split("\n");
    if (headers.some((h) => /x-robots-tag:\s*noindex/i.test(h))) assert.match(rule.trim(), /^https:\/\/(:version\.)?:project\.pages\.dev\/\*$/);
  }
});
