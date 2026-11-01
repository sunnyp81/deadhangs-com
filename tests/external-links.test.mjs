import test from "node:test";
import assert from "node:assert/strict";
import { isExternal, openExternalLinksInNewTab } from "../src/lib/external-links.mjs";

const S = "deadhangs.com";
test("detects external hosts", () => {
  assert.equal(isExternal("https://doi.org/10.1/x", S), true);
  assert.equal(isExternal("https://deadhangs.com/guide/", S), false);
  assert.equal(isExternal("https://www.deadhangs.com/", S), false);
  assert.equal(isExternal("/guide/", S), false);
  assert.equal(isExternal("mailto:a@b.com", S), false);
  assert.equal(isExternal("#top", S), false);
});
test("adds target and rel to external links", () => {
  assert.equal(openExternalLinksInNewTab('<a href="https://doi.org/x">d</a>', S), '<a rel="noopener noreferrer" target="_blank" href="https://doi.org/x">d</a>');
});
test("keeps existing rel tokens and replaces other targets", () => {
  const out = openExternalLinksInNewTab('<a class="x" href="https://www.amazon.co.uk/s?k=a&amp;tag=t" rel="nofollow sponsored" target="_self">A</a>', S);
  assert.match(out, /rel="nofollow sponsored noopener noreferrer"/);
  assert.match(out, /target="_blank"/);
  assert.doesNotMatch(out, /_self/);
});
test("leaves internal links alone", () => {
  const html = '<a href="/training-log/">t</a><a href="https://deadhangs.com/x/">x</a>';
  assert.equal(openExternalLinksInNewTab(html, S), html);
});
test("is idempotent", () => {
  const once = openExternalLinksInNewTab('<a href="https://nhs.uk/" rel="noopener noreferrer" target="_blank">n</a>', S);
  assert.equal(openExternalLinksInNewTab(once, S), once);
  assert.equal((once.match(/target=/g) || []).length, 1);
});
