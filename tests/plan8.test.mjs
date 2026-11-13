import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/data/plan-rules.json' with { type: 'json' };
import { buildPlan, planLimits, baselineHint } from '../src/lib/plan8.mjs';
import { renderPlanHtml, renderGoneHtml, esc } from '../src/lib/plan8-render.mjs';
import { lookupPlan, hashToken, isPlausibleToken } from '../src/server/plan-access.mjs';
import { handlePlanView } from '../src/server/plan-view.mjs';

const ids = new Set(rules.rules.map((r) => r.id));
const inputs = (repeatSeconds, extra = {}) => ({ testSeconds: Math.max(repeatSeconds + 10, 30), repeatSeconds, ageBand: '40-59', sessionsPerWeek: 3, ...extra });
const lim = planLimits(rules);
const DENY = /improve|stronger|health|pain|longevity|grip strength/i;

// Strips rule quotes and the rule list: the denylist applies to template strings only.
const templatesOnly = (html) => html
  .replace(/<blockquote[\s\S]*?<\/blockquote>/g, ' ')
  .replace(/<details>[\s\S]*?<\/details>/g, ' ')
  .replace(/<[^>]+>/g, ' ');

test('limits are read from rules', () => {
  assert.equal(lim.minRepeat, 20);
  assert.equal(lim.maxRepeat, 60);
  assert.equal(lim.addSeconds, 5);
  assert.equal(lim.sets, 3);
  assert.equal(lim.sessionsPerWeek, 3);
  assert.deepEqual([lim.restLow, lim.restHigh], [60, 90]);
});

test('19 is rejected as ineligible_low and routes to the 4-week page', () => {
  const r = buildPlan(inputs(19), rules);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ineligible_low');
  assert.equal(r.route.url, '/4-week-program/');
});

test('under 5 seconds routes to the regression ladder', () => {
  const r = buildPlan(inputs(4, { testSeconds: 6 }), rules);
  assert.equal(r.error, 'ineligible_low');
  assert.equal(r.route.url, '/deadhang-progressions/');
  assert.deepEqual(r.route.ruleIds, ['w4.under_5s', 'pg.l1']);
  assert.equal(buildPlan(inputs(5, { testSeconds: 8 }), rules).route.url, '/4-week-program/');
});

test('61 is rejected as ineligible_high', () => {
  const r = buildPlan(inputs(61), rules);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ineligible_high');
});

test('malformed inputs are rejected', () => {
  for (const bad of [
    { testSeconds: 30, repeatSeconds: 30, ageBand: 'x', sessionsPerWeek: 4 },
    { testSeconds: 25, repeatSeconds: 30, ageBand: 'x', sessionsPerWeek: 3 },
    { testSeconds: '40', repeatSeconds: 30, ageBand: 'x', sessionsPerWeek: 3 },
    { testSeconds: 40.5, repeatSeconds: 30, ageBand: 'x', sessionsPerWeek: 3 },
    { testSeconds: 9999, repeatSeconds: 30, ageBand: 'x', sessionsPerWeek: 3 },
    null,
  ]) assert.equal(buildPlan(bad, rules).error, 'invalid_inputs');
});

test('20 is the lowest eligible hold', () => {
  const p = buildPlan(inputs(20), rules);
  assert.equal(p.ok, true);
  assert.deepEqual(p.weeks[0].options.map((o) => o.holdSeconds), [20]);
  assert.deepEqual(p.weeks[2].options.map((o) => o.holdSeconds), [20, 25]);
  assert.equal(p.capReached, false);
});

test('30: weeks 1 and 2 at 30; branches 30 or 35; weeks 5 and 6 from both; weeks 7 and 8 best of 30, 35, 40', () => {
  const p = buildPlan(inputs(30), rules);
  assert.deepEqual(p.weeks[0].options.map((o) => o.holdSeconds), [30]);
  assert.deepEqual(p.weeks[1].options.map((o) => o.holdSeconds), [30]);
  assert.deepEqual(p.weeks[2].options.map((o) => [o.when, o.holdSeconds]), [['same', 30], ['clean', 35]]);
  assert.deepEqual(p.weeks[4].options.map((o) => [o.from, o.holdSeconds]), [[30, 30], [30, 35], [35, 35], [35, 40]]);
  assert.deepEqual(p.weeks[6].options.map((o) => o.holdSeconds), [30, 35, 40]);
});

