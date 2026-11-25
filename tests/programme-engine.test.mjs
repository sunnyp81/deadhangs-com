import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyOperation, buildSchedule, finalComparison, nextStep, programmeNumbers, restDayNote, routeForBaseline, suggestedBaseline, weekSummary, ProgrammeError } from '../src/lib/programme-engine.mjs';
import { contentProblems, programmeSalesState, publicInclusions } from '../src/server/programme-gate.mjs';
import { HANG4 } from '../src/data/programmes/hang4.public.mjs';
import { buildProgrammeView, timerLinkFor } from '../src/server/programme-view.mjs';

const rules = JSON.parse(fs.readFileSync(new URL('../src/data/plan-rules.json', import.meta.url), 'utf8'));
const copy = JSON.parse(fs.readFileSync(new URL('../src/server/programmes/hang4.copy.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T10:00:00.000Z';
const apply = (state, op) => applyOperation(state, op, rules, NOW);
const code = (fn) => { try { fn(); } catch (error) { assert.ok(error instanceof ProgrammeError, String(error)); return error.code; } return null; };
const setup = { bar: 'standard', grip: 'overhand', chalk: false };
let n = 0;
const rid = () => `result-${String(++n).padStart(4, '0')}`;

function enrolStandard(baseline = 10, max = 13) {
  return apply(null, { op: 'enrol', route: 'standard', baselineSeconds: baseline, maxTestSeconds: max, setup, localDate: '2026-11-02' }).state;
}
function recordNext(state, sets, extra = {}) {
  const step = nextStep(state, rules);
  assert.equal(step.type, 'session');
  return apply(state, { op: 'record', id: rid(), sessionKey: step.session.key, sets: sets ?? Array(step.session.sets).fill(step.session.targetSeconds ?? 20), setup, localDate: '2026-11-03', ...extra }).state;
}

test('every programme number is read from a sourced rule', () => {
  const numbers = programmeNumbers(rules);
  assert.deepEqual({ ...numbers, ruleIds: undefined }, { sets: 3, restSeconds: 90, sessionsPerWeek: 3, week2Add: 5, week3Add: 5, minBaseline: 5, maxBaseline: 20, baselinePercent: 80,
    repeatMissSeconds: 5, thirdSetAllowance: 3, supportedSets: 3, supportedHold: 15, supportedRest: 90, checkMaxSeconds: 10, ruleIds: undefined });
  const ids = new Set(rules.rules.map((r) => r.id));
  for (const id of Object.values(numbers.ruleIds)) assert.ok(ids.has(id), id);
});

test('standard schedule: baseline, +5, +10, two sessions at week 3 targets, then test day; supported route stays feet-supported', () => {
  const standard = buildSchedule('standard', 10, rules);
  assert.equal(standard.length, 12);
  assert.deepEqual(standard.map((s) => s.targetSeconds), [10, 10, 10, 15, 15, 15, 20, 20, 20, 20, 20, null]);
  assert.equal(standard.at(-1).kind, 'test');
  assert.ok(standard.every((s) => s.kind === 'test' || (s.sets === 3 && s.restSeconds === 90)));
  const supported = buildSchedule('supported', null, rules);
  assert.equal(supported.filter((s) => s.kind === 'training').every((s) => s.targetSeconds === 15 && s.assistance === 'feet-supported'), true);
  assert.equal(supported.at(-1).kind, 'check');
  assert.equal(supported.at(-1).assistance, 'unassisted');
});

test('route boundaries and the suggested baseline come from the rules', () => {
  assert.equal(routeForBaseline(4, rules), 'supported');
  assert.equal(routeForBaseline(5, rules), 'standard');
  assert.equal(routeForBaseline(20, rules), 'standard');
  assert.equal(routeForBaseline(21, rules), 'outside');
  assert.equal(suggestedBaseline(13, rules), 10);
  assert.equal(suggestedBaseline(0, rules), null);
});

test('enrolment rejects holds outside the route and inconsistent tests', () => {
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'standard', baselineSeconds: 21, setup, localDate: '2026-11-02' })), 'baseline_outside_range');
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'standard', baselineSeconds: 3, setup, localDate: '2026-11-02' })), 'baseline_needs_supported');
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, maxTestSeconds: 8, setup, localDate: '2026-11-02' })), 'invalid_max_test');
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, setup: { bodyweightKg: 80 }, localDate: '2026-11-02' })), 'invalid_setup');
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, localDate: '2026-11-02', extra: 1 })), 'invalid_operation');
  assert.equal(code(() => apply(enrolStandard(), { op: 'enrol', route: 'standard', baselineSeconds: 10, setup, localDate: '2026-11-02' })), 'already_enrolled');
});

