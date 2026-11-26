// Regression tests for the independent backend review of 26 Nov 2026 (findings M1 to M5 and selected lows).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { createBillingService, STRIPE_API_VERSION } from '../src/server/billing.mjs';
import { applyOperation, nextStep, ProgrammeError } from '../src/lib/programme-engine.mjs';
import { writeProgress, readProgress } from '../src/server/programme-store.mjs';
import { turnRemindersOff, readReminderOff, reminderOffUrl } from '../src/server/programme-reminders.mjs';
import { createCampaign, joinCampaign, addResult, campaignView, leaveCampaign, organiserAction } from '../src/server/gym-store.mjs';

const rules = JSON.parse(await fs.readFile(new URL('../src/data/plan-rules.json', import.meta.url), 'utf8'));
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
const files = ['0002_billing.sql', '0005_programme.sql', '0006_gym_pilot.sql', '0007_programme_settle_seq.sql'];
const sql = (await Promise.all(files.map((f) => fs.readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8')))).join(';\n').replace(/^--.*$/gm, '');
await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
test.after(() => mf.dispose());
const code = (fn) => { try { fn(); } catch (error) { return error.code; } return null; };
const acode = async (p) => { try { await p; } catch (error) { return error.code; } return null; };

test('M1: a slow settlement that read "paid" cannot overwrite a refund written while it waited', async () => {
  await db.batch(['DELETE FROM programme_purchases', 'DELETE FROM billing_accounts', 'DELETE FROM "user"', `INSERT INTO "user"(id) VALUES ('alice')`].map((s) => db.prepare(s)));
  const env = { DB: db, BILLING_ENABLED: 'true', BILLING_MODE: 'test', AUTH_BASE_URL: 'https://preview.deadhangs-com-bew.pages.dev', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_ACCOUNT_ID: 'acct_fixture', STRIPE_PRODUCT_ID: 'prod_fixture', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_YEARLY_PRICE_ID: 'price_yearly', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
    PROGRAMME_LAUNCH_ENABLED: 'true', PROGRAMME_ALLOW_DRAFT: 'true', STRIPE_PROGRAMME_PRICE_ID: 'price_programme' };
  const charge = { id: 'ch_1', livemode: false, paid: true, customer: 'cus_1', payment_intent: 'pi_1', amount: 2900, amount_refunded: 0, refunded: false, disputed: false };
  const session = { id: 'cs_test_1', livemode: false, mode: 'payment', customer: 'cus_1', status: 'complete', payment_status: 'paid', amount_total: 2900, currency: 'gbp', url: 'https://checkout.stripe.com/x',
    metadata: { app: 'deadhangs', product: 'programme_hang4', programme_id: 'hang4', programme_version: '0.1.0', deadhangs_user_ref: 'ref_a' }, payment_intent: 'pi_1' };
  let hold = null;
  const fetcher = async (input, init = {}) => {
    assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    const url = new URL(input);
    if (url.pathname === '/v1/checkout/sessions/cs_test_1') {
      const snapshot = { ...structuredClone(session), payment_intent: { id: 'pi_1', livemode: false, customer: 'cus_1', status: 'succeeded', amount_received: 2900, latest_charge: structuredClone(charge) } };
      if (hold) { const wait = hold; hold = null; await wait; }
      return Response.json(snapshot);
    }
    return Response.json({ error: 'missing' }, { status: 404 });
  };
  await db.prepare("INSERT INTO billing_accounts (user_id, app_user_ref, stripe_customer_id, provider_mode, created_at) VALUES ('alice','ref_a','cus_1','test',0)").run();
  await db.prepare(`INSERT INTO programme_purchases (checkout_session_id,user_id,programme_id,programme_version,provider_mode,stripe_customer_id,amount,currency,status,source,created_at,status_changed_at)
    VALUES ('cs_test_1','alice','hang4','0.1.0','test','cus_1',2900,'gbp','pending','x',0,0)`).run();
  const service = createBillingService(env, { now: () => 1804636800, fetch: fetcher });
  let release;
  hold = new Promise((resolve) => { release = resolve; });
  const slow = service.settleProgrammeForUser('alice', 'cs_test_1'); // reads "paid", then waits
  await new Promise((r) => setTimeout(r, 20));
  Object.assign(charge, { amount_refunded: 2900, refunded: true });
  assert.deepEqual(await service.settleProgrammeForUser('alice', 'cs_test_1'), { status: 'refunded' });
  release();
  assert.deepEqual(await slow, { status: 'refunded' }, 'the stale settlement retried and saw the refund');
  assert.equal((await db.prepare('SELECT status FROM programme_purchases').first()).status, 'refunded');
  assert.equal((await service.programmeAccess('alice', 'hang4')).active, false);
});

test('M2: discarding an older result from a repeated week after finishing does not trap the person', () => {
  const now = 'now';
  const setup = {};
  let s = applyOperation(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, setup, localDate: '2026-11-02' }, rules, now).state;
  let n = 0;
  const rec = () => { const step = nextStep(s, rules); s = applyOperation(s, { op: 'record', id: `id-${String(++n).padStart(6, '0')}`, sessionKey: step.session.key, sets: Array(step.session.sets).fill(10), setup, localDate: '2026-11-03' }, rules, now).state; };
  for (let i = 0; i < 3; i += 1) rec();
  s = applyOperation(s, { op: 'review', week: 1, decision: 'repeat' }, rules, now).state;
  for (const week of [1, 2, 3]) { for (let i = 0; i < 3; i += 1) rec(); s = applyOperation(s, { op: 'review', week, decision: 'continue' }, rules, now).state; }
  rec(); rec(); rec();
  assert.equal(s.status, 'completed');
  s = applyOperation(s, { op: 'discard', id: 'id-000001' }, rules, now).state; // a cycle-0 week 1 result
  assert.equal(s.status, 'completed', 'still finished: the finish never depended on that result');
  const again = applyOperation(s, { op: 'enrol', route: 'standard', baselineSeconds: 12, setup, localDate: '2026-12-01' }, rules, now).state;
  assert.equal(again.history.length, 1, 'a new run can start');
  const last = s.results.at(-1).id;
  const reopened = applyOperation(s, { op: 'discard', id: last }, rules, now).state;
  assert.equal(reopened.status, 'active');
  assert.equal(nextStep(reopened, rules).session.key, 'w4s3');
});

test('L1 and L2: retries of a saved result are no-ops after finishing; crafted op names are a 400, never a crash', () => {
  let s = applyOperation(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, setup: {}, localDate: '2026-11-02' }, rules, 'now').state;
  const op = { op: 'record', id: 'retry-000001', sessionKey: 'w1s1', sets: [10, 10, 10], setup: {}, localDate: '2026-11-03' };
  s = applyOperation(s, op, rules, 'now').state;
  s = applyOperation(s, { op: 'pause' }, rules, 'now').state;
  assert.equal(applyOperation(s, op, rules, 'now').changed, false);
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    let error;
    try { applyOperation(s, { op: name }, rules, 'now'); } catch (e) { error = e; }
    assert.ok(error instanceof ProgrammeError, name);
    assert.equal(error.code, 'invalid_operation');
  }
});

