// Builds what the programme app shows. Server-only: session copy is paid content and leaves only after an entitlement check.
import { buildSchedule, finalComparison, nextStep, restDayNote, routeForBaseline, suggestedBaseline, weekSummary, programmeNumbers, WEEKS } from '../lib/programme-engine.mjs';
import { buildTimerUrl } from '../lib/timer-preset.mjs';
import { isCalendarDate } from '../lib/training-log.mjs';

const textOf = (entry) => (entry && typeof entry === 'object' ? entry.text : entry) || '';

/** Timer link for a session: preset values only, never autostart. */
export function timerLinkFor(session) {
  if (session.kind === 'test' || session.kind === 'check') return buildTimerUrl('', { config: { mode: 'test' } });
  return buildTimerUrl('', { config: { mode: 'simple', workSeconds: session.targetSeconds, restSeconds: session.restSeconds, rounds: session.sets, prepSeconds: 5 } });
}

function sessionView(session, copy, route) {
  const words = copy[route]?.[session.key] || {};
  return { ...session, title: words.title || '', focus: words.focus || '', cues: Array.isArray(words.cues) ? words.cues : [], timerUrl: timerLinkFor(session) };
}

/**
 * The app view for an entitled user. `today` is the client's local date (YYYY-MM-DD) for the rest-day note only.
 * Returns plain JSON-safe data.
 */
export function buildProgrammeView({ state, revision, copy, rules, today }) {
  const common = Object.fromEntries(Object.entries(copy.common || {}).map(([key, value]) => [key, textOf(value)]));
  if (!state) {
    const n = programmeNumbers(rules);
    return { revision, enrolled: false, next: { type: 'enrol' }, common, onboarding: copy.onboarding,
      limits: { minBaseline: n.minBaseline, maxBaseline: n.maxBaseline, baselinePercent: n.baselinePercent, checkMaxSeconds: n.checkMaxSeconds },
      startSession: { standard: sessionView({ key: 's0', week: 0, index: 0, kind: 'test', sets: 1, targetSeconds: null, restSeconds: null, assistance: 'unassisted', ruleIds: ['w4.baseline_test_stop', 'w4.baseline_fraction', 'w4.baseline_definition'] }, copy, 'standard'),
        supported: sessionView({ key: 's0', week: 0, index: 0, kind: 'check', sets: 1, targetSeconds: null, restSeconds: null, assistance: 'unassisted', ruleIds: ['w4.under_5s', 'sf.start_short'] }, copy, 'supported') } };
  }
  const schedule = buildSchedule(state.route, state.baseline.seconds, rules);
  const step = nextStep(state, rules);
  const next = { type: step.type };
  if (step.type === 'session') next.session = sessionView(step.session, copy, state.route);
  if (step.type === 'review') next.review = { ...weekSummary(state, step.week, rules), words: copy.reviews?.[state.route]?.[`week${step.week}`] || null };
  if (step.type === 'final') next.final = { ...finalComparison(state, rules), words: copy.final };
  const weeks = WEEKS.map((week) => {
    const cycle = state.cycles[String(week)] ?? 0;
    return {
      week, cycle,
      sessions: schedule.filter((s) => s.week === week).map((s) => {
        const result = state.results.find((r) => r.sessionKey === s.key && r.cycle === cycle) || null;
        return { key: s.key, kind: s.kind, sets: s.sets, targetSeconds: s.targetSeconds, title: copy[state.route]?.[s.key]?.title || '', done: Boolean(result), resultId: result?.id ?? null };
      }),
    };
  });
  return {
    revision, enrolled: true, route: state.route, status: state.status, baseline: state.baseline, startedAt: state.startedAt, pausedAt: state.pausedAt,
    completedAt: state.completedAt, reminders: state.reminders, history: state.history,
    next, weeks, results: state.results,
    restDay: isCalendarDate(today) ? restDayNote(state, today) : null,
    common,
  };
}

/** Pre-enrolment helpers for the onboarding form. */
export function onboardingAdvice(seconds, maxTestSeconds, rules) {
  return { route: routeForBaseline(seconds, rules), suggested: suggestedBaseline(maxTestSeconds, rules) };
}