test('only the next session can be recorded; a retry with the same id is a no-op and a changed retry is refused', () => {
  const state = enrolStandard();
  assert.equal(code(() => apply(state, { op: 'record', id: rid(), sessionKey: 'w1s2', sets: [10, 10, 10], setup, localDate: '2026-11-03' })), 'not_next_session');
  const op = { op: 'record', id: rid(), sessionKey: 'w1s1', sets: [10, 9, 8], setup, localDate: '2026-11-03' };
  const first = apply(state, op);
  assert.equal(first.changed, true);
  const again = apply(first.state, op);
  assert.equal(again.changed, false);
  assert.equal(again.state.results.length, 1);
  assert.equal(code(() => apply(first.state, { ...op, sets: [10, 10, 10] })), 'id_conflict');
});

test('planned targets are stored apart from actual holds and a result needs at least one actual hold', () => {
  const state = enrolStandard();
  assert.equal(code(() => apply(state, { op: 'record', id: rid(), sessionKey: 'w1s1', sets: [null, null, null], setup, localDate: '2026-11-03' })), 'no_actual_result');
  assert.equal(code(() => apply(state, { op: 'record', id: rid(), sessionKey: 'w1s1', sets: [10, 10], setup, localDate: '2026-11-03' })), 'invalid_sets');
  const next = apply(state, { op: 'record', id: rid(), sessionKey: 'w1s1', sets: [6, null, 4], setup, localDate: '2026-11-03' }).state;
  assert.deepEqual(next.results[0].sets, [6, null, 4]);
  assert.deepEqual(next.results[0].planned, { sets: 3, targetSeconds: 10, restSeconds: 90 });
});

test('weekly review gates the next week; repeating a week keeps its targets and missed days never add work', () => {
  let state = enrolStandard(10);
  for (let i = 0; i < 3; i += 1) state = recordNext(state, [10, 10, 8]);
  assert.deepEqual(nextStep(state, rules), { type: 'review', week: 1 });
  assert.equal(code(() => apply(state, { op: 'record', id: rid(), sessionKey: 'w2s1', sets: [15, 15, 15], setup, localDate: '2026-11-20' })), 'not_next_session');
  const repeated = apply(state, { op: 'review', week: 1, decision: 'repeat' }).state;
  const again = nextStep(repeated, rules);
  assert.equal(again.session.key, 'w1s1');
  assert.equal(again.session.targetSeconds, 10);
  const continued = apply(state, { op: 'review', week: 1, decision: 'continue' }).state;
  const week2 = nextStep(continued, rules);
  assert.equal(week2.session.key, 'w2s1');
  assert.equal(week2.session.targetSeconds, 15);
  const late = recordNext(continued, [15, 15, 15], { localDate: '2026-12-20' });
  assert.equal(nextStep(late, rules).session.targetSeconds, 15, 'a three-week gap does not raise the target');
});

