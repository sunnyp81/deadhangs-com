export const PLAN_PRICE_LABEL = '£9';
export const PLAN_CHECKOUT_PATH = '/api/billing/plan/checkout';
export const PLAN_REASONS = Object.freeze([
  ['arranged_around_result', 'A plan arranged around my own result'],
  ['printable_sheet', 'The printable sheet'],
  ['timer_presets', 'Timer presets set to my holds'],
  ['other', 'Something else'],
]);
import { MAX_TEST_SECONDS, checkInputs } from './plan8.mjs';

export const AGE_BANDS = Object.freeze([['under-40', 'Under 40'], ['40-59', '40 to 59'], ['60-plus', '60 and over']]);
export const REPEAT_MIN = 20;
export const REPEAT_MAX = 60;
const MAX = MAX_TEST_SECONDS;

export function ageBandFor(age) {
  if (!Number.isInteger(age)) return null;
  return age < 40 ? 'under-40' : age < 60 ? '40-59' : '60-plus';
}

/** 'low' under 20 s, 'high' over 60 s, 'ok' for 20 to 60 inclusive, null when not a usable number. */
export function eligibility(repeatSeconds) {
  if (String(repeatSeconds ?? '').trim() === '') return null;
  const n = Math.round(Number(repeatSeconds));
  if (!Number.isFinite(n) || n < 1 || n > MAX) return null;
  return n < REPEAT_MIN ? 'low' : n > REPEAT_MAX ? 'high' : 'ok';
}

/** PlanInputs per the interface contract (no sex), or an error / ineligible marker. Nothing is derived from the hold. */
export function buildPlanInputs({ testSeconds, repeatSeconds, ageBand }) {
  const test = Math.round(Number(testSeconds));
  const repeat = Math.round(Number(repeatSeconds));
  if (!Number.isFinite(test) || test < 1 || test > MAX) return { error: 'Enter your max hold, between 1 and 3,600 seconds.' };
  if (!Number.isFinite(repeat) || repeat < 1 || repeat > MAX) return { error: 'Enter the longest hold you can repeat three times, in seconds.' };
  const fit = eligibility(repeat);
  if (fit !== 'ok') return { ineligible: fit };
  if (repeat > test) return { error: 'Your repeatable hold cannot be longer than your max hold.' };
  if (!AGE_BANDS.some(([key]) => key === ageBand)) return { error: 'Choose an age band.' };
  return { inputs: { testSeconds: test, repeatSeconds: repeat, ageBand, sessionsPerWeek: 3 } };
}

export function isStripeCheckoutUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com';
  } catch { return false; }
}

/** Where an ineligible repeatable hold is sent. One source: the generator's own eligibility check. */
export function ineligibleRoute(repeatSeconds, rules) {
  const repeat = Math.round(Number(repeatSeconds));
  const check = checkInputs({ testSeconds: MAX, repeatSeconds: repeat, sessionsPerWeek: 3 }, rules);
  return check.ok ? null : check.route ?? null;
}