test('55: the cap stops additions at 60', () => {
  const p = buildPlan(inputs(55), rules);
  assert.deepEqual(p.weeks[2].options.map((o) => o.holdSeconds), [55, 60]);
  assert.deepEqual(p.weeks[4].options.map((o) => [o.from, o.holdSeconds]), [[55, 55], [55, 60], [60, 60]]);
  assert.equal(p.capReached, true);
});

test('60: nothing is added and the Level 4 line is shown', () => {
  const p = buildPlan(inputs(60), rules);
  assert.equal(p.ok, true);
  for (const w of p.weeks) assert.deepEqual(w.options.map((o) => o.holdSeconds), [60]);
  assert.equal(p.capReached, true);
  const html = renderPlanHtml(p, rules);
  assert.match(html, /next level is on the free progressions page/);
  assert.match(html, /data-rule="pg\.l4"/);
});

test('boundary sweep: no hold above the cap, every option traces to existing rule ids', () => {
  for (let r = lim.minRepeat; r <= lim.maxRepeat; r++) {
    const p = buildPlan(inputs(r), rules);
    assert.equal(p.ok, true, `repeat ${r}`);
    assert.equal(p.weeks.length, 8);
    for (const w of p.weeks) {
      assert.ok(w.rules.length > 0);
      for (const id of w.rules) assert.ok(ids.has(id), id);
      assert.ok(w.options.length > 0);
      for (const o of w.options) {
        assert.ok(o.holdSeconds <= lim.maxRepeat, `week ${w.week} hold ${o.holdSeconds}`);
        assert.ok(o.holdSeconds >= r);
        assert.ok(o.rules.length > 0);
        for (const id of o.rules) assert.ok(ids.has(id), id);
        assert.ok([r, Math.min(r + lim.addSeconds, lim.maxRepeat)].includes(o.holdSeconds) || w.week >= 5);
      }
    }
  }
});

test('hold numbers are only the buyer input plus the rule step, capped', () => {
  const p = buildPlan(inputs(33), rules);
  const allowed = new Set([33, 38, 43]);
  for (const w of p.weeks) for (const o of w.options) assert.ok(allowed.has(o.holdSeconds));
});

test('every rule id the page cites exists and its quote is verbatim from rules', () => {
  const html = renderPlanHtml(buildPlan(inputs(30), rules), rules);
  const cited = new Set([...html.matchAll(/data-rule="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(cited.size >= 8);
  for (const id of cited) {
    assert.ok(ids.has(id), id);
    assert.ok(html.includes(esc(rules.rules.find((r) => r.id === id).quote)), id);
  }
  for (const m of html.matchAll(/data-rules="([^"]+)"/g)) for (const id of m[1].split(' ')) assert.ok(ids.has(id) || ['w8.block1_hold'].includes(id), id);
});

test('template strings carry no health claims (rule quotes exempt)', () => {
  for (const r of [20, 30, 55, 60]) {
    const html = renderPlanHtml(buildPlan(inputs(r), rules), rules);
    const text = templatesOnly(html);
    assert.doesNotMatch(text, DENY, `repeat ${r}: ${text.match(DENY)}`);
  }
  assert.doesNotMatch(templatesOnly(renderGoneHtml()), DENY);
});

test('no em dashes and no coach or programme wording in the rendered plan', () => {
  const text = templatesOnly(renderPlanHtml(buildPlan(inputs(30), rules), rules));
  assert.doesNotMatch(text, /—|–/);
  assert.doesNotMatch(text, /\bcoach|programme|reviewed/i);
});

test('baseline hint is the 4-week quote and is not computed', () => {
  const h = baselineHint(rules);
  assert.equal(h.ruleId, 'w4.baseline_fraction');
  assert.match(h.quote, /80%/);
});

test('timer links use the buyer holds, 3 rounds and the rule rest', () => {
  const html = renderPlanHtml(buildPlan(inputs(30), rules), rules);
  assert.match(html, /\/training-log\/\?mode=simple&amp;hang=35&amp;rest=90&amp;rounds=3/);
});

test('age band label never echoes unknown input', () => {
  const html = renderPlanHtml(buildPlan(inputs(30, { ageBand: '<script>alert(1)</script>' }), rules), rules);
  assert.doesNotMatch(html, /<script/);
  assert.match(renderPlanHtml(buildPlan(inputs(30, { ageBand: '60-plus' }), rules), rules), /adults 60 and over/);
});

// ----- access lookup with a mock D1 -----

function mockDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM plan_purchases WHERE token_hash = \?1/);
      return { bind: (hash) => ({ first: async () => rows.get(hash) ?? null }) };
    },
  };
}
const TOKEN = 'A'.repeat(43);

