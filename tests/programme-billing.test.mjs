import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';
import { createBillingService, STRIPE_API_VERSION } from '../src/server/billing.mjs';
import { programmeDeletionStatements, exportProgramme, readProgress, writeProgress, saveInterest } from '../src/server/programme-store.mjs';

// Real Workers D1/SQLite via Miniflare; Stripe is simulated. Fixture values only, never real credentials.
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
const sql = (await Promise.all(['0002_billing.sql', '0003_plan_purchases.sql', '0005_programme.sql', '0007_programme_settle_seq.sql'].map((file) => fs.readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')))).join(' ').replace(/^--.*$/gm, '');
await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
test.after(() => mf.dispose());

const PREVIEW = 'https://preview.deadhangs-com-bew.pages.dev';
let serial = 0;
const nextId = () => `${Date.now().toString(36)}x${++serial}`;
function fixture(overrides = {}) {
  const env = { DB: db, BILLING_ENABLED: 'true', BILLING_LAUNCH_ENABLED: 'false', BILLING_MODE: 'test', AUTH_BASE_URL: PREVIEW,
    STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_PRODUCT_ID: 'prod_fixture', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_YEARLY_PRICE_ID: 'price_yearly', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
    PROGRAMME_LAUNCH_ENABLED: 'true', PROGRAMME_ALLOW_DRAFT: 'true', STRIPE_PROGRAMME_PRICE_ID: 'price_programme', ...overrides };
  const live = env.BILLING_MODE !== 'test';
  const state = { time: 1804636800, customers: new Map(), sessions: new Map(), intents: new Map(), disputes: [], subscriptions: [], calls: [] };
  const response = (value, status = 200) => Response.json(value, { status });
  async function fetcher(input, init = {}) {
    const url = new URL(input);
    assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    const method = init.method || 'GET';
    const form = Object.fromEntries(init.body || []);
    state.calls.push({ path: url.pathname, method, form });
    const path = url.pathname;
    let value;
    if (path === '/v1/account') value = { id: 'acct_fixture', charges_enabled: true };
    else if (path === '/v1/prices/price_programme') value = { id: 'price_programme', livemode: live, active: true, currency: 'gbp', unit_amount: 2900, type: 'one_time', product: { id: 'prod_programme', livemode: live, active: true, metadata: { app: 'deadhangs', product: 'programme_hang4' } } };
    else if (path === '/v1/customers' && method === 'POST') {
      value = { id: `cus_${nextId()}`, livemode: live, metadata: { app: form['metadata[app]'], deadhangs_user_ref: form['metadata[deadhangs_user_ref]'] } };
      state.customers.set(value.id, value);
    } else if (path.startsWith('/v1/customers/')) value = state.customers.get(path.split('/').at(-1));
    else if (path === '/v1/subscriptions') value = { data: state.subscriptions.filter((s) => s.customer === url.searchParams.get('customer')), has_more: false };
    else if (path === '/v1/checkout/sessions' && method === 'POST') {
      const metadata = Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
      value = { id: `cs_test_${nextId()}`, livemode: live, mode: form.mode, customer: form.customer, status: 'open', payment_status: 'unpaid', amount_total: 2900, currency: 'gbp', url: 'https://checkout.stripe.com/c/pay/fixture', metadata, payment_intent: null };
      state.sessions.set(value.id, value);
    } else if (path === '/v1/checkout/sessions') value = { data: [...state.sessions.values()].filter((s) => s.customer === url.searchParams.get('customer') && s.status === (url.searchParams.get('status') || s.status)), has_more: false };
    else if (path.startsWith('/v1/checkout/sessions/')) {
      const session = state.sessions.get(path.split('/')[4]);
      if (session && path.endsWith('/expire')) session.status = 'expired';
      if (session) {
        value = structuredClone(session);
        if (session.payment_intent && url.searchParams.getAll('expand[]').includes('payment_intent.latest_charge')) value.payment_intent = structuredClone(state.intents.get(session.payment_intent));
      }
    } else if (path === '/v1/disputes') value = { data: state.disputes.filter((d) => d.charge === url.searchParams.get('charge')), has_more: false };
    if (!value) return response({ error: 'fixture_object_missing' }, 404);
    return response(value);
  }
  const service = () => createBillingService(env, { now: () => state.time, fetch: fetcher });
  /** Simulates the buyer paying: session complete, intent succeeded, charge captured. */
  function pay(sessionId, { amount = 2900, charge = {} } = {}) {
    const session = state.sessions.get(sessionId);
    const intentId = `pi_${sessionId.split('_').at(-1)}`;
    state.intents.set(intentId, { id: intentId, livemode: live, customer: session.customer, status: 'succeeded', amount_received: amount,
      latest_charge: { id: `ch_${sessionId.split('_').at(-1)}`, livemode: live, paid: true, captured: true, customer: session.customer, payment_intent: intentId, amount, amount_refunded: 0, refunded: false, disputed: false, currency: 'gbp', ...charge } });
    Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: intentId, amount_total: amount });
    return intentId;
  }
  function signed(event) {
    const raw = JSON.stringify(event);
    const t = state.time;
    const sig = crypto.createHmac('sha256', 'whsec_fixture').update(`${t}.${raw}`).digest('hex');
    return new Request(`${PREVIEW}/api/billing/webhook`, { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } });
  }
  return { env, state, service, pay, signed };
}

