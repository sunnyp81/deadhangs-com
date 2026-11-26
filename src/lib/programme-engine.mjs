// Pure engine for the four-week guided programme (hang4). Every training number is read from plan-rules.json,
// passed in by the caller. Progress advances by completed sessions, never by calendar time, so a missed day
// never increases the next session's work. Planned targets and recorded results are kept apart.

import { setupKey, ASSISTANCE_TYPES, BAR_TYPES, GRIP_TYPES, LOAD_UNITS, parseLoad, isCalendarDate } from './training-log.mjs';

export const STATE_VERSION = 1;
export const ROUTES = Object.freeze(['standard', 'supported']);
export const MAX_RESULTS = 200;
export const MAX_NOTE = 280;
export const MAX_TOMBSTONES = 200;
export const MAX_HISTORY = 10;
/** Each week can be repeated this many times per run; keeps stored state bounded. */
export const MAX_REPEATS = 20;
export const MAX_SET_SECONDS = 3600;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const WEEKS = Object.freeze([1, 2, 3, 4]);

function ruleMap(rules) {
  const list = Array.isArray(rules) ? rules : rules?.rules;
  if (!Array.isArray(list)) throw new Error('programme rules missing');
  const map = new Map(list.map((rule) => [rule.id, rule]));
  return (id) => {
    const rule = map.get(id);
    if (!rule) throw new Error(`programme rule missing: ${id}`);
    return rule;
  };
}
const ints = (rule) => (String(rule.value).match(/\d+/g) || []).map(Number);
function num(rule, index = 0) {
  const found = ints(rule)[index];
  if (!Number.isInteger(found)) throw new Error(`programme rule has no number ${index}: ${rule.id}`);
  return found;
}

/** Every number the programme uses, each tied to its rule id. */
export function programmeNumbers(rules) {
  const rule = ruleMap(rules);
  return Object.freeze({
    sets: num(rule('w4.sets_rest'), 0),
    restSeconds: num(rule('w4.rest_seconds')),
    sessionsPerWeek: num(rule('w4.sessions_per_week')),
    week2Add: num(rule('w4.week2_add')),
    week3Add: num(rule('w4.week3_add')),
    minBaseline: num(rule('w4.entry_hold')),
    maxBaseline: num(rule('w4.weekly_volume'), 1),
    baselinePercent: num(rule('w4.baseline_fraction')),
    repeatMissSeconds: num(rule('w4.repeat_week')),
    thirdSetAllowance: num(rule('w4.miss_third_set'), 1),
    supportedSets: num(rule('pg.l1'), 0),
    supportedHold: num(rule('pg.l1'), 1),
    supportedRest: num(rule('pg.l1'), 2),
    checkMaxSeconds: num(rule('sf.start_short')),
    ruleIds: Object.freeze({
      sets: 'w4.sets_rest', rest: 'w4.rest_seconds', sessions: 'w4.sessions_per_week', week2: 'w4.week2_add', week3: 'w4.week3_add',
      minBaseline: 'w4.entry_hold', maxBaseline: 'w4.weekly_volume', baselinePercent: 'w4.baseline_fraction', repeat: 'w4.repeat_week',
      thirdSet: 'w4.miss_third_set', supported: 'pg.l1', check: 'sf.start_short', testDay: 'w4.test_stop', restDay: 'w4.rest_day_between',
    }),
  });
}

