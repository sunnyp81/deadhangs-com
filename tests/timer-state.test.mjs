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
