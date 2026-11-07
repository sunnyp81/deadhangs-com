import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { billingConfigured, createBillingService, verifyStripeSignature, readBoundedBody, STRIPE_API_VERSION } from '../src/server/billing.mjs';

// Real Workers D1/SQLite constraints and atomic batches; Stripe alone is simulated.
// These are fixture secrets, never credentials or requests to a real merchant.
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
const sql = (await fs.readFile(new URL('../migrations/0002_billing.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
test.after(() => mf.dispose());
let f;
test.beforeEach(async () => {
  await db.batch(['DELETE FROM billing_events', 'DELETE FROM "user"', 'INSERT INTO "user"(id) VALUES (\'alice\'),(\'bob\')'].map((s) => db.prepare(s)));
  f = fixture();
});

function fixture(overrides = {}) {
  const env = { DB: db, BILLING_ENABLED: 'true', BILLING_LAUNCH_ENABLED: 'true', AUTH_BASE_URL: 'https://deadhangs.com',
    STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_PRODUCT_ID: 'prod_fixture', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_YEARLY_PRICE_ID: 'price_yearly', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture', ...overrides };
  const live = env.BILLING_MODE !== 'test';
  const state = { time: 1804636800, chargesEnabled: true, customers: new Map(), sessions: new Map(), subscriptions: new Map(), invoices: new Map(), payments: new Map(), intents: new Map(), disputes: [], calls: [], keys: new Map(), fail: null, before: null, after: null };
  const price = (plan = 'monthly') => ({ id: `price_${plan}`, product: 'prod_fixture', livemode: live, active: true, currency: 'gbp', unit_amount: plan === 'monthly' ? 499 : 3900, type: 'recurring', recurring: { interval: plan === 'monthly' ? 'month' : 'year', interval_count: 1 } });
  const response = (value, status = 200) => Response.json(value, { status });
  async function fetcher(input, init = {}) {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.stripe.com');
    assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    const method = init.method || 'GET';
    const form = Object.fromEntries(init.body || []);
    const key = init.headers['Idempotency-Key'];
    const call = { path: url.pathname, search: url.searchParams, method, form, key };
    state.calls.push(call);
    if (state.before) await state.before(call);
    if (state.fail?.(call)) return response({ error: { message: 'fixture failure' } }, 503);
    if (key && state.keys.has(key)) {
      const stored = state.keys.get(key);
      assert.deepEqual(form, stored.form, 'provider idempotency parameters stay stable');
      return response(stored.value);
    }
    let value;
    const path = url.pathname;
    if (path === '/v1/account') value = { id: env.STRIPE_ACCOUNT_ID, charges_enabled: state.chargesEnabled };
    else if (path.startsWith('/v1/prices/')) value = price(path.endsWith('yearly') ? 'yearly' : 'monthly');
    else if (path === '/v1/products/prod_fixture') value = { id: 'prod_fixture', active: true, livemode: live, metadata: { app: 'deadhangs' } };
    else if (path === '/v1/customers' && method === 'POST') {
      value = { id: `cus_${state.customers.size + 1}`, livemode: live, metadata: { app: form['metadata[app]'], deadhangs_user_ref: form['metadata[deadhangs_user_ref]'] } };
      state.customers.set(value.id, value);
    } else if (path.startsWith('/v1/customers/')) value = state.customers.get(path.split('/').at(-1));
    else if (path === '/v1/subscriptions') value = { data: [...state.subscriptions.values()].filter((s) => s.customer === url.searchParams.get('customer')), has_more: false };
    else if (path.startsWith('/v1/subscriptions/')) {
      value = state.subscriptions.get(path.split('/').at(-1));
      if (method === 'DELETE' && value) value.status = 'canceled';
    } else if (path === '/v1/checkout/sessions' && method === 'POST') {
      value = { id: `cs_${live ? 'live' : 'test'}_${state.sessions.size + 1}`, livemode: live, mode: form.mode, customer: form.customer, status: 'open', url: 'https://checkout.stripe.com/c/pay/fixture', metadata: { app: form['metadata[app]'], deadhangs_user_ref: form['metadata[deadhangs_user_ref]'] } };
      state.sessions.set(value.id, value);
    } else if (path.startsWith('/v1/checkout/sessions/')) {
      const id = path.split('/')[4];
      value = state.sessions.get(id);
      if (path.endsWith('/expire') && value) value.status = 'expired';
    } else if (path.startsWith('/v1/invoices/')) value = state.invoices.get(path.split('/').at(-1));
    else if (path === '/v1/invoice_payments') value = { data: state.payments.get(url.searchParams.get('invoice')) || [], has_more: false };
    else if (path.startsWith('/v1/payment_intents/')) value = state.intents.get(path.split('/').at(-1));
    else if (path === '/v1/disputes') value = { data: state.disputes, has_more: false };
    else if (path.startsWith('/v1/charges/')) value = [...state.intents.values()].find((pi) => pi.latest_charge.id === path.split('/').at(-1))?.latest_charge;
    else if (path === '/v1/billing_portal/configurations/bpc_fixture') value = { id: 'bpc_fixture', active: true, livemode: live, metadata: { app: 'deadhangs' }, features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end' } } };
    else if (path === '/v1/billing_portal/sessions') value = { id: 'bps_fixture', customer: form.customer, livemode: live, url: 'https://billing.stripe.com/p/session/fixture' };
    if (!value) return response({ error: 'fixture_object_missing' }, 404);
    if (key) state.keys.set(key, { form, value: structuredClone(value) });
    if (state.after) await state.after(call, value);
    return response(value);
  }
  const service = () => createBillingService(env, { now: () => state.time, fetch: fetcher });
  async function identity(user = 'alice') {
    await service().checkout({ id: user, email: `${user}@example.test` }, 'monthly');
    return db.prepare('SELECT * FROM billing_accounts WHERE user_id=?').bind(user).first();
  }
  async function paid(user = 'alice', suffix = '1') {
    const row = await identity(user);
    const sub = { id: `sub_${suffix}`, livemode: live, customer: row.stripe_customer_id, metadata: { app: 'deadhangs', deadhangs_user_ref: row.app_user_ref }, status: 'active', cancel_at_period_end: false, latest_invoice: `in_${suffix}`, items: { data: [{ price: price(), quantity: 1, current_period_start: state.time - 100, current_period_end: state.time + 86400 }], has_more: false } };
    const invoice = { id: `in_${suffix}`, livemode: live, customer: row.stripe_customer_id, status: 'paid', amount_paid: 499, amount_remaining: 0, currency: 'gbp', parent: { subscription_details: { subscription: sub.id } }, lines: { has_more: false, data: [{ pricing: { price_details: { price: 'price_monthly' } }, period: { start: state.time - 100, end: state.time + 86400 } }] } };
    const payment = { id: `inpay_${suffix}`, livemode: live, status: 'paid', amount_paid: 499, invoice: invoice.id, payment: { type: 'payment_intent', payment_intent: `pi_${suffix}` } };
    const intent = { id: `pi_${suffix}`, livemode: live, customer: row.stripe_customer_id, status: 'succeeded', amount_received: 499, currency: 'gbp', latest_charge: { id: `ch_${suffix}`, livemode: live, customer: row.stripe_customer_id, paid: true, captured: true, currency: 'gbp', amount: 499, amount_refunded: 0, refunded: false, disputed: false } };
    state.subscriptions.set(sub.id, sub); state.invoices.set(invoice.id, invoice); state.payments.set(invoice.id, [payment]); state.intents.set(intent.id, intent);
    const session = state.sessions.get(row.checkout_session_id); session.status = 'complete'; session.subscription = sub.id;
    return { row, sub, invoice, payment, intent, charge: intent.latest_charge, session };
  }
  async function event(type, customer, extra = {}) {
    const event = { id: `evt_${Math.random().toString(36).slice(2)}`, type, livemode: live, data: { object: { customer } }, ...extra };
    const raw = JSON.stringify(event);
    return new Request(`${env.AUTH_BASE_URL}/api/billing/webhook`, { method: 'POST', headers: { 'Stripe-Signature': await signature(raw, state.time, env.STRIPE_WEBHOOK_SECRET) }, body: raw });
  }
  return { env, state, service, identity, paid, event, price };
}

async function signature(raw, timestamp, secret = 'whsec_fixture') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`));
  return `t=${timestamp},v1=${Buffer.from(sig).toString('hex')}`;
}
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('signature validates exact raw bytes, rotation and timestamp tolerance; rejects tamper/replay/future', async () => {
  const raw = '{"amount":499}'; const now = f.state.time; const header = await signature(raw, now);
  assert.equal(await verifyStripeSignature(raw, header, 'whsec_fixture', now), true);
  assert.equal(await verifyStripeSignature(raw + ' ', header, 'whsec_fixture', now), false);
  assert.equal(await verifyStripeSignature(raw, header, 'whsec_wrong', now), false);
  assert.equal(await verifyStripeSignature(raw, await signature(raw, now - 301), 'whsec_fixture', now), false);
  assert.equal(await verifyStripeSignature(raw, await signature(raw, now + 61), 'whsec_fixture', now), false);
  assert.equal(await verifyStripeSignature(raw, `v1=${'0'.repeat(64)},${header}`, 'whsec_fixture', now), true);
  assert.equal(await verifyStripeSignature(raw, `${header},t=${now}`, 'whsec_fixture', now), false);
});

test('body cap enforces streamed bytes and content-length without trusting JSON parsing', async () => {
  await rejectsCode(readBoundedBody(new Request('https://fixture.test', { method: 'POST', body: '12345' }), 4), 'payload_too_large');
  await rejectsCode(readBoundedBody(new Request('https://fixture.test', { method: 'POST', headers: { 'content-length': '99' }, body: '1' }), 4), 'payload_too_large');
});

test('config fails closed, preview test mode is isolated, and launch gate causes zero provider work', async () => {
  assert.equal(billingConfigured(f.env), true);
  assert.equal(billingConfigured({ ...f.env, BILLING_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture' }), false);
  assert.equal(billingConfigured({ ...f.env, AUTH_BASE_URL: 'https://preview.example.test', BILLING_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture' }), true);
  assert.equal(billingConfigured({ ...f.env, STRIPE_SECRET_KEY: '' }), false);
  f.env.BILLING_LAUNCH_ENABLED = 'false';
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'billing_not_launched');
  assert.equal(f.state.calls.length, 0);
});

test('checkout uses fixed server price, dedicated metadata, explicit consent; duplicate calls reuse customer/session', async () => {
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'client-price'), 'invalid_plan');
  const first = await f.service().checkout({ id: 'alice', email: 'alice@example.test' }, 'monthly');
  const second = await f.service().checkout({ id: 'alice', email: 'changed@example.test' }, 'monthly');
  assert.deepEqual(first, second);
  assert.equal(f.state.customers.size, 1); assert.equal(f.state.sessions.size, 1);
  const call = f.state.calls.find((c) => c.path === '/v1/checkout/sessions' && c.method === 'POST');
  assert.equal(call.form['line_items[0][price]'], 'price_monthly');
  assert.equal(call.form.mode, 'subscription'); assert.equal(call.form.allow_promotion_codes, 'false');
  assert.equal(call.form['subscription_data[metadata][app]'], 'deadhangs');
  assert.equal(call.form['subscription_data[metadata][userId]'], undefined);
  assert.equal(call.form['consent_collection[terms_of_service]'], 'required');
  assert.match(call.form['custom_text[terms_of_service_acceptance][message]'], /https:\/\/deadhangs.com\/terms\//);
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'yearly'), 'checkout_in_progress');
});

test('concurrent first checkouts serialize on D1 and cannot create two customers', async () => {
  let release; let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  f.state.before = async (call) => { if (call.path === '/v1/customers' && call.method === 'POST') { entered(); await blocked; } };
  const first = f.service().checkout({ id: 'alice' }, 'monthly');
  await waiting;
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'billing_busy');
  release(); await first;
  assert.equal(f.state.customers.size, 1);
});

test('lost customer response retries the same key; unresolved old creation refuses duplicates', async () => {
  let once = true;
  f.state.after = (call) => { if (call.path === '/v1/customers' && once) { once = false; throw new Error('response lost after creation'); } };
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'billing_provider_unavailable');
  await f.service().checkout({ id: 'alice' }, 'monthly');
  const keys = f.state.calls.filter((c) => c.path === '/v1/customers').map((c) => c.key);
  assert.equal(keys[0], keys[1]);
  await db.prepare('UPDATE billing_accounts SET stripe_customer_id=NULL,customer_started_at=? WHERE user_id=?').bind(f.state.time - 86400, 'alice').run();
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'billing_recovery_required');
  assert.equal(f.state.customers.size, 1);
});

test('lost Checkout response retries the same provider key without creating duplicate subscriptions', async () => {
  let once = true;
  f.state.after = (call) => { if (call.path === '/v1/checkout/sessions' && once) { once = false; throw new Error('response lost after creation'); } };
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'billing_provider_unavailable');
  assert.equal(f.state.sessions.size, 1);
  await f.service().checkout({ id: 'alice' }, 'monthly');
  assert.equal(f.state.sessions.size, 1); assert.equal(f.state.customers.size, 1);
  const calls = f.state.calls.filter((c) => c.path === '/v1/checkout/sessions');
  assert.equal(calls[0].key, calls[1].key);
});

test('only verified paid active subscriptions grant Pro, cached term expires locally', async () => {
  const { sub } = await f.paid();
  const active = await f.service().getEntitlement('alice', { refresh: true });
  assert.equal(active.active, true); assert.equal(active.plan, 'pro');
  sub.cancel_at_period_end = true;
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).cancelAtPeriodEnd, true);
  f.state.time += 86401;
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
});

test('trial, unpaid, failed renewal, pause and refund do not grant paid rights; partial goodwill refund retains term', async () => {
  const p = await f.paid();
  for (const status of ['trialing', 'incomplete', 'past_due', 'unpaid', 'canceled']) {
    p.sub.status = status;
    assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false, status);
  }
  p.sub.status = 'active'; p.invoice.status = 'open';
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
  p.invoice.status = 'paid'; p.charge.amount_refunded = 499; p.charge.refunded = true;
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
  p.charge.amount_refunded = 100; p.charge.refunded = false;
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, true);
  p.sub.pause_collection = { behavior: 'void' };
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
});

test('open dispute revokes, won dispute restores; wrong invoice customer or unpaid out-of-band does not grant', async () => {
  const p = await f.paid(); p.charge.disputed = true;
  f.state.disputes = [{ livemode: true, charge: p.charge.id, status: 'needs_response' }];
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
  f.state.disputes[0].status = 'won';
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, true);
  p.invoice.customer = 'cus_other';
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
  p.invoice.customer = p.row.stripe_customer_id; p.invoice.paid_out_of_band = true;
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
});

test('webhook re-fetches latest state, ignores out-of-order snapshot, and idempotently handles retry', async () => {
  const p = await f.paid();
  await f.service().getEntitlement('alice', { refresh: true });
  p.sub.status = 'canceled';
  const request = await f.event('customer.subscription.updated', p.row.stripe_customer_id, { id: 'evt_repeat', created: f.state.time - 5000, data: { object: { ...p.sub, status: 'active' } } });
  assert.deepEqual(await f.service().webhook(request.clone()), { received: true });
  assert.equal((await f.service().getEntitlement('alice')).active, false);
  const count = f.state.calls.length;
  assert.equal((await f.service().webhook(request)).duplicate, true);
  assert.equal(f.state.calls.length, count);
});

test('foreign account/events/customer cannot grant, and signed snapshot metadata never bypasses ownership', async () => {
  const p = await f.paid();
  const before = f.state.calls.length;
  assert.equal((await f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id, { account: 'acct_other' }))).ignored, true);
  assert.equal((await f.service().webhook(await f.event('invoice.paid', 'cus_elsewhere'))).ignored, true);
  assert.equal((await f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id, { livemode: false }))).ignored, true);
  assert.equal(f.state.calls.length, before);
  p.sub.metadata.app = 'ownedwork';
  await rejectsCode(f.service().getEntitlement('alice', { refresh: true }), 'billing_ownership_mismatch');
});

test('provider outage keeps existing billing-account marker and never claims payment failed', async () => {
  await f.paid(); f.state.fail = () => true;
  const status = await f.service().status('alice');
  assert.equal(status.hasBillingAccount, true); assert.equal(status.entitlement.status, 'unverified');
  assert.equal(status.paidAvailable, false); assert.equal(status.plan, 'free');
  assert.equal((await f.service().status('bob')).hasBillingAccount, false);
});

test('portal remains available when launch is off and cannot select another customer', async () => {
  const row = await f.identity(); f.env.BILLING_LAUNCH_ENABLED = 'false';
  assert.match((await f.service().portal('alice')).url, /^https:\/\/billing.stripe.com\//);
  const call = f.state.calls.find((c) => c.path === '/v1/billing_portal/sessions');
  assert.equal(call.form.customer, row.stripe_customer_id); assert.equal(call.form.configuration, 'bpc_fixture');
  await rejectsCode(f.service().portal('bob'), 'no_billing_account');
});

test('merchant unable to accept new charges can still serve its existing cancellation portal', async () => {
  await f.identity(); f.state.chargesEnabled = false;
  assert.match((await f.service().portal('alice')).url, /^https:\/\/billing.stripe.com\//);
  await rejectsCode(f.service().checkout({ id: 'bob' }, 'monthly'), 'billing_configuration_error');
  await f.service().prepareDeletion('alice');
});

test('deletion cancels subscriptions immediately, expires open checkout, and tombstone blocks another checkout', async () => {
  const p = await f.paid(); p.session.status = 'open';
  f.env.BILLING_LAUNCH_ENABLED = 'false';
  await f.service().prepareDeletion('alice');
  assert.equal(p.sub.status, 'canceled'); assert.equal(p.session.status, 'expired');
  const cancel = f.state.calls.find((c) => c.method === 'DELETE');
  assert.deepEqual(cancel.form, { invoice_now: 'false', prorate: 'false' });
  assert.equal((await f.service().getEntitlement('alice')).active, false);
  f.env.BILLING_LAUNCH_ENABLED = 'true';
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'account_deleting');
});

test('deletion refuses unavailable cancellation and never cancels a foreign product/account', async () => {
  const p = await f.paid();
  f.state.fail = (call) => call.method === 'DELETE';
  await rejectsCode(f.service().prepareDeletion('alice'), 'billing_provider_unavailable');
  assert.equal(p.sub.status, 'active');
  assert.ok(await db.prepare('SELECT id FROM "user" WHERE id=?').bind('alice').first());
  f.state.fail = null; p.sub.metadata.app = 'ownedwork';
  await rejectsCode(f.service().prepareDeletion('alice'), 'billing_ownership_mismatch');
  assert.equal(p.sub.status, 'active');
});

test('deletion cancels every owned duplicate subscription rather than orphaning a second one', async () => {
  const p = await f.paid(); const second = structuredClone(p.sub); second.id = 'sub_second';
  f.state.subscriptions.set(second.id, second);
  await rejectsCode(f.service().getEntitlement('alice', { refresh: true }), 'billing_recovery_required');
  await f.service().prepareDeletion('alice');
  assert.equal(p.sub.status, 'canceled'); assert.equal(second.status, 'canceled');
});

test('new-account deletion and first checkout contend on same row; tombstone works without billing config', async () => {
  const off = createBillingService({ DB: db }, { now: () => f.state.time });
  await off.prepareDeletion('alice');
  await rejectsCode(f.service().checkout({ id: 'alice' }, 'monthly'), 'account_deleting');
  assert.equal(f.state.calls.length, 0);
});

test('late webhook cannot restore deleting account, and deleted customer mapping ignores it', async () => {
  const p = await f.paid();
  await f.service().getEntitlement('alice', { refresh: true });
  await f.service().prepareDeletion('alice');
  p.sub.status = 'active'; // Delayed provider snapshot must not resurrect the tombstoned user.
  await f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id));
  assert.equal((await f.service().getEntitlement('alice')).active, false);
  await db.prepare('DELETE FROM "user" WHERE id=?').bind('alice').run();
  assert.equal((await f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id))).ignored, true);
  assert.equal((await db.prepare('SELECT * FROM billing_subscriptions').all()).results.length, 0);
});

test('provider work delayed beyond the lease cannot write stale entitlement', async () => {
  const p = await f.paid();
  let delayed = false;
  f.state.before = async (call) => { if (call.path.startsWith('/v1/payment_intents/') && !delayed) { delayed = true; f.state.time += 121; } };
  await rejectsCode(f.service().getEntitlement('alice', { refresh: true }), 'billing_busy');
  assert.equal((await db.prepare('SELECT * FROM billing_subscriptions').all()).results.length, 0);
  f.state.before = null; p.sub.status = 'canceled';
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, false);
});

test('a new lease holder between final guard and D1 batch fences every stale write', async () => {
  await f.paid();
  let intercepted = false;
  const wrappedDb = {
    prepare: (...args) => db.prepare(...args),
    async batch(statements) {
      if (!intercepted) {
        intercepted = true;
        await db.prepare('UPDATE billing_accounts SET lock_token=?,lock_until=? WHERE user_id=?').bind('replacement-lease', f.state.time + 300, 'alice').run();
      }
      return db.batch(statements);
    },
  };
  f.env.DB = wrappedDb;
  await rejectsCode(f.service().getEntitlement('alice', { refresh: true }), 'billing_busy');
  assert.equal((await db.prepare('SELECT * FROM billing_subscriptions').all()).results.length, 0);
  assert.equal((await db.prepare('SELECT lock_token FROM billing_accounts WHERE user_id=?').bind('alice').first()).lock_token, 'replacement-lease');
});

test('simultaneous webhook and account deletion serialize, then deletion cancels before data removal', async () => {
  const p = await f.paid();
  let release; let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  f.state.before = async (call) => { if (call.path.startsWith('/v1/payment_intents/')) { entered(); await blocked; } };
  const webhook = f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id));
  await waiting;
  await rejectsCode(f.service().prepareDeletion('alice'), 'billing_busy');
  assert.equal(p.sub.status, 'active');
  release(); await webhook; f.state.before = null;
  await f.service().prepareDeletion('alice');
  assert.equal(p.sub.status, 'canceled');
  await db.prepare('DELETE FROM "user" WHERE id=?').bind('alice').run();
  assert.equal((await f.service().webhook(await f.event('invoice.paid', p.row.stripe_customer_id))).ignored, true);
});

test('test-mode payment can grant only in preview and its cached entitlement cannot cross into production', async () => {
  f = fixture({ AUTH_BASE_URL: 'https://preview.example.test', BILLING_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture' });
  await f.paid();
  assert.equal((await f.service().getEntitlement('alice', { refresh: true })).active, true);
  f.env.AUTH_BASE_URL = 'https://deadhangs.com';
  assert.equal((await f.service().getEntitlement('alice')).active, false);
  f.env.BILLING_MODE = 'live'; f.env.STRIPE_SECRET_KEY = 'sk_live_fixture';
  assert.equal((await f.service().getEntitlement('alice')).active, false);
});