test('M5: turning reminders off never loses a progress save and moves the revision on', async () => {
  await db.batch(['DELETE FROM programme_progress', 'DELETE FROM "user"', `INSERT INTO "user"(id) VALUES ('rita')`].map((s) => db.prepare(s)));
  let state = applyOperation(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, setup: {}, localDate: '2026-11-02' }, rules, 'now').state;
  state = applyOperation(state, { op: 'reminders', reminders: { enabled: true, days: ['mon'], localTime: '18:00', timezone: 'Europe/London' } }, rules, 'now').state;
  await writeProgress(db, 'rita', 'hang4', 0, state);
  const saved = applyOperation(state, { op: 'record', id: 'rita-000001', sessionKey: 'w1s1', sets: [10, 10, 10], setup: {}, localDate: '2026-11-03' }, rules, 'now').state;
  assert.equal((await writeProgress(db, 'rita', 'hang4', 1, saved)).ok, true);
  await turnRemindersOff(db, 'rita');
  const after = await readProgress(db, 'rita', 'hang4');
  assert.equal(after.state.results.length, 1, 'the session saved just before is still there');
  assert.equal(after.state.reminders.enabled, false);
  assert.equal(after.revision, 3);
  assert.equal((await writeProgress(db, 'rita', 'hang4', 2, saved)).ok, false, 'a device holding the old revision must re-read');
  const env = { UNSUB_SECRET: 'z'.repeat(40), AUTH_BASE_URL: 'https://deadhangs.com' };
  const url = new URL(await reminderOffUrl(env, 'rita'));
  assert.equal(await readReminderOff(env, url.searchParams.get('u'), url.searchParams.get('s')), 'rita');
  assert.equal(await readReminderOff(env, url.searchParams.get('u'), 'not!base64'), null);
});

test('M3 and L10: leavers vanish from the organiser view and cannot be edited; a double join spends one invite use', async () => {
  await db.batch(['DELETE FROM gym_results', 'DELETE FROM gym_members', 'DELETE FROM gym_invites', 'DELETE FROM gym_campaigns', 'DELETE FROM "user"', `INSERT INTO "user"(id) VALUES ('org'),('leaver'),('twice')`].map((s) => db.prepare(s)));
  const now = Math.floor(Date.parse('2026-12-02T10:00:00Z') / 1000);
  const c = await createCampaign(db, { gymName: 'Synthetic Gym', title: 'Hang', startsOn: '2026-12-01', endsOn: '2026-12-31', rule: { bar: 'b', grip: 'g', chalk: 'c' } }, now);
  await joinCampaign(db, 'org', { token: c.organiserToken, displayName: 'Org', shareConsent: true }, now);
  const invite = (await organiserAction(db, 'org', { campaignId: c.campaignId, op: 'invite' }, now)).token;
  await joinCampaign(db, 'leaver', { token: invite, displayName: 'Leaver Name', shareConsent: true }, now);
  await addResult(db, 'leaver', { campaignId: c.campaignId, id: 'leaver-result-1', seconds: 42, localDate: '2026-12-02', ruleConfirmed: true }, now);
  await leaveCampaign(db, 'leaver', c.campaignId, now);
  const view = await campaignView(db, 'org', c.campaignId);
  assert.equal(JSON.stringify(view.manage).includes('Leaver Name'), false);
  assert.equal(await acode(organiserAction(db, 'org', { campaignId: c.campaignId, op: 'correct', resultId: 'leaver-result-1', seconds: 1, note: 'x' }, now)), 'not_found');
  const first = await joinCampaign(db, 'twice', { token: invite, displayName: 'Twice', shareConsent: true }, now);
  const second = await joinCampaign(db, 'twice', { token: invite, displayName: 'Twice', shareConsent: true }, now);
  assert.equal(first.already, false);
  assert.equal(second.already, true);
  const uses = (await db.prepare("SELECT uses FROM gym_invites WHERE role = 'participant'").first()).uses;
  assert.equal(uses, 2, 'leaver and twice: one use each, the repeat join spent nothing');
});
