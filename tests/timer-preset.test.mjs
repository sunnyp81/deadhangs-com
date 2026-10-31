import test from "node:test";
import assert from "node:assert/strict";
import { buildTimerQuery, parseTimerParams, TIMER_PRESETS } from "../src/lib/timer-preset.mjs";
import { validTimerConfig, validTimerLoad } from "../src/lib/timer-state.mjs";
import { hapticKindFor, vibrateFor, supportsVibrate, HAPTIC_PATTERNS } from "../src/lib/timer-feedback.mjs";

test("empty or unrelated query returns null", () => {
  assert.equal(parseTimerParams(""), null);
  assert.equal(parseTimerParams("?hold=45"), null);
  assert.equal(parseTimerParams("?mode=banana&hang=abc&rounds=-1"), null);
});

test("simple preset parses to a valid config", () => {
  const r = parseTimerParams("?mode=simple&hang=15&rest=90&rounds=3&prep=5");
  assert.deepEqual(r.config, { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 });
  assert.ok(validTimerConfig(r.config));
  assert.equal(r.voice, undefined);
});

test("values clamp to control limits", () => {
  const r = parseTimerParams("?hang=9999&rest=1&rounds=99&prep=9");
  assert.equal(r.config.workSeconds, 120);
  assert.equal(r.config.restSeconds, 10);
  assert.equal(r.config.rounds, 10);
  assert.equal(r.config.prepSeconds, 10);
  assert.ok(validTimerConfig(r.config));
  assert.equal(parseTimerParams("?hang=0").config.workSeconds, 5);
});

test("emom caps hang at 50 and ignores rest", () => {
  const r = parseTimerParams("?mode=emom&hang=90&rest=200");
  assert.equal(r.config.workSeconds, 50);
  assert.equal(r.config.restSeconds, 60);
  assert.ok(validTimerConfig(r.config));
});

test("bad values are ignored but good ones kept", () => {
  const r = parseTimerParams("?hang=20&rest=abc&rounds=2.5&prep=&mode=BOGUS&voice=yes");
  assert.deepEqual(r.config, { mode: "simple", workSeconds: 20, restSeconds: 60, rounds: 3, prepSeconds: 0 });
  assert.equal(r.voice, undefined);
});

test("mode is case-insensitive and max maps to test", () => {
  const r = parseTimerParams("?mode=MAX&prep=5");
  assert.equal(r.config.mode, "test");
  assert.ok(validTimerConfig(r.config));
  assert.deepEqual(r.maxTest, { warmups: 2, restSeconds: 120 });
});

test("max mode maps rest to the nearest choice and clamps warmups", () => {
  const r = parseTimerParams("?mode=max&rest=100&warmups=9");
  assert.deepEqual(r.maxTest, { warmups: 3, restSeconds: 120 });
  assert.equal(parseTimerParams("?mode=max&rest=0").maxTest.restSeconds, 0);
  assert.equal(parseTimerParams("?mode=max&rest=500").maxTest.restSeconds, 180);
});

test("voice flag", () => {
  assert.equal(parseTimerParams("?voice=1").voice, true);
  assert.equal(parseTimerParams("?voice=0").voice, false);
});

test("hold param alongside timer params does not interfere", () => {
  const r = parseTimerParams("?hold=45&mode=simple&hang=15");
  assert.equal(r.config.workSeconds, 15);
});

test("round trip: build then parse returns the same settings", () => {
  const cases = [
    { config: { mode: "simple", workSeconds: 25, restSeconds: 120, rounds: 4, prepSeconds: 10 }, voice: true },
    { config: { mode: "ladder", workSeconds: 20, restSeconds: 45, rounds: 6, prepSeconds: 0 } },
    { config: { mode: "emom", workSeconds: 40, restSeconds: 60, rounds: 5, prepSeconds: 5 } },
    { config: { mode: "test", workSeconds: 30, restSeconds: 60, rounds: 3, prepSeconds: 5 }, maxTest: { warmups: 1, restSeconds: 180 }, voice: true },
  ];
  for (const c of cases) {
    const parsed = parseTimerParams(buildTimerQuery(c));
    assert.deepEqual(parsed.config, c.config);
    assert.equal(parsed.voice ?? false, c.voice ?? false);
    if (c.maxTest) assert.deepEqual(parsed.maxTest, c.maxTest);
    assert.ok(validTimerLoad({ requestId: "x", ...parsed }));
  }
});

test("presets use canonical values only", () => {
  assert.equal(TIMER_PRESETS.length, 3);
  const l1 = parseTimerParams(TIMER_PRESETS[0].query);
  assert.deepEqual(l1.config, { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 });
  const voice = parseTimerParams(TIMER_PRESETS[1].query);
  assert.deepEqual(voice.config, l1.config);
  assert.equal(voice.voice, true);
  const max = parseTimerParams(TIMER_PRESETS[2].query);
  assert.equal(max.config.mode, "test");
  assert.deepEqual(max.maxTest, { warmups: 2, restSeconds: 120 });
});

test("validTimerLoad rejects bad optional fields", () => {
  const config = { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 };
  assert.ok(validTimerLoad({ requestId: "a", config, voice: true }));
  assert.ok(!validTimerLoad({ requestId: "a", config, voice: "yes" }));
  assert.ok(!validTimerLoad({ requestId: "a", config, maxTest: { warmups: 9, restSeconds: 120 } }));
});

test("haptic kinds follow phase changes", () => {
  assert.equal(hapticKindFor("idle", "work"), null);
  assert.equal(hapticKindFor("idle", "prep"), null);
  assert.equal(hapticKindFor("done", "work"), null);
  assert.equal(hapticKindFor("prep", "work"), "hang");
  assert.equal(hapticKindFor("rest", "work"), "hang");
  assert.equal(hapticKindFor("prep", "test"), "hang");
  assert.equal(hapticKindFor("rest", "test"), "hang");
  assert.equal(hapticKindFor("work", "rest"), "rest");
  assert.equal(hapticKindFor("work", "done"), "finish");
  assert.equal(hapticKindFor("test", "done"), "finish");
  assert.equal(hapticKindFor("rest", "idle"), null);
  assert.equal(hapticKindFor("work", "idle"), null);
});

test("vibrateFor only calls a supported vibrate", () => {
  const calls = [];
  const nav = { vibrate: (p) => calls.push(p) };
  assert.equal(supportsVibrate(nav), true);
  assert.equal(vibrateFor("hang", nav), true);
  assert.deepEqual(calls, [HAPTIC_PATTERNS.hang]);
  assert.equal(vibrateFor("nope", nav), false);
  assert.equal(supportsVibrate({}), false);
  assert.equal(vibrateFor("hang", {}), false);
  assert.equal(vibrateFor("hang", { vibrate: () => { throw new Error("x"); } }), false);
});