test('token shape check', () => {
  assert.equal(isPlausibleToken(TOKEN), true);
  for (const t of [null, '', 'short', 'x'.repeat(200), 'has space has space has space']) assert.equal(isPlausibleToken(t), false);
});

test('lookupPlan: paid ok, refunded gone, unknown gone, error unavailable', async () => {
  const rows = new Map();
  rows.set(await hashToken(TOKEN), { status: 'paid', inputs: JSON.stringify(inputs(30)) });
  rows.set(await hashToken('B'.repeat(43)), { status: 'refunded', inputs: JSON.stringify(inputs(30)) });
  rows.set(await hashToken('C'.repeat(43)), { status: 'paid', inputs: '{bad json' });
  const db = mockDb(rows);
  assert.deepEqual((await lookupPlan(db, TOKEN)).status, 'ok');
  assert.equal((await lookupPlan(db, TOKEN)).inputs.repeatSeconds, 30);
  assert.equal((await lookupPlan(db, 'B'.repeat(43))).status, 'gone');
  assert.equal((await lookupPlan(db, 'D'.repeat(43))).status, 'gone');
  assert.equal((await lookupPlan(db, 'C'.repeat(43))).status, 'invalid');
  assert.equal((await lookupPlan(db, null)).status, 'gone');
  assert.equal((await lookupPlan(undefined, TOKEN)).status, 'unavailable');
  const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('d1 down'); } }) }) };
  assert.equal((await lookupPlan(broken, TOKEN)).status, 'unavailable');
});

test('hashToken is lowercase hex SHA-256', async () => {
  assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ----- request handler -----

const SHELL = '<!doctype html><html><head><meta name="robots" content="noindex, follow"></head><body><main><!--PLAN8--></main></body></html>';
const assets = { fetch: async () => new Response(SHELL, { status: 200 }) };
const get = (url, env, method = 'GET') => handlePlanView(new Request(url, { method }), env);

test('/plan/view/: valid token returns 200 with the plan, noindex and no-store', async () => {
  const rows = new Map([[await hashToken(TOKEN), { status: 'paid', inputs: JSON.stringify(inputs(30)) }]]);
  const res = await get(`https://deadhangs.com/plan/view/?t=${TOKEN}`, { DB: mockDb(rows), ASSETS: assets });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const body = await res.text();
  assert.match(body, /Your 8 weeks/);
  assert.doesNotMatch(body, /<!--PLAN8-->/);
});

test('/plan/view/: missing, unknown and refunded tokens return 410 with no plan text', async () => {
  const rows = new Map([[await hashToken(TOKEN), { status: 'refunded', inputs: JSON.stringify(inputs(30)) }]]);
  const env = { DB: mockDb(rows), ASSETS: assets };
  for (const url of ['https://deadhangs.com/plan/view/', 'https://deadhangs.com/plan/view/?t=nope', `https://deadhangs.com/plan/view/?t=${TOKEN}`, `https://deadhangs.com/plan/view/?t=${'Z'.repeat(43)}`]) {
    const res = await get(url, env);
    assert.equal(res.status, 410, url);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    const body = await res.text();
    assert.doesNotMatch(body, /Your 8 weeks|plan8-quote|training-log\/\?mode/);
  }
});

test('/plan/view/: database down returns 503, other methods 405, shell failure still answers', async () => {
  assert.equal((await get(`https://deadhangs.com/plan/view/?t=${TOKEN}`, { ASSETS: assets })).status, 503);
  assert.equal((await get('https://deadhangs.com/plan/view/', { ASSETS: assets }, 'POST')).status, 405);
  const rows = new Map([[await hashToken(TOKEN), { status: 'paid', inputs: JSON.stringify(inputs(30)) }]]);
  const res = await get(`https://deadhangs.com/plan/view/?t=${TOKEN}`, { DB: mockDb(rows), ASSETS: { fetch: async () => { throw new Error('x'); } } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /noindex/);
});