/** Ordered session list for a route. Targets are planned values; the test day and unassisted check have none. */
export function buildSchedule(route, baselineSeconds, rules) {
  const n = programmeNumbers(rules);
  const sessions = [];
  for (const week of WEEKS) {
    for (let index = 1; index <= n.sessionsPerWeek; index += 1) {
      const key = `w${week}s${index}`;
      const last = week === 4 && index === n.sessionsPerWeek;
      if (route === 'standard') {
        if (last) { sessions.push({ key, week, index, kind: 'test', sets: 1, targetSeconds: null, restSeconds: null, assistance: 'unassisted', ruleIds: ['w4.week4_sessions', 'w4.test_warmup', 'w4.test_rest', 'w4.test_stop', 'w4.test_target'] }); continue; }
        const add = week === 1 ? 0 : week === 2 ? n.week2Add : n.week2Add + n.week3Add;
        const ruleIds = ['w4.sets_rest', 'w4.rest_seconds', week === 1 ? 'w4.week1' : week === 2 ? 'w4.week2_add' : 'w4.week3_add'];
        if (week === 4) ruleIds.push('w4.week4_sessions');
        sessions.push({ key, week, index, kind: 'training', sets: n.sets, targetSeconds: baselineSeconds + add, restSeconds: n.restSeconds, assistance: 'unassisted', gripOption: week === 3 ? 'neutral' : null, ruleIds });
      } else if (route === 'supported') {
        if (last) { sessions.push({ key, week, index, kind: 'check', sets: 1, targetSeconds: null, maxSuggestedSeconds: n.checkMaxSeconds, restSeconds: null, assistance: 'unassisted', ruleIds: ['sf.start_short', 'pg.l1_exit', 'w4.entry_hold'] }); continue; }
        sessions.push({ key, week, index, kind: 'training', sets: n.supportedSets, targetSeconds: n.supportedHold, restSeconds: n.supportedRest, assistance: 'feet-supported', ruleIds: ['pg.l1', 'pg.sessions', 'pg.l1_exit'] });
      } else throw new Error('unknown route');
    }
  }
  return sessions;
}

export class ProgrammeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
/** @returns {never} */
function fail(code, status = 400) { throw new ProgrammeError(code, status); }
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Route for a repeatable hold: supported below the entry hold, standard up to the weekly-volume ceiling, otherwise outside. */
export function routeForBaseline(seconds, rules) {
  const n = programmeNumbers(rules);
  if (!isInt(seconds, 0, MAX_SET_SECONDS)) return null;
  if (seconds < n.minBaseline) return 'supported';
  if (seconds <= n.maxBaseline) return 'standard';
  return 'outside';
}

/** Suggested repeatable hold from a max test (about 80%), rounded down. The person confirms or changes it. */
export function suggestedBaseline(maxTestSeconds, rules) {
  const n = programmeNumbers(rules);
  return isInt(maxTestSeconds, 1, MAX_SET_SECONDS) ? Math.floor((maxTestSeconds * n.baselinePercent) / 100) : null;
}

function cleanSetup(raw) {
  const value = {};
  if (raw == null) return value;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_setup');
  for (const key of Object.keys(raw)) if (!['bar', 'grip', 'chalk', 'load', 'loadUnit'].includes(key)) fail('invalid_setup');
  if (raw.bar != null && raw.bar !== '') { if (!BAR_TYPES.includes(raw.bar)) fail('invalid_setup'); value.bar = raw.bar; }
  if (raw.grip != null && raw.grip !== '') { if (!GRIP_TYPES.includes(raw.grip)) fail('invalid_setup'); value.grip = raw.grip; }
  if (raw.chalk != null) { if (typeof raw.chalk !== 'boolean') fail('invalid_setup'); value.chalk = raw.chalk; }
  if (raw.load != null && raw.load !== '') {
    const load = parseLoad(typeof raw.load === 'number' ? raw.load : String(raw.load));
    if (load === null || !LOAD_UNITS.includes(raw.loadUnit)) fail('invalid_setup');
    value.load = load; value.loadUnit = raw.loadUnit;
  }
  return value;
}

function cleanNote(note) {
  if (note == null || note === '') return '';
  if (typeof note !== 'string') fail('invalid_note');
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) fail('invalid_note');
  return trimmed;
}

function cleanSets(sets, expected) {
  if (!Array.isArray(sets) || sets.length !== expected) fail('invalid_sets');
  const out = sets.map((value) => (value === null ? null : isInt(value, 0, MAX_SET_SECONDS) ? value : fail('invalid_sets')));
  if (!out.some((value) => value !== null)) fail('no_actual_result');
  return out;
}

function cleanDate(value) {
  if (!isCalendarDate(value) || value < '2026-01-01') fail('invalid_date');
  return value;
}

export function emptyState() { return null; }

function currentCycle(state, week) { return state.cycles[String(week)] ?? 0; }

function resultFor(state, session) {
  const cycle = currentCycle(state, session.week);
  return state.results.find((r) => r.sessionKey === session.key && r.cycle === cycle) || null;
}

function reviewFor(state, week) {
  const cycle = currentCycle(state, week);
  return state.reviews.find((r) => r.week === week && r.cycle === cycle) || null;
}

