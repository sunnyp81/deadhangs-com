// Browser-side helpers for the guided programme pages. Pure functions so they can be tested without a browser.
// Every training number arrives as an argument (read from the plan rules at build time, or from the server view).
import { AccountError, accountRequest, trustedRedirect } from './account-client.mjs';
import { STORAGE_KEY, appendToStoredLog, makeEntryId, parseIntStrict, parseStoredLog, validateSetupInput } from './training-log.mjs';

export const PROGRAMME_ID = 'hang4';
export const PROGRAMME_PRICE_LABEL = '£29';
export const SESSION_NOTE_MAX = 280;

/** Route for a repeatable hold: supported below the entry hold, standard up to the ceiling, otherwise outside. */
export function routeFor(seconds, limits) {
  if (!Number.isInteger(seconds) || seconds < 0 || !limits) return null;
  if (seconds < limits.minBaseline) return 'supported';
  if (seconds <= limits.maxBaseline) return 'standard';
  return 'outside';
}

/** Week 1, 2 and 3 hold per set for a standard-route baseline. Week 3 stacks both additions. */
export function weekTargets(seconds, { week2Add, week3Add }) {
  return { week1: seconds, week2: seconds + week2Add, week3: seconds + week2Add + week3Add };
}

/** About 80% of a longest single hold, rounded down. A suggestion only; the person confirms it. */
export function suggestedHold(maxSeconds, limits) {
  return Number.isInteger(maxSeconds) && maxSeconds >= 1 ? Math.floor((maxSeconds * limits.baselinePercent) / 100) : null;
}

/** Everything the "Is it for you?" check shows, from the two typed values. Nothing is stored or sent. */
export function fitResult(repeatText, longestText, limits) {
  const repeat = String(repeatText ?? '').trim() === '' ? null : parseIntStrict(repeatText);
  const longest = String(longestText ?? '').trim() === '' ? null : parseIntStrict(longestText);
  if (repeat === null && String(repeatText ?? '').trim() !== '') return { status: 'invalid', message: 'Enter whole seconds, for example 12.' };
  if (longest === null && String(longestText ?? '').trim() !== '') return { status: 'invalid', message: 'Enter whole seconds for your longest hold, or leave it blank.' };
  if (repeat !== null && longest !== null && longest < repeat) return { status: 'invalid', message: 'Your longest single hold cannot be shorter than the hold you can repeat.' };
  if (repeat === null) {
    if (longest === null) return { status: 'empty' };
    return { status: 'suggest', longest, suggestion: suggestedHold(longest, limits) };
  }
  const route = routeFor(repeat, limits);
  return { status: 'route', route, repeat, longest, targets: route === 'standard' ? weekTargets(repeat, limits) : null };
}

