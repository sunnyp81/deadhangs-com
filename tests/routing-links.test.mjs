import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { TIMER_PRESETS } from "../src/lib/timer-preset.mjs";

const url = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8").replace(/\r\n/g, "\n");
const built = existsSync(url("dist/index.html"));
const LEVEL_1 = TIMER_PRESETS.find((p) => p.id === "level-1").path.replaceAll("&", "&amp;");
const PAGES = ["deadhang-guide", "deadhang-progressions", "how-to-deadhang", "4-week-program", "deadhang-benefits"];
const startHref = (html) => html.match(/<nav id="primary-navigation"[\s\S]*?<a href="([^"]*)"[^>]*>Start/)?.[1];

test("nav Start keeps /#timer on the homepage only", () => {
  const nav = read("src/components/Nav.astro");
  assert.match(nav, /href: Astro\.url\.pathname === '\/' \? '\/#timer' : '\/training-log\/'/);
});

test("footer splits Pro and account into two labelled links", () => {
  const footer = read("src/components/Footer.astro");
  assert.match(footer, /\{ label: "Pro: cloud sync", href: "\/pro\/" \}/);
  assert.match(footer, /\{ label: "Your account", href: "\/account\/" \}/);
  assert.doesNotMatch(footer, /Account & Pro/);
});

test("IndexNow key file holds its own name", () => {
  const keys = readdirSync(url("public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.equal(keys.length, 1);
  assert.equal(read(`public/${keys[0]}`), keys[0].replace(".txt", ""));
});

test("built nav: homepage Start is /#timer, inner pages go to /training-log/", { skip: !built }, () => {
  assert.equal(startHref(read("dist/index.html")), "/#timer");
  for (const p of ["dead-hang-time-by-age", "deadhang-guide", "pro", "training-log"]) {
    assert.equal(startHref(read(`dist/${p}/index.html`)), "/training-log/", p);
  }
});

test("built footer carries both links with the footer source", { skip: !built }, () => {
  const html = read("dist/deadhang-guide/index.html");
  assert.match(html, /<a href="\/pro\/" data-dh-source="footer"[^>]*>Pro: cloud sync<\/a>/);
  assert.match(html, /<a href="\/account\/" data-dh-source="footer"[^>]*>Your account<\/a>/);
});

test("each named page links the Level 1 timer session exactly once", { skip: !built }, () => {
  for (const p of PAGES) {
    const html = read(`dist/${p}/index.html`);
    assert.equal(html.split(`href="${LEVEL_1}"`).length - 1, 1, p);
  }
  assert.match(read("dist/deadhang-guide/index.html"), new RegExp(`<a href="${LEVEL_1.replace(/[?]/g, "\\?")}" class="cta-btn">Time your first holds \\(free\\)</a>`));
});

test("guide Level 1 CTA sits inside the At a glance actions, before the first H2", { skip: !built }, () => {
  const html = read("dist/deadhang-guide/index.html");
  const cta = html.indexOf("Time your first holds (free)");
  const glance = html.indexOf('id="at-a-glance"');
  const firstH2 = html.indexOf("<h2", glance);
  assert.ok(glance > 0 && cta > glance && cta < firstH2);
});
