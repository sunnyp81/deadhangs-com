import { buildPlan, ruleLookup } from './plan8.mjs';
import { DEFAULT_TIMER_CONFIG, buildTimerQuery } from './timer-preset.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

// Display labels for the by-age page's age groups. The chart comparison uses the label only.
export const AGE_BAND_LABELS = { 'under-40': 'Adults under 40', '40-59': 'Adults 40 to 59', '60-plus': 'Adults 60 and over' };

const pagePath = (source) => { try { return new URL(source).pathname; } catch { return source; } };

/** A rule quote rendered verbatim, with its rule id and source page. */
function quote(rule) {
  return `<blockquote class="plan8-quote" data-rule="${esc(rule.id)}"><p>${esc(rule.quote)}</p><footer><a href="${esc(pagePath(rule.source))}">Source page</a> <code>${esc(rule.id)}</code></footer></blockquote>`;
}

const secs = (n) => `${n} seconds`;
const ruleAttr = (ids) => esc([...new Set(ids)].join(' '));

function timerHref(hold, lim) {
  const q = buildTimerQuery({ config: { ...DEFAULT_TIMER_CONFIG, mode: 'simple', workSeconds: hold, restSeconds: lim.restHigh, rounds: lim.sets } });
  return `/training-log/?${q}`;
}

function optionLabel(o, week, lim) {
  if (week.block === 1 || week.block === 4) return `${lim.sets} sets of ${secs(o.holdSeconds)}`;
  if (week.block === 2) return o.when === 'same' ? `Same hold: ${lim.sets} sets of ${secs(o.holdSeconds)}` : `Every set was clean: ${lim.sets} sets of ${secs(o.holdSeconds)}`;
  const from = `If you held ${secs(o.from)}`;
  return o.when === 'same' ? `${from}, stay at ${secs(o.holdSeconds)}` : `${from} and every set was clean, move to ${secs(o.holdSeconds)}`;
}

function weekRow(week, lim) {
  const items = week.options.map((o) => `<li data-rules="${ruleAttr([...week.rules, ...o.rules])}">${esc(optionLabel(o, week, lim))}</li>`).join('');
  const detail = week.block === 4
    ? '<p class="plan8-small">Repeat the setup that worked best in weeks 1 to 6. If two are equal, keep the earlier one.</p>'
    : '';
  const retest = week.retest ? '<p class="plan8-retest">Review at the end of this week.</p>' : '';
  return `<tr><th scope="row">Week ${week.week}</th><td data-rules="${ruleAttr(week.rules)}">${lim.sessionsPerWeek} sessions, ${lim.sets} sets, rest ${lim.restLow} to ${lim.restHigh} seconds</td><td><ul>${items}</ul>${detail}${retest}</td></tr>`;
}

