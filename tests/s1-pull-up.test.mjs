import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { TIMER_PRESETS } from "../src/lib/timer-preset.mjs";

const url = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8").replace(/\r\n/g, "\n");
const built = existsSync(url("dist/dead-hang-pull-up/index.html"));
const LEVEL_1 = TIMER_PRESETS.find((p) => p.id === "level-1").path.replaceAll("&", "&amp;");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

test("pull-up title and meta description are unchanged (CTR guard)", () => {
  const src = read("src/pages/dead-hang-pull-up/index.astro");
  assert.match(src, /const title = 'Dead Hang Pull-Up: How to Start a Pull-Up From a Full Hang';/);
  assert.match(src, /const description = 'A dead hang pull-up starts with straight arms and ends with the chin over the bar\. See how to do one, why it feels harder than a bent-arm start and how hangs lead to a first pull-up\.';/);
});

test("built pull-up page opens with the At a glance card and the Level 1 timer button", { skip: !built }, () => {
  const html = read("dist/dead-hang-pull-up/index.html");
  const body = html.slice(html.indexOf('<div class="article-body">'));
  assert.ok(body.indexOf('class="callout glance"') < body.indexOf("<p>A dead hang pull-up is a pull-up"), "card comes before the intro");
  const card = body.slice(0, body.indexOf("</div>"));
  assert.equal((card.match(/<li>/g) || []).length, 5);
  assert.ok(card.includes(`href="${LEVEL_1}"`), "Level 1 preset link in the card");
  assert.match(card, /data-dh-source="article"[^>]*>Time your first hangs \(free\)</);
});

test("built pull-up page links /pro/ with an allowlisted source", { skip: !built }, () => {
  const html = read("dist/dead-hang-pull-up/index.html");
  const body = html.slice(html.indexOf('<div class="article-body">'), html.indexOf("</article>") > 0 ? html.indexOf("</article>") : undefined);
  assert.match(body, /<a href="\/pro\/" data-dh-source="article">DeadHangs Pro<\/a> keeps the same log on every device for £4\.99 a month or £39 a year\./);
});

test("pull-up FAQ JSON-LD mirrors the visible FAQ", { skip: !built }, () => {
  const html = read("dist/dead-hang-pull-up/index.html");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((d) => d["@type"] === "FAQPage");
  assert.ok(faq, "FAQPage present");
  const visible = [...html.matchAll(/<div class="faq"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [decode(m[1]), decode(m[2])]);
  assert.equal(visible.length, faq.mainEntity.length);
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, visible[i][0]);
    assert.equal(q.acceptedAnswer.text, visible[i][1]);
  });
});

test("every outbound link on the S1 pages opens in a new tab with noopener noreferrer", { skip: !built }, () => {
  for (const p of ["dead-hang-pull-up", "deadhang-benefits", "deadhang-guide"]) {
    const html = read(`dist/${p}/index.html`);
    const main = html.slice(html.indexOf('<div class="article-body">'));
    for (const tag of main.match(/<a\b[^>]*href="https?:\/\/(?!deadhangs\.com)[^"]*"[^>]*>/g) || []) {
      assert.match(tag, /target="_blank"/, `${p}: ${tag}`);
      assert.match(tag, /rel="[^"]*noopener[^"]*"/, `${p}: ${tag}`);
      assert.match(tag, /rel="[^"]*noreferrer[^"]*"/, `${p}: ${tag}`);
    }
  }
});

test("benefits answers 'make you taller' in 40 to 60 words with linked primary sources", { skip: !built }, () => {
  const html = read("dist/deadhang-benefits/index.html");
  const section = html.slice(html.indexOf('id="taller"'), html.indexOf("<h2", html.indexOf('id="taller"') + 5));
  const answer = section.match(/<p><strong>No\.[\s\S]*?<\/p>/)?.[0];
  assert.ok(answer, "answer-first paragraph");
  const words = text(answer).split(" ").length;
  assert.ok(words >= 40 && words <= 60, `answer is ${words} words`);
  for (const src of ["pubmed.ncbi.nlm.nih.gov/21483279", "doi.org/10.1249/00005768-199006000-00016", "doi.org/10.1097/00007632-198503000-00011"]) {
    assert.ok(section.includes(src), src);
  }
});

test("guide At a glance names the muscles worked and links the full list", { skip: !built }, () => {
  const html = read("dist/deadhang-guide/index.html");
  const card = html.slice(html.indexOf('id="at-a-glance"'), html.indexOf("</ol>", html.indexOf('id="at-a-glance"')));
  assert.match(card, /<strong>Muscles worked:<\/strong>/);
  assert.match(card, /href="#muscles-worked"/);
  assert.ok(html.includes('id="muscles-worked"'), "anchor target exists");
});