/** The next thing to do: a session, a weekly review, or the final comparison. */
export function nextStep(state, rules) {
  if (!state) return { type: 'enrol' };
  const schedule = buildSchedule(state.route, state.baseline.seconds, rules);
  for (const week of WEEKS) {
    const sessions = schedule.filter((s) => s.week === week);
    const open = sessions.find((s) => !resultFor(state, s));
    if (open) return { type: 'session', session: open };
    if (week < 4 && !reviewFor(state, week)) return { type: 'review', week };
  }
  return { type: 'final' };
}

/** Planned versus actual for one week in its current cycle, with the repeat suggestion computed from recorded results only. */
export function weekSummary(state, week, rules) {
  const n = programmeNumbers(rules);
  const schedule = buildSchedule(state.route, state.baseline.seconds, rules).filter((s) => s.week === week);
  const rows = schedule.map((session) => {
    const result = resultFor(state, session);
    const shortfalls = result && session.targetSeconds != null
      ? result.sets.map((actual, i) => (actual == null ? null : Math.max(0, session.targetSeconds - actual) - (i === session.sets - 1 ? n.thirdSetAllowance : 0)))
      : [];
    return { key: session.key, kind: session.kind, targetSeconds: session.targetSeconds, sets: result?.sets ?? null, localDate: result?.localDate ?? null, assistance: result?.assistance ?? session.assistance, shortfalls };
  });
  const training = rows.filter((row) => row.kind === 'training' && row.sets);
  const missedSessions = training.filter((row) => row.shortfalls.some((gap) => gap != null && gap > n.repeatMissSeconds)).length;
  // "Consistently" is read as most of the week's recorded training sessions; the person always decides.
  const suggestRepeat = state.route === 'standard' && training.length > 0 && missedSessions * 2 > training.length;
  return { week, cycle: currentCycle(state, week), rows, missedSessions, suggestRepeat, repeatMissSeconds: n.repeatMissSeconds, ruleIds: ['w4.repeat_week', 'w4.miss_third_set'] };
}

/** Final comparison. Only compares like with like; otherwise both results are shown as not comparable. */
export function finalComparison(state, rules) {
  const schedule = buildSchedule(state.route, state.baseline.seconds, rules);
  const last = schedule[schedule.length - 1];
  const result = resultFor(state, last);
  if (!result) return null;
  const best = Math.max(...result.sets.filter((v) => v != null));
  const start = state.route === 'standard' ? state.baseline.maxTestSeconds : state.baseline.unassistedSeconds;
  const startEntry = { assistance: 'unassisted', ...state.baseline.setup };
  const endEntry = { assistance: result.assistance, ...result.setup };
  const comparable = start != null && setupKey(startEntry) === setupKey(endEntry);
  return { route: state.route, kind: last.kind, start: start ?? null, startDate: state.baseline.localDate, end: best, endDate: result.localDate, comparable, difference: comparable ? best - start : null };
}

function assertEnrolled(state) { if (!state) fail('not_enrolled', 409); }
function assertActive(state) { assertEnrolled(state); if (state.status === 'paused') fail('paused', 409); if (state.status === 'completed') fail('completed', 409); }

function validateReminders(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_reminders');
  for (const key of Object.keys(raw)) if (!['enabled', 'days', 'localTime', 'timezone'].includes(key)) fail('invalid_reminders');
  if (typeof raw.enabled !== 'boolean') fail('invalid_reminders');
  const days = Array.isArray(raw.days) ? [...new Set(raw.days)] : fail('invalid_reminders');
  if (days.length > 7 || days.some((d) => !DAYS.includes(d))) fail('invalid_reminders');
  if (!TIME.test(raw.localTime || '')) fail('invalid_reminders');
  if (typeof raw.timezone !== 'string' || raw.timezone.length > 64) fail('invalid_reminders');
  try { new Intl.DateTimeFormat('en-GB', { timeZone: raw.timezone }); } catch { fail('invalid_reminders'); }
  if (raw.enabled && days.length === 0) fail('invalid_reminders');
  return { enabled: raw.enabled, days: DAYS.filter((d) => days.includes(d)), localTime: raw.localTime, timezone: raw.timezone };
}

const ALLOWED = {
  enrol: ['op', 'route', 'baselineSeconds', 'maxTestSeconds', 'unassistedSeconds', 'setup', 'localDate'],
  record: ['op', 'id', 'sessionKey', 'sets', 'setup', 'notes', 'localDate'],
  edit: ['op', 'id', 'sets', 'setup', 'notes'],
  discard: ['op', 'id'],
  review: ['op', 'week', 'decision'],
  pause: ['op'],
  resume: ['op'],
  reminders: ['op', 'reminders'],
};

