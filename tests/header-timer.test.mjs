import test from "node:test";
import assert from "node:assert/strict";
import {
  HEADER_HOLD_SECONDS,
  clock,
  elapsedSeconds,
  isFinished,
  logHref,
  remainingWhole,
  ringFraction,
} from "../src/lib/header-timer.mjs";

test("hold is 30 seconds and the ready clock reads 00:30", () => {
  assert.equal(HEADER_HOLD_SECONDS, 30);
  assert.equal(clock(remainingWhole(0)), "00:30");
});

test("elapsed is clamped to 0..30 and tolerates bad input", () => {
  assert.equal(elapsedSeconds(1000, 500), 0);
  assert.equal(elapsedSeconds(0, 12500), 12.5);
  assert.equal(elapsedSeconds(0, 99999), 30);
  assert.equal(elapsedSeconds(NaN, 5), 0);
});

test("remaining rounds up, so 00:00 only shows at the end", () => {
  assert.equal(remainingWhole(0.1), 30);
  assert.equal(remainingWhole(29.2), 1);
  assert.equal(remainingWhole(30), 0);
});

test("finished only at 30 seconds", () => {
  assert.equal(isFinished(29.99), false);
  assert.equal(isFinished(30), true);
});

test("ring fraction counts down from 1 to 0", () => {
  assert.equal(ringFraction(0), 1);
  assert.equal(ringFraction(15), 0.5);
  assert.equal(ringFraction(30), 0);
  assert.equal(ringFraction(45), 0);
});

test("log link carries whole seconds, full hold when finished", () => {
  assert.equal(logHref(30), "/training-log/?hold=30");
  assert.equal(logHref(12.9), "/training-log/?hold=12");
  assert.equal(logHref(1), "/training-log/?hold=1");
  assert.equal(logHref(0.6), null);
});

test("clock formats mm:ss", () => {
  assert.equal(clock(0), "00:00");
  assert.equal(clock(9), "00:09");
  assert.equal(clock(65), "01:05");
});
