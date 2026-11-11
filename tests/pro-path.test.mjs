import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { PRO_NUDGE_KEY, nudgeDismissed, dismissNudge, showSaveNudge, showProgressNudge } from "../src/lib/pro-nudge.mjs";
import { PRO_FAQ, PRO_PRICES, proSchema } from "../src/lib/pro-page.mjs";
import { FEATURES, SOURCES } from "../src/scripts/training-events.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("nudge dismissal persists in storage and fails quiet when storage is blocked", () => {
  const s = memory();
  assert.equal(nudgeDismissed(s), false);
  assert.equal(dismissNudge(s), true);
  assert.equal(s.getItem(PRO_NUDGE_KEY), "dismissed");
  assert.equal(nudgeDismissed(s), true);
  assert.equal(nudgeDismissed(blocked), true, "unreadable storage shows no nudge");
  assert.equal(dismissNudge(blocked), false);
});

test("post-save line needs two entries, progress line needs three", () => {
  assert.deepEqual([0, 1, 2, 3].map(showSaveNudge), [false, false, true, true]);
  assert.deepEqual([0, 2, 3, 200].map(showProgressNudge), [false, false, true, true]);
  assert.equal(showSaveNudge(Number.NaN), false);
});

test("nudge events and placements are on the consented allowlist", () => {
  assert.ok(FEATURES.has("pro_nudge_dismissed"));
  assert.ok(FEATURES.has("pro_link_click"));
  for (const s of ["post_save", "progress", "log_header", "pro_page"]) assert.ok(SOURCES.has(s), s);
});

test("nudges are opt-in by prop: on for /training-log/ only, never the homepage", () => {
  const journey = read("src/components/TrainingJourney.tsx");
  assert.match(journey, /<TrainingWorkspace[^>]*\n\s+proNudges\n/);
  assert.match(journey, /<ProgressSummary entries=\{entries\} profile=\{profile\} proNudges \/>/);
  assert.doesNotMatch(read("src/pages/index.astro"), /proNudges/);
  assert.match(read("src/components/TrainingWorkspace.tsx"), /proNudges = false/);
  assert.match(read("src/components/ProgressSummary.tsx"), /proNudges = false/);
  const ws = read("src/components/TrainingWorkspace.tsx");
  assert.match(ws, /href="\/pro\/" data-dh-source="post_save"/);
  assert.match(ws, /trackFeature\('pro_nudge_dismissed', \{ source: 'post_save' \}\)/);
  assert.match(read("src/components/ProgressSummary.tsx"), /href="\/pro\/" data-dh-source="progress"/);
});

test("pricing page copy and schema use the real prices and eight FAQs", () => {
  assert.deepEqual(PRO_PRICES, { monthly: "4.99", yearly: "39" });
  assert.equal(PRO_FAQ.length, 8);
  const blocks = [...proSchema("https://deadhangs.com/pro/").matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
  assert.deepEqual(app.offers.map((o) => [o.price, o.priceCurrency, o.priceSpecification.billingDuration]), [["4.99", "GBP", "P1M"], ["39", "GBP", "P1Y"]]);
  assert.ok(!("aggregateRating" in app) && !("review" in app), "no ratings or reviews");
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  assert.deepEqual(faq.mainEntity.map((q) => q.name), PRO_FAQ.map((q) => q.q));
});

test("pricing sign-in asks for /pro/ and the pricing page link reports pro_page", () => {
  const ws = read("src/components/AccountWorkspace.tsx");
  assert.match(ws, /json\('POST', signInBody\(pricing\)\)/);
  assert.match(ws, /<a href="\/account\/" data-dh-source="pro_page">Open your cloud log<\/a>/);
  assert.match(read("src/server/auth.ts"), /ALLOWED_CALLBACK_PATHS = \['\/training-log\/', '\/account\/', '\/pro\/'\]/);
});

test("/pro/ is indexable: no noindex header, in the sitemap filter", () => {
  const headers = read("public/_headers").replace(/\r\n/g, "\n");
  const pro = headers.split(/\n\s*\n/).find((b) => b.trim().startsWith("/pro/*"));
  assert.ok(pro.includes("Cache-Control: no-store") && pro.includes("Referrer-Policy: no-referrer"));
  assert.doesNotMatch(pro, /X-Robots-Tag/i);
  assert.doesNotMatch(read("astro.config.mjs"), /'\/pro\/'/);
});

const built = (p) => new URL(`../dist/${p}`, import.meta.url);
test("built /pro/: indexable, canonical, sitemap, visible FAQ, example label, offers", { skip: !existsSync(built("pro/index.html")) }, () => {
  const html = readFileSync(built("pro/index.html"), "utf8");
  assert.doesNotMatch(html, /<meta name="robots"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/deadhangs\.com\/pro\/">/);
  assert.match(readFileSync(built("sitemap-0.xml"), "utf8"), /<loc>https:\/\/deadhangs\.com\/pro\/<\/loc>/);
  assert.equal((html.match(/<div class="pro-faq-item"/g) || []).length, 8);
  assert.doesNotMatch(html, /<details/, "no collapsed content on /pro/");
  for (const item of PRO_FAQ) assert.ok(html.includes(item.q), item.q);
  assert.match(html, />EXAMPLE</);
  assert.match(html, /Example with made-up values, not a real account/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /"price":"4.99","priceCurrency":"GBP"/);
  assert.match(html, /"price":"39","priceCurrency":"GBP"/);
  assert.doesNotMatch(html, /aggregateRating|"Review"/);
  assert.doesNotMatch(html, /\u2014|\u2013|\uFFFD/);
});

test("built /training-log/ carries the log header Pro link", { skip: !existsSync(built("training-log/index.html")) }, () => {
  const html = readFileSync(built("training-log/index.html"), "utf8");
  assert.match(html, /<a href="\/pro\/" data-dh-source="log_header">See Pro<\/a>/);
  const body = html.replace(/<footer[\s\S]*<\/footer>/, "");
  assert.equal((body.match(/href="\/pro\/"/g) || []).length, 1, "one Pro link in the static page outside the footer");
});

test("nudge helpers survive a localStorage getter that throws (blocked site data)", () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    assert.equal(nudgeDismissed(), true);
    assert.equal(dismissNudge(), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, "localStorage", desc); else delete globalThis.localStorage;
  }
  for (const f of ["src/components/TrainingWorkspace.tsx", "src/components/ProgressSummary.tsx"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /(nudgeDismissed|dismissNudge)\(window\.localStorage\)/, `${f} must not read storage outside the helper's try`);
  }
});
