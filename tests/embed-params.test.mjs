import test from "node:test";
import assert from "node:assert/strict";
import { parseEmbedParams, buildEmbedUrl, buildEmbedCode, EMBED_CREDIT_HTML } from "../src/lib/embed-params.mjs";

test("defaults when nothing is given", () => {
  assert.deepEqual(parseEmbedParams(""), { work: 30, rest: 60, rounds: 3, theme: "dark" });
});
test("values are clamped to the timer limits", () => {
  assert.deepEqual(parseEmbedParams("?work=999&rest=1&rounds=50&theme=light"), { work: 120, rest: 10, rounds: 10, theme: "light" });
  assert.deepEqual(parseEmbedParams("?work=0&rest=9999&rounds=0"), { work: 5, rest: 300, rounds: 1, theme: "dark" });
});
test("junk falls back to defaults", () => {
  assert.deepEqual(parseEmbedParams("?work=abc&rest=-5&rounds=1.5&theme=<script>"), { work: 30, rest: 60, rounds: 3, theme: "dark" });
});
test("embed URL leaves defaults out and round-trips", () => {
  assert.equal(buildEmbedUrl("https://deadhangs.com", { work: 30, rest: 60, rounds: 3, theme: "dark" }), "https://deadhangs.com/embed/timer/");
  const u = buildEmbedUrl("https://deadhangs.com", { work: 45, rest: 90, rounds: 5, theme: "light" });
  assert.equal(u, "https://deadhangs.com/embed/timer/?work=45&rest=90&rounds=5&theme=light");
  assert.deepEqual(parseEmbedParams(new URL(u).search), { work: 45, rest: 90, rounds: 5, theme: "light" });
});
test("embed code has the iframe and the optional plain credit line", () => {
  const code = buildEmbedCode("https://deadhangs.com", { work: 30, rest: 60, rounds: 3, theme: "dark" });
  assert.match(code, /^<iframe src="https:\/\/deadhangs\.com\/embed\/timer\/"/);
  assert.ok(code.endsWith(EMBED_CREDIT_HTML));
  assert.equal(EMBED_CREDIT_HTML, '<p>Dead hang timer by <a href="https://deadhangs.com/training-log/">DeadHangs.com</a></p>');
  assert.ok(!buildEmbedCode("https://deadhangs.com", {}, { credit: false }).includes("<p>"));
  assert.match(buildEmbedCode("https://deadhangs.com", {}, { width: "evil\"" }), /width="100%"/);
});
