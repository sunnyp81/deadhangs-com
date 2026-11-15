// Pure plan builder. Every number comes from plan-rules.json or the buyer's PlanInputs.

const FIRST_INT = /\d+/;
export const MAX_TEST_SECONDS = 3600;
export const AGE_BANDS = Object.freeze(['under-40', '40-59', '60-plus']);

function byId(rules) {
  const list = Array.isArray(rules) ? rules : rules?.rules;
  if (!Array.isArray(list)) throw new Error('plan rules missing');
  const map = new Map(list.map((r) => [r.id, r]));
  return (id) => {
    const rule = map.get(id);
    if (!rule) throw new Error(`plan rule missing: ${id}`);
    return rule;
  };
}

const intIn = (rule) => {
  const m = FIRST_INT.exec(String(rule.value));
  if (!m) throw new Error(`plan rule has no number: ${rule.id}`);
  return Number(m[0]);
};

/** Numbers the plan uses, each read from a rule. */
export function planLimits(rules) {
  const rule = byId(rules);
  const [lo, hi] = String(rule('w8.rest_seconds').value).match(/\d+/g).map(Number);
  return {
    sets: Number(rule('w8.sets').value),
    sessionsPerWeek: Number(rule('w8.sessions_per_week').value),
    restLow: lo,
    restHigh: hi,
    addSeconds: Number(rule('w8.add_seconds_weeks3_4').value),
    minRepeat: intIn(rule('w8.entry_hold')),
    maxRepeat: intIn(rule('pg.l3_exit')),
    regressionBelow: intIn(rule('w4.entry_hold')),
    ruleIds: { sets: 'w8.sets', sessions: 'w8.sessions_per_week', rest: 'w8.rest_seconds', add: 'w8.add_seconds_weeks3_4', min: 'w8.entry_hold', max: 'pg.l3_exit' },
  };
}

const isInt = (n) => Number.isInteger(n);

/** Eligibility and shape check. Returns { ok: true } or { ok: false, error, route? }. */
export function checkInputs(inputs, rules) {
  const lim = planLimits(rules);
  const { testSeconds, repeatSeconds, sessionsPerWeek } = inputs ?? {};
  if (!isInt(testSeconds) || !isInt(repeatSeconds) || testSeconds < 1 || testSeconds > MAX_TEST_SECONDS || repeatSeconds < 1) {
    return { ok: false, error: 'invalid_inputs' };
  }
  if (sessionsPerWeek !== lim.sessionsPerWeek) return { ok: false, error: 'invalid_inputs' };
  if (repeatSeconds < lim.minRepeat) {
    return repeatSeconds < lim.regressionBelow
      ? { ok: false, error: 'ineligible_low', route: { url: '/deadhang-progressions/', ruleIds: ['w4.under_5s', 'pg.l1'] } }
      : { ok: false, error: 'ineligible_low', route: { url: '/4-week-program/', ruleIds: ['w8.entry_hold', 'w8.entry_fallback'] } };
  }
  if (repeatSeconds > lim.maxRepeat) {
    return { ok: false, error: 'ineligible_high', route: { url: '/deadhang-progressions/', ruleIds: ['pg.l3_exit'] } };
  }
  if (testSeconds < repeatSeconds) return { ok: false, error: 'invalid_inputs' };
  return { ok: true };
}

/**
 * Builds the 8-week plan. Weeks 1 and 2 use the buyer's repeatable hold. Weeks 3 and 4, 5 and 6 each
 * offer "same" or "add the rule's seconds when every set was clean", capped at the ladder exit hold.
 * Weeks 7 and 8 repeat whichever earlier setup worked best; ties keep the earlier one.
 */
