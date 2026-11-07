import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const src = readFileSync(new URL("../public/_headers", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const blocks = src.split(/\n\s*\n/).map((b) => {
  const [rule, ...headers] = b.trim().split("\n");
  return { rule: rule.trim(), headers: headers.map((h) => h.trim()) };
});
const block = (rule) => blocks.find((b) => b.rule === rule);

test("noindex is scoped to previews, widgets and account pages, never the whole apex site", () => {
  for (const { rule, headers } of blocks) {
    if (headers.some((h) => /x-robots-tag:\s*noindex/i.test(h))) assert.match(rule, /^(https:\/\/(:version\.)?:project\.pages\.dev\/\*|\/(embed|account|pro)\/\*)$/);
  }
});

test("X-Frame-Options DENY still applies to /* and is detached only under /embed/*", () => {
  assert.ok(block("/*").headers.includes("X-Frame-Options: DENY"));
  for (const { rule, headers } of blocks) {
    const touches = headers.some((h) => /x-frame-options/i.test(h));
    if (rule === "/*") continue;
    if (touches) {
      assert.equal(rule, "/embed/*");
      assert.deepEqual(headers.filter((h) => /x-frame-options/i.test(h)), ["! X-Frame-Options"]);
    }
  }
  assert.ok(block("/embed/*").headers.includes("Content-Security-Policy: frame-ancestors *"));
  assert.ok(block("/embed/*").headers.includes("X-Robots-Tag: noindex"));
  assert.ok(!blocks.some((b) => b.rule !== "/embed/*" && b.headers.some((h) => /frame-ancestors/i.test(h))));
});

test("built dist/_headers keeps the same framing rules", { skip: !existsSync(new URL("../dist/_headers", import.meta.url)) }, () => {
  const dist = readFileSync(new URL("../dist/_headers", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(dist, /^\/\*\n\s+X-Frame-Options: DENY/m);
  assert.match(dist, /\/embed\/\*\n\s+! X-Frame-Options\n\s+Content-Security-Policy: frame-ancestors \*/);
});

test("embed page is noindex, has no analytics, consent banner, nav or service worker", () => {
  const f = new URL("../dist/embed/timer/index.html", import.meta.url);
  if (!existsSync(f)) return;
  const html = readFileSync(f, "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  for (const bad of ["googletagmanager", "G-YBPRQVR2Y3", "cookie-banner", "serviceWorker", "<nav", "<footer", "application/ld+json"]) assert.ok(!html.includes(bad), bad);
});
