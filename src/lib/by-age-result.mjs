// The visitor's latest by-age result, kept in memory for this page view only (no cookie or storage).
import { ageBandFor } from './plan-offer.mjs';

const KEY = '__dhByAgeResult';

export function rememberResult(seconds, age) {
  if (typeof window === 'undefined' || !Number.isFinite(seconds)) return;
  window[KEY] = { seconds: Math.round(seconds), ageBand: ageBandFor(age) };
}

export function recallResult() {
  if (typeof window === 'undefined') return null;
  const value = window[KEY];
  return value && typeof value === 'object' ? { seconds: value.seconds, ageBand: value.ageBand } : null;
}
