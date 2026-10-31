import test from "node:test";
import assert from "node:assert/strict";
import {
  activeTestElapsed,
  isBusy,
  nextPhase,
  normalizeLegacyTimerConfig,
  validTimerConfig,
  validTimerLoad,
  validTimerRequest,
} from "../src/lib/timer-state.mjs";

const interval = {
  phase: "work",
  round: 1,
  rounds: 3,
  mode: "simple",
  work: 30,
  rest: 60,
};
test("preparation moves once into work and zero preparation needs no phase", () => {
  assert.deepEqual(nextPhase({ ...interval, phase: "prep" }), {
    phase: "work",
    round: 1,
  });
  assert.equal(isBusy("prep"), true);
  assert.equal(isBusy("idle"), false);
});
test("interval completion and late callback transition one visible phase", () => {
  assert.deepEqual(nextPhase(interval), { phase: "rest", round: 1 });
  assert.deepEqual(nextPhase({ ...interval, phase: "rest" }), {
    phase: "work",
    round: 2,
  });
  assert.deepEqual(nextPhase({ ...interval, round: 3 }), {
    phase: "done",
    round: 3,
  });
});
test("requests are bounded and only idle or done may be loaded by the component", () => {
  const config = {
    mode: "simple",
    workSeconds: 30,
    restSeconds: 60,
    rounds: 3,
    prepSeconds: 5,
  };
  assert.equal(validTimerConfig(config), true);
  assert.deepEqual(
    normalizeLegacyTimerConfig({ work: 30, rest: 60, rounds: 3 }),
    { mode: "simple", workSeconds: 30, restSeconds: 60, rounds: 3, prepSeconds: 0 },
  );
  assert.equal(
    validTimerConfig(normalizeLegacyTimerConfig({ work: 30, rest: 60, rounds: 3 })),
    true,
  );
  assert.equal(
    validTimerConfig(normalizeLegacyTimerConfig({ work: 30, rest: 60, rounds: 3, prep: 3 })),
    false,
  );
  assert.equal(validTimerLoad({ requestId: "one", config }), true);
  assert.equal(validTimerRequest({ id: "one", work: 30, rest: 60, rounds: 3, mode: "simple", prep: 5 }), true);
  assert.equal(validTimerConfig({ ...config, workSeconds: 4 }), false);
  assert.equal(validTimerConfig({ ...config, prepSeconds: 3 }), false);
  assert.equal(validTimerConfig({ ...config, mode: "emom", workSeconds: 55 }), false);
  assert.equal(validTimerConfig({ ...config, mode: "unknown" }), false);
  assert.equal(validTimerConfig({ ...config, restSeconds: 9 }), false);
  assert.equal(validTimerConfig({ ...config, rounds: 11 }), false);
  for (const phase of ["prep", "work", "rest", "test"])
    assert.equal(isBusy(phase), true);
});
test("Test elapsed accumulates active monotonic time only and stops at the cap", () => {
  assert.equal(activeTestElapsed(0, 1000, 4400), 3.4);
  assert.equal(activeTestElapsed(3.4, null, 20_000), 3.4);
  assert.equal(activeTestElapsed(3.4, 20_000, 21_000), 4.4);
  assert.equal(activeTestElapsed(3599.8, 0, 10_000), 3600);
});
test("test mode ends explicitly and never becomes an interval completion", () => {
  assert.deepEqual(nextPhase({ ...interval, phase: "test", mode: "test" }), {
    phase: "done",
    round: 1,
  });
});

import {
  MAX_TEST_DEFAULTS,
  isRestBeforeMax,
  maxTestNext,
  testSecondsToLog,
  validMaxTestPlan,
} from "../src/lib/timer-state.mjs";

function walk(plan) {
  const steps = [];
  let cur = { phase: "prep", round: 1 };
  for (let i = 0; i < 20 && cur.phase !== "test"; i += 1) {
    cur = maxTestNext({ ...plan, ...cur });
    steps.push(`${cur.phase}${cur.phase === "test" ? "" : `:${cur.round}:${cur.seconds}`}`);
  }
  return steps;
}

test("guided max test runs warm-ups, a timed rest, then one count-up hold", () => {
  assert.deepEqual(walk(MAX_TEST_DEFAULTS), ["work:1:10", "rest:1:20", "work:2:10", "rest:2:120", "test"]);
  assert.equal(isRestBeforeMax({ phase: "rest", round: 2, warmups: 2 }), true);
  assert.equal(isRestBeforeMax({ phase: "rest", round: 1, warmups: 2 }), false);
  assert.equal(isRestBeforeMax({ phase: "work", round: 2, warmups: 2 }), false);
  assert.deepEqual(maxTestNext({ phase: "test", round: 2, warmups: 2, restSeconds: 120 }), { phase: "done", round: 2, seconds: 0 });
});

test("guided max test can skip warm-ups or the rest, down to a plain count-up", () => {
  assert.deepEqual(walk({ warmups: 0, restSeconds: 60 }), ["rest:1:60", "test"]);
  assert.deepEqual(walk({ warmups: 1, restSeconds: 0 }), ["work:1:10", "test"]);
  assert.deepEqual(walk({ warmups: 0, restSeconds: 0 }), ["test"]);
  assert.equal(isRestBeforeMax({ phase: "rest", round: 1, warmups: 0 }), true);
});

test("max test plan validation and loggable seconds", () => {
  assert.equal(validMaxTestPlan(MAX_TEST_DEFAULTS), true);
  for (const bad of [null, { warmups: 4, restSeconds: 60 }, { warmups: -1, restSeconds: 60 }, { warmups: 1, restSeconds: 90 }, { warmups: 1.5, restSeconds: 60 }]) {
    assert.equal(validMaxTestPlan(bad), false);
  }
  assert.equal(testSecondsToLog(0.9), null);
  assert.equal(testSecondsToLog(1), 1);
  assert.equal(testSecondsToLog(83.7), 83);
  assert.equal(testSecondsToLog(99999), 3600);
  assert.equal(testSecondsToLog(Number.NaN), null);
});
