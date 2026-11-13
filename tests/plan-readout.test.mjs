import test from "node:test";
import assert from "node:assert/strict";
import { assertSafe, metricsSql, parseArgs, parseMetrics, parseReasons, reasonsSql, renderMarkdown, renderMissingTable, tableCheckSql } from "../scripts/plan-readout.mjs";

const NOW = new Date("2026-11-13T12:00:00Z");

test("dates default to the 28 days ending today and must be real calendar dates", () => {
  assert.deepEqual(parseArgs([], NOW), { from: "2026-10-17", to: "2026-11-13" });
  assert.deepEqual(parseArgs(["--from", "2026-11-21", "--to", "2026-11-27"], NOW), { from: "2026-11-21", to: "2026-11-27" });
  assert.throws(() => parseArgs(["--from", "2026-02-30"], NOW), /not a real date/);
  assert.throws(() => parseArgs(["--from", "21/11/2026"], NOW), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--from", "2026-11-21", "--to", "2026-11-01"], NOW), /after/);
  assert.throws(() => parseArgs(["--since", "2026-11-01"], NOW), /unknown argument/);
});

test("every readout query is one shell-safe SELECT that names no personal column", () => {
  const range = { from: "2026-11-21", to: "2026-11-27" };
  for (const sql of [tableCheckSql(), metricsSql(range), reasonsSql(range)]) {
    assert.equal(assertSafe(sql), sql);
    assert.doesNotMatch(sql, /["%$`;]/);
    assert.doesNotMatch(sql, /\b(email|token|token_hash|inputs|payment_intent_id|checkout_session_id)\b/i);
  }
  assert.match(metricsSql(range), /unixepoch\('2026-11-21'\)/);
  assert.match(metricsSql(range), /unixepoch\('2026-11-27', '\+1 day'\)/);
});

test("aggregate output keeps only allowlisted non-negative integers", () => {
  const stdout = JSON.stringify([{ results: [{ purchases_in_window: 3, paid_in_window: 2, refunded_in_window: 1, refunds_dated_in_window: 1, purchases_all_time: 4 }] }]);
  assert.deepEqual(parseMetrics(stdout), { purchases_in_window: 3, paid_in_window: 2, refunded_in_window: 1, refunds_dated_in_window: 1, purchases_all_time: 4 });
  assert.throws(() => parseMetrics(JSON.stringify([{ results: [{ purchases_in_window: -1 }] }])), /non-negative/);
  assert.throws(() => parseMetrics("not json"), /not JSON/);
});

test("reasons are counted, and free text or blank values are never printed", () => {
  const stdout = JSON.stringify([{ results: [
    { reason: "lost_weight_sessions", n: 2 },
    { reason: null, n: 1 },
    { reason: "me@example.com", n: 1 },
    { reason: "tried_free_pages", n: 3 },
  ] }]);
  assert.deepEqual(parseReasons(stdout), [
    ["tried_free_pages", 3],
    ["lost_weight_sessions", 2],
    ["not_answered", 1],
    ["other_text_not_shown", 1],
  ].sort((a, b) => b[1] - a[1]));
  assert.equal(parseReasons(JSON.stringify([{ results: [] }])).length, 0);
});

test("the markdown report and the missing-table note carry no free text", () => {
  const md = renderMarkdown(
    { purchases_in_window: 0, paid_in_window: 0, refunded_in_window: 0, refunds_dated_in_window: 0, purchases_all_time: 0 },
    [],
    { range: { from: "2026-11-21", to: "2026-11-27" }, generatedAt: "2026-11-13T12:00:00Z", commit: "abc1234" },
  );
  assert.match(md, /Window 2026-11-21 to 2026-11-27/);
  assert.match(md, /\| \(none\) \| 0 \|/);
  assert.match(renderMissingTable(), /Migration 0003 is not applied yet/);
});