export function renderPlanHtml(plan, rules, { origin = '' } = {}) {
  const rule = ruleLookup(rules);
  const lim = plan.limits;
  const { inputs } = plan;
  const bandLabel = AGE_BAND_LABELS[inputs.ageBand];
  const holds = [...new Set(plan.weeks.flatMap((w) => w.options.map((o) => o.holdSeconds)))].sort((a, b) => a - b);
  const q = (ids) => ids.map((id) => quote(rule(id))).join('');
  const ruleIdsShown = [...new Set(plan.weeks.flatMap((w) => [...w.rules, ...w.options.flatMap((o) => o.rules)]).concat(['w8.entry_hold', 'pg.l3_exit']))];

  const cap = plan.capReached
    ? `<section class="plan8-section"><h2>You are at the top of this plan</h2><p>No set goes above ${secs(lim.maxRepeat)}. At ${secs(lim.maxRepeat)} the plan stops adding. The next level is on the free progressions page.</p>${q(plan.quoteGroups.capLine)}<p><a href="/deadhang-progressions/">Open the progressions guide</a></p></section>`
    : '';

  const timerLinks = holds.map((h) => `<li><a href="${esc(origin + timerHref(h, lim))}">${secs(h)} timer</a></li>`).join('');
  const rulesList = ruleIdsShown.map((id) => { const r = rule(id); return `<li><code>${esc(r.id)}</code> ${esc(r.quote)} <a href="${esc(pagePath(r.source))}">Source page</a></li>`; }).join('');

  return `<div class="plan8" data-plan="8-week">
<section class="plan8-section plan8-numbers"><h2>Your numbers</h2><dl>
<div><dt>Longest controlled hold</dt><dd>${secs(inputs.testSeconds)}</dd></div>
<div><dt>Hold you can repeat ${lim.sets} times</dt><dd data-rules="${ruleAttr(['w8.sets', 'w8.block1_hold'])}">${secs(inputs.repeatSeconds)}</dd></div>
<div><dt>Sessions each week</dt><dd data-rules="w8.sessions_per_week">${lim.sessionsPerWeek}</dd></div>
</dl><p class="plan8-small">Built from the same progression rules as the free guides, arranged around your result. The rule behind each figure is listed at the bottom of this page.</p>
<p class="plan8-actions plan8-noprint"><button type="button" class="plan8-print" data-print>Print this plan</button></p></section>
<section class="plan8-section"><h2>Is a set clean?</h2><p>You judge this yourself after every set. The choices in weeks 3 to 4 and 5 to 6 depend on your answer.</p>${q(plan.quoteGroups.cleanSet)}</section>
<section class="plan8-section plan8-table"><h2>Your 8 weeks</h2><div class="plan8-scroll" role="region" tabindex="0" aria-label="8-week plan table"><table><thead><tr><th scope="col">Week</th><th scope="col">Each week</th><th scope="col">Your holds</th></tr></thead><tbody>${plan.weeks.map((w) => weekRow(w, lim)).join('')}</tbody></table></div>
<p class="plan8-small">Hang on non-consecutive days, for example Monday, Wednesday and Friday.</p></section>
${cap}
<section class="plan8-section"><h2>Review in weeks 4 and 8</h2>${q(plan.retestRules)}
<table class="plan8-log"><thead><tr><th scope="col">Review</th><th scope="col">Session 1</th><th scope="col">Session 2</th></tr></thead><tbody><tr><th scope="row">End of week 4</th><td>&nbsp;</td><td>&nbsp;</td></tr><tr><th scope="row">End of week 8</th><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>
<p>Log both sessions in the <a href="/training-log/">training log</a> so you can compare them.</p>
<p class="plan8-noprint">Optional: ${bandLabel ? `you chose ${esc(bandLabel.toLowerCase())}. ` : ''}See how your result sits against the reference points on the <a href="/dead-hang-time-by-age/">dead hang time by age page</a>. They are reference points, not targets.</p></section>
<section class="plan8-section plan8-noprint"><h2>Timer presets for your holds</h2><p>Each link opens the timer with ${lim.sets} rounds and ${secs(lim.restHigh)} of rest. You can shorten the rest to ${secs(lim.restLow)} in the timer.</p><ul class="plan8-links">${timerLinks}</ul></section>
<section class="plan8-section"><h2>Stop and troubleshooting</h2>${q(plan.quoteGroups.stop)}${q(plan.quoteGroups.troubleshooting)}</section>
<section class="plan8-section"><h2>A lighter week</h2><p>Convention, not a tested rule. Not scheduled in this plan.</p>${q(plan.quoteGroups.convention)}</section>
<section class="plan8-section"><h2>About these numbers</h2>${q(['bg.dose_caveat'])}</section>
<section class="plan8-section plan8-noprint"><details><summary>How each number is set</summary><ul class="plan8-rules">${rulesList}</ul></details></section>
</div>`;
}

export function renderGoneHtml() {
  return '<div class="plan8 plan8-gone"><h2>This plan link is not active</h2><p>The link is wrong, or the plan has been refunded.</p><p>Lost your link? See <a href="/plan/lost-link/">how to get it back</a>.</p></div>';
}

export function renderUnavailableHtml() {
  return '<div class="plan8 plan8-gone"><h2>Your plan cannot load right now</h2><p>Try again in a minute.</p></div>';
}

export { buildPlan };