/** 32 hex characters, no dashes. Kept in component state so a retry after a lost response resends the same id. */
export function newResultId(cryptoObj = globalThis.crypto) {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const MESSAGES = {
  signed_out: 'Your session has ended. Sign in again to continue.',
  account_changed: 'The signed-in account changed in another tab. Refresh this page. Nothing was changed.',
  accounts_unavailable: 'The programme is not available right now. Nothing was changed.',
  programme_unavailable: 'The programme is not available right now. Nothing was changed.',
  revision_conflict: 'This programme changed on another device. The latest version is showing now and nothing was overwritten. Check it, then try again.',
  programme_access_required: 'Your access to the programme is not active, so nothing was saved.',
  programme_not_on_sale: 'The programme is not on sale yet. Nothing was charged.',
  programme_owned: 'This account already has the programme. Open it from the programme page.',
  programme_payment_pending: 'A payment for this account is still being confirmed. Do not pay again. Check again in a minute.',
  programme_disputed: 'This purchase is under dispute with the card provider, so a new payment cannot be taken.',
  account_deleting: 'This account has a deletion in progress, so checkout is blocked. Contact support to finish or undo the deletion.',
  billing_unavailable: 'Payments are not available right now. Nothing was charged.',
  billing_provider_unavailable: 'The payment provider could not be reached. Nothing was charged. Try again in a minute.',
  invalid_redirect: 'The payment page address could not be trusted, so nothing was opened. Nothing was charged.',
  invalid_sets: 'Check the set times. Use whole seconds, or leave a set empty if you did not do it.',
  no_actual_result: 'Enter at least one set you actually held.',
  invalid_note: 'The note is too long or has characters that cannot be saved. Keep it to 280 characters.',
  invalid_setup: 'Check the setup details, especially added load.',
  invalid_date: 'Check the date.',
  invalid_baseline: 'Enter your repeatable hold in whole seconds.',
  invalid_max_test: 'Your longest hold must be a whole number of seconds and at least your repeatable hold.',
  baseline_outside_range: 'That hold is above what this programme is built for. The programme is not a fit at that level.',
  baseline_needs_supported: 'That hold is under the standard route minimum. Choose the feet-supported route.',
  baseline_not_supported_range: 'The unassisted hold you entered is outside the range for the feet-supported route. Leave it blank or check it.',
  already_enrolled: 'You are already on the programme.',
  not_enrolled: 'Start the programme first.',
  paused: 'The programme is paused. Resume it to record sessions.',
  completed: 'The programme is finished. Start it again to record more sessions.',
  not_next_session: 'That is not the next session. The latest version is showing now.',
  result_discarded: 'That result was discarded earlier and cannot be saved again. Start a fresh record.',
  id_conflict: 'That result was already saved with different values. The latest version is showing now.',
  result_missing: 'That result no longer exists. The latest version is showing now.',
  too_many_results: 'The programme holds a limited number of results. Contact support.',
  review_not_due: 'That review is not due. The latest version is showing now.',
  network: 'Could not reach the server. Nothing was changed. Check your connection and try again.',
  request_failed: 'That could not be done. Nothing was changed.',
};

/** Plain sentence for an API error code. 503s always read "not available", never a raw code. */
export function programmeErrorMessage(error) {
  if (error?.status === 503) return MESSAGES.programme_unavailable;
  return MESSAGES[error?.code] || MESSAGES.request_failed;
}

/** Codes after which the screen should reload the server version before the person tries again. */
export function shouldRefetch(error) {
  return ['revision_conflict', 'not_next_session', 'id_conflict', 'result_missing', 'review_not_due', 'already_enrolled', 'paused', 'completed', 'not_enrolled'].includes(error?.code);
}

/** Wraps accountRequest so a dropped connection becomes a coded error instead of a TypeError. */
export async function programmeRequest(path, options = {}, fetcher = fetch) {
  try {
    return await accountRequest(path, options, fetcher);
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError('network', 0);
  }
}

export const withKey = (key, options = {}) => ({ ...options, headers: { ...options.headers, 'X-DeadHangs-Account-Key': key || '' } });
export const jsonBody = (method, body) => ({ method, body: JSON.stringify(body) });

/** Starts Stripe Checkout and returns the verified URL. Never navigates itself. */
export async function requestCheckout(accountKey, source, request = programmeRequest) {
  const result = await request('/api/programme/checkout', withKey(accountKey, jsonBody('POST', { programme: PROGRAMME_ID, source })));
  return trustedRedirect(result.url, 'checkout');
}

/** Setup form (as the app holds it) to the shape the server accepts. */
export function setupForServer(form) {
  const { errors, value } = validateSetupInput({ bar: form?.bar, grip: form?.grip, chalk: form?.chalk, load: form?.load, loadUnit: form?.loadUnit });
  const setup = {};
  for (const key of ['bar', 'grip', 'chalk', 'load', 'loadUnit']) if (value[key] !== undefined) setup[key] = value[key];
  return { errors, setup };
}

export const EMPTY_PROGRAMME_SETUP = Object.freeze({ bar: '', grip: '', chalk: '', load: '', loadUnit: 'kg' });

/** Server setup back to form values, for prefilling the record form from the baseline. */
export function setupToForm(setup) {
  const s = setup || {};
  return {
    bar: s.bar ?? '', grip: s.grip ?? '',
    chalk: typeof s.chalk === 'boolean' ? (s.chalk ? 'yes' : 'no') : '',
    load: s.load !== undefined && s.load !== null ? String(s.load) : '',
    loadUnit: s.loadUnit ?? 'kg',
  };
}

/** One input per set. Empty means not done (null). Returns { error, sets }. */
export function parseSetInputs(values) {
  const sets = [];
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (text === '') { sets.push(null); continue; }
    const n = parseIntStrict(text);
    if (n === null || n < 0) return { error: 'invalid_sets', sets: null };
    sets.push(n);
  }
  if (!sets.some((n) => n !== null)) return { error: 'no_actual_result', sets: null };
  return { error: null, sets };
}

/** Best actual set and number of sets with a value, for the optional device-log copy. */
export function summariseSets(sets) {
  const done = sets.filter((n) => n !== null && n !== undefined);
  return { best: done.length ? Math.max(...done) : 0, count: done.length };
}

/** Appends one confirmed result to the device training log. Never overwrites an unreadable or full log. */
export function appendResultToDeviceLog({ storage, date, sets, assistance, setup }, today) {
  try {
    const { best, count } = summariseSets(sets);
    if (best < 1 || count < 1) return { ok: false, reason: 'invalid' };
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = parseStoredLog(raw, today);
    if (parsed.status === 'corrupt') return { ok: false, reason: 'corrupt' };
    const entry = { id: makeEntryId(parsed.entries), date, seconds: best, assistance, sets: count, ...(setup || {}) };
    const result = appendToStoredLog(raw, entry, today);
    if (!result.ok) return { ok: false, reason: result.reason };
    storage.setItem(STORAGE_KEY, result.text);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export const deviceLogMessage = (reason) => ({
  corrupt: 'The training log on this device could not be read, so it was left alone. Your programme result was saved.',
  full: 'The training log on this device is full, so it was left alone. Your programme result was saved.',
  invalid: 'This result could not be added to the training log on this device. Your programme result was saved.',
  unavailable: 'This browser would not allow writing to the training log on this device. Your programme result was saved.',
}[reason] || 'The training log on this device was left alone. Your programme result was saved.');
