export const isBusy = (phase) =>
  ["prep", "work", "rest", "test"].includes(phase);
export function validTimerConfig(x) {
  return (
    !!x &&
    ["simple", "emom", "ladder", "test"].includes(x.mode) &&
    Number.isInteger(x.workSeconds) &&
    x.workSeconds >= 5 &&
    x.workSeconds <= 120 &&
    (x.mode !== "emom" || x.workSeconds <= 50) &&
    Number.isInteger(x.restSeconds) &&
    x.restSeconds >= 10 &&
    x.restSeconds <= 300 &&
    Number.isInteger(x.rounds) &&
    x.rounds >= 1 &&
    x.rounds <= 10 &&
    [0, 5, 10].includes(x.prepSeconds)
  );
}
export function validTimerRequest(x) {
  return validTimerConfig({
    mode: x?.mode,
    workSeconds: x?.work,
    restSeconds: x?.rest,
    rounds: x?.rounds,
    prepSeconds: x?.prep,
  });
}
export function normalizeLegacyTimerConfig(x) {
  return {
    mode: x?.mode || "simple",
    workSeconds: x?.workSeconds ?? x?.work,
    restSeconds: x?.restSeconds ?? x?.rest,
    rounds: x?.rounds,
    prepSeconds:
      x?.prepSeconds === undefined
        ? x?.prep === undefined
          ? 0
          : x.prep
        : x.prepSeconds,
  };
}
export function validTimerLoad(load) {
  return (
    !!load &&
    typeof load.requestId === "string" &&
    load.requestId.length > 0 &&
    validTimerConfig(load.config) &&
    (load.voice === undefined || typeof load.voice === "boolean") &&
    (load.maxTest === undefined || validMaxTestPlan(load.maxTest))
  );
}
export function activeTestElapsed(accumulatedSeconds, runStartMs, nowMs) {
  const activeSeconds =
    Number.isFinite(runStartMs) ? Math.max(0, (nowMs - runStartMs) / 1000) : 0;
  return Math.min(3600, Math.max(0, accumulatedSeconds + activeSeconds));
}
export function nextPhase({ phase, round, rounds, mode, work, rest }) {
  if (phase === "prep")
    return { phase: mode === "test" ? "test" : "work", round };
  if (phase === "test") return { phase: "done", round };
  if (phase === "work" && round >= rounds) return { phase: "done", round };
  if (phase === "work") return { phase: "rest", round };
  return { phase: "work", round: round + 1 };
}

/**
 * Max-attempt (guided test) sequence: optional easy warm-up holds with a short
 * break between them, an optional timed rest, then one open-ended count-up hold.
 * Every number is the user's own setting; nothing here is a prescription.
 */
export const MAX_TEST_WARMUP_SECONDS = 10;
export const MAX_TEST_WARMUP_BREAK_SECONDS = 20;
export const MAX_TEST_REST_CHOICES = [0, 60, 120, 180];
export const MAX_TEST_DEFAULTS = { warmups: 2, restSeconds: 120 };

export function validMaxTestPlan(plan) {
  return (
    !!plan &&
    Number.isInteger(plan.warmups) &&
    plan.warmups >= 0 &&
    plan.warmups <= 3 &&
    MAX_TEST_REST_CHOICES.includes(plan.restSeconds)
  );
}

/**
 * The step that follows `phase` in a guided test. `round` is the warm-up number
 * just completed (or in progress). "prep" also stands for "just started".
 * Returns { phase, round, seconds } where seconds is 0 for the count-up phase.
 * A final "rest" is the one with round >= warmups (the rest before the max).
 */
export function maxTestNext({ phase, round, warmups, restSeconds }) {
  const toMax = () => ({ phase: "test", round: Math.max(1, warmups), seconds: 0 });
  const toRestBeforeMax = () =>
    restSeconds > 0
      ? { phase: "rest", round: Math.max(1, warmups), seconds: restSeconds }
      : toMax();
  if (phase === "idle" || phase === "prep") {
    return warmups > 0
      ? { phase: "work", round: 1, seconds: MAX_TEST_WARMUP_SECONDS }
      : toRestBeforeMax();
  }
  if (phase === "work") {
    return round < warmups
      ? { phase: "rest", round, seconds: MAX_TEST_WARMUP_BREAK_SECONDS }
      : toRestBeforeMax();
  }
  if (phase === "rest") {
    return warmups > 0 && round < warmups
      ? { phase: "work", round: round + 1, seconds: MAX_TEST_WARMUP_SECONDS }
      : toMax();
  }
  return { phase: "done", round, seconds: 0 };
}

/** True for the rest that comes right before the max hold. */
export function isRestBeforeMax({ phase, round, warmups }) {
  return phase === "rest" && round >= Math.max(1, warmups);
}

/** Whole seconds of a finished test that are worth logging, or null under one second. */
export function testSecondsToLog(shownSeconds) {
  const whole = Math.floor(shownSeconds);
  return Number.isFinite(whole) && whole >= 1 ? Math.min(3600, whole) : null;
}