test.beforeEach(async () => {
  await db.batch(['DELETE FROM billing_events', 'DELETE FROM programme_purchases', 'DELETE FROM programme_progress', 'DELETE FROM programme_interest', 'DELETE FROM billing_subscriptions', 'DELETE FROM billing_accounts', 'DELETE FROM "user"', 'INSERT INTO "user"(id) VALUES (\'alice\'),(\'bob\')'].map((s) => db.prepare(s)));
});

const purchaseRows = async () => (await db.prepare('SELECT * FROM programme_purchases ORDER BY created_at').all()).results;

test('live mode: the committed draft programme cannot be bought, even by a direct API call with the flag on', async () => {
  const f = fixture({ BILLING_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture', AUTH_BASE_URL: 'https://deadhangs.com', PROGRAMME_ALLOW_DRAFT: 'true' });
  await assert.rejects(f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page'), { code: 'programme_not_on_sale', status: 403 });
  assert.equal(f.state.calls.length, 0, 'no provider call is made');
  await assert.rejects(f.service().checkoutProgramme({ id: 'alice' }, 'not-a-programme', 'x'), { code: 'invalid_programme' });
  assert.equal((await purchaseRows()).length, 0);
});

test('test-mode checkout is a one-off payment, records a pending row and reuses an open session instead of creating another', async () => {
  const f = fixture();
  const first = await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  assert.match(first.url, /^https:\/\/checkout\.stripe\.com\//);
  const create = f.state.calls.find((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST');
  assert.equal(create.form.mode, 'payment');
  assert.equal(create.form['line_items[0][price]'], 'price_programme');
  assert.equal(create.form['metadata[product]'], 'programme_hang4');
  assert.equal(create.form['metadata[programme_id]'], 'hang4');
  assert.equal(Object.keys(create.form).some((k) => k.includes('subscription')), false, 'never a subscription');
  assert.match(create.form.success_url, /\/programme\/app\/\?purchase=complete&session_id=\{CHECKOUT_SESSION_ID\}$/);
  const [row] = await purchaseRows();
  assert.equal(row.status, 'pending');
  assert.equal(row.provider_mode, 'test');
  assert.equal(row.amount, 2900);
  assert.equal(row.user_id, 'alice');
  const again = await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  assert.equal(again.url, first.url);
  assert.equal(f.state.calls.filter((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST').length, 1);
  assert.deepEqual(await f.service().programmeAccess('alice', 'hang4'), { active: false, status: 'pending' });
  const account = await db.prepare('SELECT checkout_session_id FROM billing_accounts WHERE user_id = ?').bind('alice').first();
  assert.equal(account.checkout_session_id, null, 'Pro checkout state is untouched');
});

test('the success redirect grants nothing until Stripe says paid; then only the owner can settle it', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  const [row] = await purchaseRows();
  assert.deepEqual(await f.service().settleProgrammeForUser('alice', row.checkout_session_id), { status: 'pending' });
  assert.equal((await f.service().programmeAccess('alice', 'hang4')).active, false);
  f.pay(row.checkout_session_id);
  await assert.rejects(f.service().settleProgrammeForUser('bob', row.checkout_session_id), { code: 'billing_ownership_mismatch', status: 403 });
  assert.deepEqual(await f.service().settleProgrammeForUser('alice', row.checkout_session_id), { status: 'paid' });
  const access = await f.service().programmeAccess('alice', 'hang4');
  assert.equal(access.active, true);
  assert.equal(access.version, '0.1.0');
  assert.equal((await f.service().programmeAccess('bob', 'hang4')).active, false);
  assert.equal((await f.service().getEntitlement('alice')).active, false, 'a programme purchase never grants Pro');
  await assert.rejects(f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page'), { code: 'programme_owned', status: 409 });
});

test('signed webhooks settle once, duplicates are ignored, and an underpaid session is refused', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  const [row] = await purchaseRows();
  f.pay(row.checkout_session_id);
  const event = { id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: row.checkout_session_id, mode: 'payment', metadata: { app: 'deadhangs', product: 'programme_hang4', programme_id: 'hang4' } } } };
  assert.deepEqual(await f.service().webhook(f.signed(event)), { received: true });
  assert.deepEqual(await f.service().webhook(f.signed(event)), { received: true, duplicate: true });
  assert.equal((await purchaseRows())[0].status, 'paid');
  const bad = new Request(`${PREVIEW}/api/billing/webhook`, { method: 'POST', body: JSON.stringify(event), headers: { 'stripe-signature': `t=${f.state.time},v1=${'0'.repeat(64)}` } });
  await assert.rejects(f.service().webhook(bad), { code: 'invalid_signature' });
  const g = fixture();
  await g.service().checkoutProgramme({ id: 'bob' }, 'hang4', 'programme_page');
  const bobRow = (await purchaseRows()).find((r) => r.user_id === 'bob');
  g.pay(bobRow.checkout_session_id, { amount: 100 });
  await assert.rejects(g.service().settleProgrammeForUser('bob', bobRow.checkout_session_id), { code: 'billing_ownership_mismatch' });
  assert.equal((await g.service().programmeAccess('bob', 'hang4')).active, false);
});

test('refund and dispute follow current Stripe state in any event order; a partial refund keeps access', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  const [row] = await purchaseRows();
  const intent = f.pay(row.checkout_session_id);
  await f.service().settleProgrammeForUser('alice', row.checkout_session_id);
  const charge = f.state.intents.get(intent).latest_charge;
  charge.amount_refunded = 900;
  const refundEvent = (id) => ({ id, type: 'charge.refunded', livemode: false, data: { object: { id: charge.id, payment_intent: intent, customer: charge.customer } } });
  await f.service().webhook(f.signed(refundEvent('evt_partial')));
  assert.equal((await f.service().programmeAccess('alice', 'hang4')).active, true);
  charge.disputed = true;
  f.state.disputes.push({ id: 'dp_1', charge: charge.id, livemode: false, status: 'needs_response' });
  await f.service().webhook(f.signed({ id: 'evt_dispute', type: 'charge.dispute.created', livemode: false, data: { object: { id: 'dp_1', charge: charge.id, payment_intent: intent } } }));
  assert.deepEqual(await f.service().programmeAccess('alice', 'hang4'), { active: false, status: 'disputed' });
  f.state.disputes[0].status = 'won';
  await f.service().webhook(f.signed({ id: 'evt_won', type: 'charge.dispute.closed', livemode: false, data: { object: { id: 'dp_1', charge: charge.id, payment_intent: intent } } }));
  assert.equal((await f.service().programmeAccess('alice', 'hang4')).active, true);
  charge.amount_refunded = 2900; charge.refunded = true;
  await f.service().webhook(f.signed(refundEvent('evt_full')));
  assert.deepEqual(await f.service().programmeAccess('alice', 'hang4'), { active: false, status: 'refunded' });
  // A stale completed event arriving after the refund cannot restore access.
  await f.service().webhook(f.signed({ id: 'evt_late', type: 'checkout.session.completed', livemode: false, data: { object: { id: row.checkout_session_id, mode: 'payment', metadata: { app: 'deadhangs', product: 'programme_hang4', programme_id: 'hang4' } } } }));
  assert.equal((await f.service().programmeAccess('alice', 'hang4')).status, 'refunded');
  // After a refund the person may buy again.
  const repurchase = await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  assert.match(repurchase.url, /checkout\.stripe\.com/);
});

test('a lost checkout response is recovered from the verified session; test purchases never unlock live mode', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  const [row] = await purchaseRows();
  await db.prepare('DELETE FROM programme_purchases').run();
  f.pay(row.checkout_session_id);
  assert.deepEqual(await f.service().settleProgrammeForUser('alice', row.checkout_session_id), { status: 'paid' });
  assert.equal((await purchaseRows())[0].user_id, 'alice');
  const live = fixture({ BILLING_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture', AUTH_BASE_URL: 'https://deadhangs.com' });
  assert.deepEqual(await live.service().programmeAccess('alice', 'hang4'), { active: false, status: 'none' });
});

test('expired and failed checkouts never block a new purchase', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  const [row] = await purchaseRows();
  f.state.sessions.get(row.checkout_session_id).status = 'expired';
  const next = await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  assert.match(next.url, /checkout\.stripe\.com/);
  const rows = await purchaseRows();
  assert.deepEqual(rows.map((r) => r.status), ['expired', 'pending']);
});

test('account deletion expires an open programme checkout, deletes progress and keeps a detached payment record', async () => {
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  await writeProgress(db, 'alice', 'hang4', 0, { v: 1, route: 'standard', results: [] });
  await f.service().prepareDeletion('alice');
  const [row] = await purchaseRows();
  assert.equal(f.state.sessions.get(row.checkout_session_id).status, 'expired');
  await db.batch([...(await programmeDeletionStatements(db, 'alice')), db.prepare('DELETE FROM "user" WHERE id = ?').bind('alice')]);
  assert.equal((await purchaseRows())[0].user_id, null);
  assert.equal((await readProgress(db, 'alice', 'hang4')).state, null);
  await assert.rejects(f.service().checkoutProgramme({ id: 'bob' }, 'hang4', 'programme_page').then(() => f.service().prepareDeletion('bob')).then(() => f.service().checkoutProgramme({ id: 'bob' }, 'hang4', 'x')), { code: 'account_deleting' });
});

test('progress writes are revision-checked; export lists progress and settled purchases only', async () => {
  const first = await writeProgress(db, 'alice', 'hang4', 0, { v: 1, route: 'standard', results: [], status: 'active', reminders: { enabled: true } });
  assert.deepEqual(first, { ok: true, revision: 1 });
  assert.deepEqual(await writeProgress(db, 'alice', 'hang4', 0, { v: 1, route: 'standard', results: [] }), { ok: false, revision: 1 });
  assert.deepEqual(await writeProgress(db, 'alice', 'hang4', 1, { v: 1, route: 'standard', results: [], status: 'paused', reminders: { enabled: true } }), { ok: true, revision: 2 });
  const row = await db.prepare('SELECT reminder_enabled FROM programme_progress WHERE user_id = ?').bind('alice').first();
  assert.equal(row.reminder_enabled, 0, 'paused programmes are never reminded');
  const f = fixture();
  await f.service().checkoutProgramme({ id: 'alice' }, 'hang4', 'programme_page');
  let exported = await exportProgramme(db, 'alice');
  assert.equal(exported.progress.length, 1);
  assert.equal(exported.purchases.length, 0, 'pending checkouts are not purchases');
  const [p] = await purchaseRows();
  f.pay(p.checkout_session_id);
  await f.service().settleProgrammeForUser('alice', p.checkout_session_id);
  exported = await exportProgramme(db, 'alice');
  assert.deepEqual(Object.keys(exported.purchases[0]).sort(), ['amount', 'createdAt', 'currency', 'paidAt', 'programmeId', 'status', 'version']);
});

test('interest signups are saved once, lowercased, and reported only after the write', async () => {
  assert.deepEqual(await saveInterest(db, { email: 'Someone@Example.com ', programmeId: 'hang4', source: 'programme_page' }), { saved: true });
  assert.deepEqual(await saveInterest(db, { email: 'someone@example.com', programmeId: 'hang4', source: 'programme_page' }), { saved: true }, 'never reveals that the address was already listed');
  await assert.rejects(saveInterest(db, { email: 'not-an-email', programmeId: 'hang4', source: 'x' }), { code: 'invalid_email' });
  const rows = (await db.prepare('SELECT email, consent_version FROM programme_interest').all()).results;
  assert.deepEqual(rows, [{ email: 'someone@example.com', consent_version: 'programme-interest-v1' }]);
});

test('before migration 0005 the programme fails honestly and account deletion still works', async () => {
  const mf2 = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
  try {
    const old = await mf2.getD1Database('DB');
    await old.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
    const base = (await fs.readFile(new URL('../migrations/0002_billing.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    await old.batch(base.split(';').map((s) => s.trim()).filter(Boolean).map((s) => old.prepare(s)));
    await old.prepare('INSERT INTO "user"(id) VALUES (\'carol\')').run();
    const f = fixture({ DB: old });
    await assert.rejects(f.service().programmeAccess('carol', 'hang4'), { code: 'programme_unavailable', status: 503 });
    await assert.rejects(readProgress(old, 'carol', 'hang4'), { code: 'programme_unavailable' });
    assert.deepEqual(await programmeDeletionStatements(old, 'carol'), []);
    await f.service().prepareDeletion('carol');
    assert.deepEqual(await exportProgramme(old, 'carol'), { progress: [], purchases: [] });
  } finally { await mf2.dispose(); }
});
