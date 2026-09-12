import assert from "node:assert/strict";
import test from "node:test";
import { progressFor } from "../src/lib/training-progress.mjs";

const entry = (date, seconds, assistance = "unassisted") => ({ id: `${date}-${seconds}-${assistance}`, date, seconds, assistance, sets: 1 });

test("30-day calendar window includes today and the prior 29 local dates across DST and year boundaries", () => {
  const progress = progressFor([
    entry("2025-12-02", 10),
    entry("2025-12-03", 11),
    entry("2026-01-01", 20),
    entry("2026-01-02", 99),
  ], "unassisted", null, new Date(2026, 0, 1), 30);
  assert.equal(progress.windowStart, "2025-12-03");
  assert.deepEqual(progress.selectedWindow, [{ date: "2025-12-03", seconds: 11 }, { date: "2026-01-01", seconds: 20 }]);
  assert.equal(progress.windowChange, 9);
});

test("daily best, assistance separation and one-date window prevent an invented trend", () => {
  const progress = progressFor([
    entry("2026-09-10", 20),
    entry("2026-09-10", 25),
    entry("2026-09-11", 80, "feet-supported"),
    entry("2026-09-13", 999),
  ], "unassisted", 20, new Date(2026, 8, 12), 30);
  assert.deepEqual(progress.daily, [{ date: "2026-09-10", seconds: 25 }]);
  assert.equal(progress.latest.seconds, 25);
  assert.equal(progress.allTimeBest, 25);
  assert.equal(progress.windowChange, null);
  assert.equal(progress.visualTargetPercent, 100);
});

test("latest actual, all-time best, current ISO-week practice days and uncapped actual goal value stay distinct", () => {
  const progress = progressFor([
    entry("2026-09-01", 70),
    entry("2026-09-07", 20),
    entry("2026-09-08", 30),
    entry("2026-09-11", 40),
  ], "unassisted", 30, new Date(2026, 8, 12), 90);
  assert.equal(progress.latest.seconds, 40);
  assert.equal(progress.allTimeBest, 70);
  assert.equal(progress.practiceDaysThisWeek, 3);
  assert.equal(progress.windowChange, -30);
  assert.equal(progress.visualTargetPercent, 100);
});