/**
 * Applies one operation and returns { state, changed }. Never mutates the input.
 * `now` is an ISO timestamp from the server. Recording the same result id twice with the same content is a no-op,
 * so a client may retry safely after a lost response; a discarded id can never be recorded again.
 */
export function applyOperation(previous, op, rules, now) {
  if (!op || typeof op !== 'object' || Array.isArray(op) || typeof op.op !== 'string' || !Object.hasOwn(ALLOWED, op.op)) fail('invalid_operation');
  for (const key of Object.keys(op)) if (!ALLOWED[op.op].includes(key)) fail('invalid_operation');
  const state = previous ? structuredClone(previous) : null;
  const done = (next, changed = true) => ({ state: next, changed });

  if (op.op === 'enrol') {
    if (state && state.status !== 'completed') fail('already_enrolled', 409);
    if (!ROUTES.includes(op.route)) fail('invalid_route');
    const localDate = cleanDate(op.localDate);
    const setup = cleanSetup(op.setup);
    let baseline;
    if (op.route === 'standard') {
      if (!isInt(op.baselineSeconds, 0, MAX_SET_SECONDS)) fail('invalid_baseline');
      const route = routeForBaseline(op.baselineSeconds, rules);
      if (route !== 'standard') fail(route === 'outside' ? 'baseline_outside_range' : 'baseline_needs_supported');
      if (op.maxTestSeconds != null && (!isInt(op.maxTestSeconds, 1, MAX_SET_SECONDS) || op.maxTestSeconds < op.baselineSeconds)) fail('invalid_max_test');
      if (op.unassistedSeconds != null) fail('invalid_operation');
      baseline = { seconds: op.baselineSeconds, maxTestSeconds: op.maxTestSeconds ?? null, unassistedSeconds: null, setup, localDate };
    } else {
      if (op.baselineSeconds != null || op.maxTestSeconds != null) fail('invalid_operation');
      if (op.unassistedSeconds != null && (!isInt(op.unassistedSeconds, 0, MAX_SET_SECONDS) || routeForBaseline(op.unassistedSeconds, rules) !== 'supported')) fail('baseline_not_supported_range');
      baseline = { seconds: null, maxTestSeconds: null, unassistedSeconds: op.unassistedSeconds ?? null, setup, localDate };
    }
    const history = state ? [...state.history, summary(state, rules)].slice(-MAX_HISTORY) : [];
    return done({
      v: STATE_VERSION, route: op.route, baseline, status: 'active', startedAt: now, pausedAt: null, completedAt: null,
      cycles: { 1: 0, 2: 0, 3: 0, 4: 0 }, results: [], tombstones: state?.tombstones ?? [], reviews: [],
      reminders: state?.reminders ?? { enabled: false, days: [], localTime: '18:00', timezone: 'Europe/London' }, history,
    });
  }

  if (op.op === 'reminders') { assertEnrolled(state); state.reminders = validateReminders(op.reminders); return done(state); }
  if (op.op === 'pause') { assertActive(state); state.status = 'paused'; state.pausedAt = now; return done(state); }
  if (op.op === 'resume') { assertEnrolled(state); if (state.status !== 'paused') return done(state, false); state.status = 'active'; state.pausedAt = null; return done(state); }

  if (op.op === 'record') {
    assertEnrolled(state);
    if (typeof op.id !== 'string' || !ID.test(op.id)) fail('invalid_id');
    // A retry of a result that was already saved is a no-op, even once the programme is paused or finished.
    const saved = state.results.find((r) => r.id === op.id);
    if (saved && saved.sessionKey === op.sessionKey && JSON.stringify(saved.sets) === JSON.stringify(op.sets) && saved.localDate === op.localDate) return done(state, false);
    assertActive(state);
    if (state.tombstones.includes(op.id)) fail('result_discarded', 409);
    const schedule = buildSchedule(state.route, state.baseline.seconds, rules);
    const session = schedule.find((s) => s.key === op.sessionKey);
    if (!session) fail('invalid_session');
    const sets = cleanSets(op.sets, session.sets);
    const setup = cleanSetup(op.setup);
    const notes = cleanNote(op.notes);
    const localDate = cleanDate(op.localDate);
    const existing = state.results.find((r) => r.id === op.id);
    if (existing) {
      const same = existing.sessionKey === op.sessionKey && JSON.stringify(existing.sets) === JSON.stringify(sets) &&
        JSON.stringify(existing.setup) === JSON.stringify(setup) && existing.notes === notes && existing.localDate === localDate;
      if (same) return done(state, false);
      fail('id_conflict', 409);
    }
    const step = nextStep(state, rules);
    if (step.type !== 'session' || step.session.key !== session.key) fail('not_next_session', 409);
    if (state.results.length >= MAX_RESULTS) fail('too_many_results', 409);
    state.results.push({ id: op.id, sessionKey: session.key, cycle: currentCycle(state, session.week), planned: { sets: session.sets, targetSeconds: session.targetSeconds, restSeconds: session.restSeconds }, sets, assistance: session.assistance, setup, notes, localDate, recordedAt: now });
    if (nextStep(state, rules).type === 'final') { state.status = 'completed'; state.completedAt = now; }
    return done(state);
  }

  if (op.op === 'edit') {
    assertEnrolled(state);
    const result = state.results.find((r) => r.id === op.id);
    if (!result) fail('result_missing', 404);
    const session = buildSchedule(state.route, state.baseline.seconds, rules).find((s) => s.key === result.sessionKey);
    if (op.sets !== undefined) result.sets = cleanSets(op.sets, session.sets);
    if (op.setup !== undefined) result.setup = cleanSetup(op.setup);
    if (op.notes !== undefined) result.notes = cleanNote(op.notes);
    result.editedAt = now;
    return done(state);
  }

  if (op.op === 'discard') {
    assertEnrolled(state);
    const index = state.results.findIndex((r) => r.id === op.id);
    if (index === -1) { if (state.tombstones.includes(op.id)) return done(state, false); fail('result_missing', 404); }
    const [removed] = state.results.splice(index, 1);
    if (state.tombstones.length >= MAX_TOMBSTONES) fail('too_many_discards', 409);
    state.tombstones = [...state.tombstones, removed.id];
    // Status follows what is left: discarding a result that the finish depended on reopens the programme;
    // discarding an older result from a repeated week leaves it finished.
    if (state.status !== 'paused') {
      const finished = nextStep(state, rules).type === 'final';
      state.status = finished ? 'completed' : 'active';
      if (!finished) state.completedAt = null;
    }
    return done(state);
  }

  if (op.op === 'review') {
    assertActive(state);
    if (!WEEKS.includes(op.week) || op.week === 4 || !['continue', 'repeat'].includes(op.decision)) fail('invalid_review');
    const step = nextStep(state, rules);
    if (step.type !== 'review' || step.week !== op.week) fail('review_not_due', 409);
    if (op.decision === 'repeat' && currentCycle(state, op.week) >= MAX_REPEATS) fail('repeat_limit', 409);
    state.reviews.push({ week: op.week, cycle: currentCycle(state, op.week), decision: op.decision, at: now });
    if (op.decision === 'repeat') state.cycles[String(op.week)] = currentCycle(state, op.week) + 1;
    return done(state);
  }
  return fail('invalid_operation');
}