test('pause stops recording until resumed; discard reopens a session and its id can never come back', () => {
  let state = enrolStandard();
  state = apply(state, { op: 'pause' }).state;
  assert.equal(code(() => apply(state, { op: 'record', id: rid(), sessionKey: 'w1s1', sets: [10, 10, 10], setup, localDate: '2026-11-03' })), 'paused');
  state = apply(state, { op: 'resume' }).state;
  const id = rid();
  state = apply(state, { op: 'record', id, sessionKey: 'w1s1', sets: [10, 10, 10], setup, localDate: '2026-11-03' }).state;
  state = apply(state, { op: 'discard', id }).state;
  assert.equal(nextStep(state, rules).session.key, 'w1s1');
  assert.equal(code(() => apply(state, { op: 'record', id, sessionKey: 'w1s1', sets: [10, 10, 10], setup, localDate: '2026-11-03' })), 'result_discarded');
  assert.equal(apply(state, { op: 'discard', id }).changed, false, 'repeated discard is a no-op');
});

test('final comparison only compares like with like, and editing the result updates it', () => {
  let state = enrolStandard(10, 13);
  for (const week of [1, 2, 3]) {
    for (let i = 0; i < 3; i += 1) state = recordNext(state);
    state = apply(state, { op: 'review', week, decision: 'continue' }).state;
  }
  state = recordNext(state); state = recordNext(state);
  const testId = rid();
  state = apply(state, { op: 'record', id: testId, sessionKey: 'w4s3', sets: [19], setup, localDate: '2026-11-30' }).state;
  assert.equal(state.status, 'completed');
  assert.deepEqual(nextStep(state, rules), { type: 'final' });
  const final = finalComparison(state, rules);
  assert.equal(final.comparable, true);
  assert.equal(final.difference, 6);
  const edited = apply(state, { op: 'edit', id: testId, sets: [17] }).state;
  assert.equal(finalComparison(edited, rules).difference, 4);
  const otherGrip = apply(state, { op: 'edit', id: testId, setup: { ...setup, grip: 'neutral' } }).state;
  assert.equal(finalComparison(otherGrip, rules).comparable, false);
  assert.equal(finalComparison(otherGrip, rules).difference, null);
  const restarted = apply(state, { op: 'enrol', route: 'standard', baselineSeconds: 15, setup, localDate: '2026-12-02' }).state;
  assert.equal(restarted.history.length, 1);
  assert.equal(restarted.results.length, 0);
});

test('supported route: feet-supported training, unassisted check compared with an unassisted start only', () => {
  let state = apply(null, { op: 'enrol', route: 'supported', unassistedSeconds: 3, setup, localDate: '2026-11-02' }).state;
  assert.equal(code(() => apply(null, { op: 'enrol', route: 'supported', unassistedSeconds: 8, setup, localDate: '2026-11-02' })), 'baseline_not_supported_range');
  for (const week of [1, 2, 3]) {
    for (let i = 0; i < 3; i += 1) state = recordNext(state, [15, 15, 12]);
    state = apply(state, { op: 'review', week, decision: 'continue' }).state;
  }
  state = recordNext(state, [15, 15, 15]); state = recordNext(state, [15, 15, 15]);
  assert.equal(state.results[0].assistance, 'feet-supported');
  state = recordNext(state, [6]);
  const final = finalComparison(state, rules);
  assert.equal(final.kind, 'check');
  assert.equal(final.comparable, true);
  assert.equal(final.difference, 3);
});

test('week summary suggests repeating only from recorded shortfalls beyond the allowance', () => {
  let state = enrolStandard(10);
  state = recordNext(state, [4, 4, 4]); state = recordNext(state, [4, 10, 10]); state = recordNext(state, [10, 10, 5]);
  const summary = weekSummary(state, 1, rules);
  assert.equal(summary.missedSessions, 2);
  assert.equal(summary.suggestRepeat, true);
  let clean = enrolStandard(10);
  for (let i = 0; i < 3; i += 1) clean = recordNext(clean, [10, 10, 7]);
  assert.equal(weekSummary(clean, 1, rules).suggestRepeat, false, 'three seconds short on the third set is allowed');
});

