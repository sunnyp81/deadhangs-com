import { testSecondsToLog } from "./timer-state.mjs";

export const HEADER_HOLD_SECONDS = 30;

/** Whole seconds elapsed since startMs, clamped to 0..total. */
export function elapsedSeconds(startMs, nowMs, total = HEADER_HOLD_SECONDS) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 0;
  return Math.min(total, Math.max(0, (nowMs - startMs) / 1000));
}

/** Seconds left, rounded up so the clock never reads 00:00 before the hold is over. */
export function remainingWhole(elapsed, total = HEADER_HOLD_SECONDS) {
  return Math.max(0, Math.ceil(total - elapsed));
}

export function isFinished(elapsed, total = HEADER_HOLD_SECONDS) {
  return elapsed >= total;
}

/** Fraction of the ring still lit, 1 at the start and 0 when done. */
export function ringFraction(elapsed, total = HEADER_HOLD_SECONDS) {
  return Math.min(1, Math.max(0, 1 - elapsed / total));
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Log link carrying whole seconds held; null when under one second (nothing worth logging). */
export function logHref(elapsed, total = HEADER_HOLD_SECONDS) {
  const whole = testSecondsToLog(isFinished(elapsed, total) ? total : elapsed);
  return whole === null ? null : `/training-log/?hold=${whole}`;
}