/** Short record of a finished or abandoned run, kept when a new run starts. */
export function summary(state, rules) {
  const final = state.status === 'completed' ? finalComparison(state, rules) : null;
  return { route: state.route, startedAt: state.startedAt, completedAt: state.completedAt, status: state.status, baselineSeconds: state.baseline.seconds, sessionsRecorded: state.results.length, final };
}

/** Days between two local calendar dates (b - a). */
export function daysBetween(a, b) {
  if (!isCalendarDate(a) || !isCalendarDate(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Advisory only: the plan asks for a rest day between sessions. */
export function restDayNote(state, today) {
  if (!state?.results?.length) return null;
  const last = [...state.results].sort((x, y) => (x.localDate < y.localDate ? 1 : -1))[0];
  const gap = daysBetween(last.localDate, today);
  return gap !== null && gap < 2 ? { lastDate: last.localDate, ruleIds: ['w4.rest_day_between'] } : null;
}

/** Shape check for a stored state read back from D1. Returns the state or null when unusable. */
export function parseStoredState(text) {
  try {
    const state = JSON.parse(text);
    if (!state || state.v !== STATE_VERSION || !ROUTES.includes(state.route) || !Array.isArray(state.results)) return null;
    return state;
  } catch { return null; }
}

export const ASSISTANCE = ASSISTANCE_TYPES;