export function buildPlan(inputs, rules) {
  const check = checkInputs(inputs, rules);
  if (!check.ok) return check;
  const lim = planLimits(rules);
  const R = inputs.repeatSeconds;
  const step = (h) => Math.min(h + lim.addSeconds, lim.maxRepeat);
  const base = { sets: lim.sets, restLow: lim.restLow, restHigh: lim.restHigh };
  const common = ['w8.sets', 'w8.rest_seconds', 'w8.sessions_per_week'];

  const w12 = [{ key: 'start', when: 'start', holdSeconds: R, rules: ['w8.block1_hold', 'w8.block1_setup'] }];

  const w34 = [{ key: 'same', when: 'same', holdSeconds: R, rules: ['w8.add_seconds_weeks3_4'] }];
  const w34Up = step(R);
  if (w34Up > R) w34.push({ key: 'clean', when: 'clean', holdSeconds: w34Up, rules: ['w8.add_seconds_weeks3_4'] });
  const capped34 = w34Up === R;

  const w56 = [];
  for (const from of w34.map((o) => o.holdSeconds)) {
    w56.push({ key: `same-${from}`, when: 'same', from, holdSeconds: from, rules: ['w8.weeks5_6_hold', 'w8.weeks5_6_fallback'] });
    const up = step(from);
    if (up > from) w56.push({ key: `clean-${from}`, when: 'clean', from, holdSeconds: up, rules: ['w8.weeks5_6_hold', 'w8.add_seconds_weeks3_4'] });
  }
  const seen = new Set();
  const w56u = w56.filter((o) => { const k = `${o.from}:${o.holdSeconds}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const capped56 = w56u.some((o) => o.when === 'same' && o.from === lim.maxRepeat);

  const candidates = [...new Set([...w12, ...w34, ...w56u].map((o) => o.holdSeconds))].sort((a, b) => a - b);
  const w78 = candidates.map((h) => ({ key: `best-${h}`, when: 'best', holdSeconds: h, rules: ['w8.weeks7_8_hold'] }));

  const weeks = [
    { week: 1, block: 1, ...base, options: w12, rules: common },
    { week: 2, block: 1, ...base, options: w12, rules: common },
    { week: 3, block: 2, ...base, options: w34, rules: common },
    { week: 4, block: 2, ...base, options: w34, rules: common, retest: true },
    { week: 5, block: 3, ...base, options: w56u, rules: common },
    { week: 6, block: 3, ...base, options: w56u, rules: common },
    { week: 7, block: 4, ...base, options: w78, rules: common },
    { week: 8, block: 4, ...base, options: w78, rules: common, retest: true },
  ];

  return {
    ok: true,
    inputs: { ...inputs },
    limits: lim,
    capReached: capped34 || capped56,
    capped34,
    weeks,
    retestWeeks: [4, 8],
    retestRules: ['w8.retest_weeks', 'w8.compare_like_with_like'],
    // Rules rendered verbatim, by id. Quotes are exempt from the template denylist.
    quoteGroups: {
      cleanSet: ['pg.move_up_form', 'pg.move_up_pain'],
      stop: ['w8.stop_painful', 'w8.stop_rule', 'sf.stop_what_to_do'],
      troubleshooting: ['w8.missed_session', 'w8.change_plan', 'w8.one_variable', 'w8.extra_session', 'w8.rest_days'],
      capLine: ['pg.l3_exit', 'pg.l4'],
    },
  };
}

/** Week 1 summary for the buying card: { text, ruleIds }, or null when the inputs are not eligible. */
export function weekOneLine(inputs, rules) {
  const plan = buildPlan(inputs, rules);
  if (!plan.ok) return null;
  const w = plan.weeks[0];
  const hold = w.options[0].holdSeconds;
  return {
    text: `Week 1: ${w.sets} sets of ${hold} seconds, rest ${w.restLow} to ${w.restHigh} seconds`,
    ruleIds: [...new Set([...w.rules, ...w.options[0].rules])],
  };
}

/** The 4-week guide's suggestion, for display beside the input only. Never computed or auto-filled. */
export function baselineHint(rules) {
  const rule = byId(rules)('w4.baseline_fraction');
  return { ruleId: rule.id, quote: rule.quote, source: rule.source };
}

export function ruleLookup(rules) { return byId(rules); }
