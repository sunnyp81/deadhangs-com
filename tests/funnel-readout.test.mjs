import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { METRICS, MONTHLY_PRICE, YEARLY_PRICE, assertSafe, buildQuery, parseRow, renderMarkdown } from "../scripts/funnel-readout.mjs";

test("the readout query is one shell-safe SELECT of aggregates", () => {
  const sql = buildQuery();
  assert.equal(assertSafe(sql), sql);
  assert.doesNotMatch(sql, /["%$`;]/);
  for (const [, , part] of METRICS) assert.match(part, /^SELECT COUNT\((\*|DISTINCT userId)\) FROM /, part);
  assert.doesNotMatch(sql, /\b(email|name|image|token|entries_json|stripe_customer_id|stripe_subscription_id|app_user_ref)\b/i);
});

test("the guard rejects writes, personal columns and shell metacharacters", () => {
  for (const bad of [
    "DELETE FROM [user]",
    "SELECT email FROM [user]",
    'SELECT COUNT(*) FROM "user"',
    "SELECT COUNT(*) FROM [user]; DROP TABLE [user]",
    "SELECT strftime('%Y') AS x",
    "SELECT $(whoami)",
    "SELECT name FROM [user]",
  ]) assert.throws(() => assertSafe(bad), undefined, bad);
});

test("price ids mirror the production wrangler vars", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.ok(config.includes(`"STRIPE_MONTHLY_PRICE_ID": "${MONTHLY_PRICE}"`));
  assert.ok(config.includes(`"STRIPE_YEARLY_PRICE_ID": "${YEARLY_PRICE}"`));
});

const row = Object.fromEntries(METRICS.map(([key], i) => [key, i]));

test("parseRow keeps only allowlisted integer metrics", () => {
  const out = parseRow(JSON.stringify([{ results: [{ ...row, email: "a@b.test", id: "u1" }], success: true }]));
  assert.deepEqual(Object.keys(out), METRICS.map(([key]) => key));
  assert.ok(!("email" in out) && !("id" in out));
  assert.throws(() => parseRow("not json a@b.test"), (e) => !e.message.includes("a@b.test"));
  assert.throws(() => parseRow(JSON.stringify([{ results: [{ ...row, users_total: "a@b.test" }] }])), (e) => !e.message.includes("a@b.test"));
  assert.throws(() => parseRow(JSON.stringify([{ results: [] }])));
});

test("markdown output carries the window, commit and counts only", () => {
  const md = renderMarkdown(parseRow(JSON.stringify([{ results: [row] }])), { generatedAt: "2026-11-10T12:00:00Z", commit: "abc1234" });
  assert.match(md, /Generated 2026-11-10T12:00:00Z \(UTC\)/);
  assert.match(md, /commit `abc1234`/);
  assert.equal(md.split("\n").filter((l) => /^\| (?!Metric|---)/.test(l)).length, METRICS.length);
  assert.doesNotMatch(md, /@/);
  for (const code of [0x2014, 0x2013]) assert.ok(!md.includes(String.fromCharCode(code)));
});
