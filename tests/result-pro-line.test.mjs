import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { SOURCES } from "../src/scripts/training-events.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const LINE = "Holds you log stay on this device. A free account plus Pro keeps them on every device.";

test("result lines use allowlisted placement labels", () => {
  for (const s of ["your_number", "calculator_result", "article"]) assert.ok(SOURCES.has(s), s);
});

test("by-age card shows the Pro line inside the result state only", () => {
  const card = read("src/components/YourNumberCard.tsx");
  const result = card.indexOf("{shown && (");
  const line = card.indexOf(LINE);
  assert.ok(result > 0 && line > result, "line renders only after a result");
  assert.match(card, /href="\/pro\/" data-dh-source="your_number"/);
  assert.equal(card.split('href="/pro/"').length - 1, 1, "one Pro link only");
  assert.doesNotMatch(card, /localStorage|sessionStorage/, "no storage access");
});

test("calculator Pro line is opt-in by prop: on for /dead-hang-calculator/, never the homepage", () => {
  const calc = read("src/components/HangCalculator.tsx");
  assert.match(calc, /proLine = false/);
  assert.match(calc, /\{proLine && \(\n\s+<p className="small-copy calc-pro">/);
  assert.match(calc, /href="\/pro\/" data-dh-source="calculator_result"/);
  assert.ok(calc.indexOf(LINE) > calc.indexOf("{result ? ("), "line renders only after a result");
  assert.doesNotMatch(calc, /localStorage|sessionStorage/, "no storage access");
  assert.match(read("src/pages/dead-hang-calculator/index.astro"), /<HangCalculator client:load proLine \/>/);
  assert.doesNotMatch(read("src/pages/index.astro"), /proLine/);
});

test("money page source is unchanged by this line", () => {
  const page = read("src/pages/dead-hang-time-by-age/index.astro");
  assert.doesNotMatch(page, /\/pro\//, "no Pro link in the by-age page source");
});

test("built pages: Pro line absent before a result; calculator page carries one body link", { skip: !existsSync(new URL("../dist/dead-hang-time-by-age/index.html", import.meta.url)) }, () => {
  const byAge = read("dist/dead-hang-time-by-age/index.html");
  assert.ok(!byAge.includes(LINE), "by-age server HTML has no result line");
  const home = read("dist/index.html");
  assert.ok(!home.includes(LINE), "homepage has no result line");
  const calc = read("dist/dead-hang-calculator/index.html");
  assert.ok(!calc.includes(LINE), "calculator server HTML has no result line before a result");
  assert.match(calc, /<a class="text-link" href="\/pro\/" data-dh-source="article">Keep your log on every device<\/a>/);
});
