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
  return !!load && typeof load.requestId === "string" && load.requestId.length > 0 && validTimerConfig(load.config);
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