test('reminder preferences are validated and rest days are advisory', () => {
  let state = enrolStandard();
  assert.equal(code(() => apply(state, { op: 'reminders', reminders: { enabled: true, days: [], localTime: '18:00', timezone: 'Europe/London' } })), 'invalid_reminders');
  assert.equal(code(() => apply(state, { op: 'reminders', reminders: { enabled: true, days: ['mon'], localTime: '25:00', timezone: 'Europe/London' } })), 'invalid_reminders');
  assert.equal(code(() => apply(state, { op: 'reminders', reminders: { enabled: true, days: ['mon'], localTime: '18:00', timezone: 'Mars/Base' } })), 'invalid_reminders');
  state = apply(state, { op: 'reminders', reminders: { enabled: true, days: ['fri', 'mon', 'mon'], localTime: '07:30', timezone: 'America/New_York' } }).state;
  assert.deepEqual(state.reminders.days, ['mon', 'fri']);
  state = recordNext(state, [10, 10, 10], { localDate: '2026-11-03' });
  assert.ok(restDayNote(state, '2026-11-04'));
  assert.equal(restDayNote(state, '2026-11-05'), null);
});

test('copy covers every session and review, cites real rules, and every number in it appears in its rules', () => {
  const ids = new Map(rules.rules.map((r) => [r.id, r]));
  for (const route of ['standard', 'supported']) {
    for (const s of [{ key: 's0' }, ...buildSchedule(route, 10, rules)]) assert.ok(copy[route][s.key]?.title, `${route} ${s.key}`);
    for (const week of [1, 2, 3]) assert.ok(copy.reviews[route][`week${week}`], `${route} review ${week}`);
  }
  const walk = (node, inherited, path) => {
    if (typeof node === 'string') {
      // Week and session numbers are structure, not doses.
      const doses = node.replace(/\b(weeks?|sessions?|level)\s+\d+(\s*(,|and|to)\s*\d+)*/gi, '');
      for (const found of doses.match(/\d+/g) || []) {
        const ok = inherited.some((id) => { const r = ids.get(id); return r && `${r.value} ${r.quote}`.match(/\d+/g)?.includes(found); });
        assert.ok(ok, `${path}: number ${found} not in rules ${inherited.join(',')}`);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    const local = Array.isArray(node.ruleIds) ? [...inherited, ...node.ruleIds] : inherited;
    if (Array.isArray(node.ruleIds)) for (const id of node.ruleIds) assert.ok(ids.has(id) || /product rule/i.test(id), `${path}: unknown rule ${id}`);
    for (const [key, value] of Object.entries(node)) if (key !== 'ruleIds' && key !== 'version' && key !== 'programmeId') walk(value, local, `${path}.${key}`);
  };
  walk({ common: copy.common, standard: copy.standard, supported: copy.supported, reviews: copy.reviews, final: copy.final, onboarding: copy.onboarding }, [], 'copy');
  const text = JSON.stringify(copy);
  assert.equal(/[–—]/.test(text), false, 'no en or em dashes');
  assert.equal(/\b(coach(ed)?|guarantee[ds]?|physio-approved|reviewed by)\b/i.test(text), false, 'no coaching or review claims');
});

test('committed manifest is a draft: live sales stay closed even with the flag and a price', () => {
  assert.equal(HANG4.status, 'draft');
  const problems = contentProblems(HANG4, '2026-11-26');
  for (const expected of ['content_not_approved', 'review_reviewerName_missing', 'review_version_mismatch', 'terms_refund_missing']) assert.ok(problems.includes(expected), expected);
  const env = { PROGRAMME_LAUNCH_ENABLED: 'true', STRIPE_PROGRAMME_PRICE_ID: 'price_live', AUTH_BASE_URL: 'https://deadhangs.com', BILLING_MODE: 'live' };
  assert.equal(programmeSalesState(HANG4, env, true, '2026-11-26').open, false);
  assert.equal(programmeSalesState(HANG4, { ...env, BILLING_MODE: 'test', PROGRAMME_ALLOW_DRAFT: 'true' }, true, '2026-11-26').open, false, 'draft test sales never on the production origin');
  const preview = { ...env, AUTH_BASE_URL: 'https://preview.deadhangs-com-bew.pages.dev', BILLING_MODE: 'test', PROGRAMME_ALLOW_DRAFT: 'true' };
  assert.deepEqual(programmeSalesState(HANG4, preview, true, '2026-11-26'), { open: true, mode: 'test-draft', reasons: [] });
  assert.equal(programmeSalesState(HANG4, { ...preview, PROGRAMME_LAUNCH_ENABLED: 'false' }, true, '2026-11-26').open, false);
  assert.equal(programmeSalesState(HANG4, preview, false, '2026-11-26').open, false);
});

test('an approved manifest needs every reviewer field for this exact version, set terms and available promised assets', () => {
  const approved = {
    ...HANG4, status: 'approved',
    review: { reviewerName: 'Fixture Reviewer', reviewerRole: 'Fixture role', qualification: 'Fixture qualification', qualificationVerifiedBy: 'Fixture check', scope: 'whole programme', reviewedVersion: HANG4.version, approvedAt: '2026-11-20', evidence: 'fixture' },
    terms: { access: 'a', support: 's', refund: 'r' },
  };
  assert.deepEqual(contentProblems(approved, '2026-11-26'), []);
  const env = { PROGRAMME_LAUNCH_ENABLED: 'true', STRIPE_PROGRAMME_PRICE_ID: 'price_live', AUTH_BASE_URL: 'https://deadhangs.com', BILLING_MODE: 'live' };
  assert.deepEqual(programmeSalesState(approved, env, true, '2026-11-26'), { open: true, mode: 'live', reasons: [] });
  assert.ok(contentProblems({ ...approved, review: { ...approved.review, reviewedVersion: '0.0.9' } }, '2026-11-26').includes('review_version_mismatch'));
  assert.ok(contentProblems({ ...approved, review: { ...approved.review, approvedAt: '2026-12-01' } }, '2026-11-26').includes('review_date_invalid'));
  const videos = { ...approved, inclusions: approved.inclusions.map((i) => (i.id === 'videos' ? { ...i, promised: true } : i)) };
  assert.ok(contentProblems(videos, '2026-11-26').includes('asset_videos_unavailable'));
  const reminders = { ...approved, inclusions: approved.inclusions.map((i) => (i.id === 'reminders' ? { ...i, promised: true } : i)) };
  assert.ok(contentProblems(reminders, '2026-11-26').includes('feature_reminders_unverified'));
  assert.equal(programmeSalesState(approved, { ...env, STRIPE_PROGRAMME_PRICE_ID: 'nope' }, true, '2026-11-26').open, false);
  assert.ok(publicInclusions(HANG4).every((i) => i.promised));
  assert.equal(publicInclusions(HANG4).some((i) => i.id === 'videos' || i.id === 'reminders'), false);
});

test('view: enrol step for a new buyer, session content with a timer preset that never autostarts', () => {
  const empty = buildProgrammeView({ state: null, revision: 0, copy, rules, today: '2026-11-26' });
  assert.equal(empty.next.type, 'enrol');
  assert.equal(empty.limits.maxBaseline, 20);
  const state = enrolStandard(12);
  const view = buildProgrammeView({ state, revision: 1, copy, rules, today: '2026-11-26' });
  assert.equal(view.next.session.key, 'w1s1');
  assert.ok(view.next.session.title);
  assert.equal(view.next.session.timerUrl, timerLinkFor(view.next.session));
  const params = new URL(view.next.session.timerUrl, 'https://x.test').searchParams;
  assert.equal(params.get('hang'), '12');
  assert.equal(params.get('rest'), '90');
  assert.equal(params.get('rounds'), '3');
  assert.equal(params.has('autostart'), false);
  assert.equal(view.weeks.length, 4);
});
