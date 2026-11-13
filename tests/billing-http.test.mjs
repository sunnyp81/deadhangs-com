// Actual Better Auth cookies + billing Pages handlers inside workerd; Google and
// Stripe outbound responses are fixtures. No login or charge leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://deadhangs.com';
const code = `
import {onRequest as auth} from './functions/api/auth/[[path]].ts';
import {billingRequest, planBillingRequest} from './src/server/billing-http.ts';
export default {fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/auth/')) return auth({request,env});
 if(path.startsWith('/api/billing/plan/')) return planBillingRequest({request,env},path.split('/').pop());
 return billingRequest({request,env},path.split('/').pop());
}};`;
const bundle = await build({ stdin: { contents: code, resolveDir: root, sourcefile: 'billing-test-worker.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*'], logLevel: 'error' });
const providerCalls = [];
let customer;
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
async function provider(request) {
  const url = new URL(request.url);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const params = new URLSearchParams(await request.text());
    const who = params.get('code');
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'https://accounts.google.com', aud: 'fixture-google', iat: now, exp: now + 3600, sub: who === 'alice' ? '100000000000000000001' : '100000000000000000002', email: `${who}@example.test`, email_verified: true, name: who };
    return Response.json({ access_token: 'fixture', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: `${b64({ alg: 'RS256', kid: 'fixture', typ: 'JWT' })}.${b64(claims)}.c2ln` });
  }
  if (url.origin === 'https://api.stripe.com') {
    providerCalls.push({ path: url.pathname, method: request.method, body: request.method === 'POST' ? Object.fromEntries(new URLSearchParams(await request.text())) : null });
    if (url.pathname === '/v1/account') return Response.json({ id: 'acct_fixture', charges_enabled: true });
    if (url.pathname === '/v1/prices/price_plan8') return Response.json({ id: 'price_plan8', livemode: true, active: true, currency: 'gbp', unit_amount: 900, type: 'one_time', product: { id: 'prod_plan8', livemode: true, active: true, metadata: { app: 'deadhangs', product: 'plan8' } } });
    if (url.pathname === '/v1/checkout/sessions') return Response.json({ id: 'cs_live_http1', livemode: true, mode: 'payment', url: 'https://checkout.stripe.com/c/pay/plan', metadata: { app: 'deadhangs', product: 'plan8' } });
    if (url.pathname === '/v1/checkout/sessions/cs_live_http1') return Response.json({ id: 'cs_live_http1', livemode: true, mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 900, currency: 'gbp', metadata: { app: 'deadhangs', product: 'plan8', inputs: JSON.stringify({ testSeconds: 60, repeatSeconds: 40, ageBand: '30-39', sessionsPerWeek: 3 }) }, customer_details: { email: 'http@example.test' }, payment_intent: { id: 'pi_http1', latest_charge: { id: 'ch_http1', amount: 900, amount_refunded: 0, refunded: false } } });
    if (url.pathname === '/v1/customers/cus_alice') return Response.json(customer);
    if (url.pathname === '/v1/billing_portal/configurations/bpc_fixture') return Response.json({ id: 'bpc_fixture', active: true, livemode: true, metadata: { app: 'deadhangs' }, features: { subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false } } });
    if (url.pathname === '/v1/billing_portal/sessions') return Response.json({ customer: 'cus_alice', livemode: true, url: 'https://billing.stripe.com/p/session/fixture' });
  }
  return new Response('blocked by test', { status: 599 });
}
const env = { BETTER_AUTH_SECRET: 'fixture-auth-secret-'.padEnd(48, 'x'), GOOGLE_CLIENT_ID: 'fixture-google', GOOGLE_CLIENT_SECRET: 'fixture-google-secret', AUTH_BASE_URL: ORIGIN,
  BILLING_ENABLED: 'true', BILLING_LAUNCH_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture', STRIPE_PRODUCT_ID: 'prod_fixture', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_YEARLY_PRICE_ID: 'price_yearly', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture', STRIPE_PLAN_PRICE_ID: 'price_plan8', PLAN_LAUNCH_ENABLED: 'true' };
const mf = new Miniflare({ modules: [{ type: 'ESModule', path: path.join(root, 'tests/billing-test-worker.mjs'), contents: bundle.outputFiles[0].text }], compatibilityDate: '2025-09-01', compatibilityFlags: ['nodejs_compat'], bindings: env, d1Databases: ['DB'], outboundService: provider });
const db = await mf.getD1Database('DB');
for (const file of ['0001_accounts.sql', '0002_billing.sql', '0003_plan_purchases.sql']) {
  const sql = (await fs.readFile(path.join(root, 'migrations', file), 'utf8')).replace(/^--.*$/gm, '');
  await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
}
test.after(() => mf.dispose());

class Jar {
  cookies = new Map();
  absorb(r) { for (const line of r.headers.getSetCookie()) { const pair = line.split(';')[0]; const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } }
  header() { return [...this.cookies].map(([k,v]) => `${k}=${v}`).join('; '); }
}
async function call(action, { method = 'POST', jar, body = {}, headers = {}, origin = ORIGIN, host = ORIGIN } = {}) {
  const response = await mf.dispatchFetch(`${host}/api/${action}`, { method, headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...(jar ? { cookie: jar.header() } : {}), ...headers }, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
  jar?.absorb(response);
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, data, text };
}
async function login(who) {
  const jar = new Jar();
  const start = await call('auth/sign-in/social', { jar, body: { provider: 'google', callbackURL: '/account/' } });
  assert.equal(start.status, 200, start.text);
  const state = new URL(start.data.url).searchParams.get('state');
  const finish = await call(`auth/callback/google?code=${who}&state=${encodeURIComponent(state)}`, { jar, method: 'GET' });
  assert.equal(finish.status, 302, finish.text);
  const user = await db.prepare('SELECT id FROM "user" WHERE email=?').bind(`${who}@example.test`).first();
  return { jar, id: user.id };
}
let alice, bob;
test.before(async () => {
  alice = await login('alice'); bob = await login('bob');
  customer = { id: 'cus_alice', livemode: true, metadata: { app: 'deadhangs', deadhangs_user_ref: 'alice-reference' } };
  await db.prepare('INSERT INTO billing_accounts (user_id,app_user_ref,stripe_customer_id,provider_mode,created_at) VALUES (?,?,?,?,?)').bind(alice.id, 'alice-reference', 'cus_alice', 'live', Math.floor(Date.now()/1000)).run();
});

test('signed-out/forged/changed-account sessions and cross-origin mutations are rejected before Stripe', async () => {
  const before = providerCalls.length;
  assert.equal((await call('billing/checkout', { body: { plan: 'monthly' } })).status, 401);
  for (const action of ['checkout', 'portal']) {
    const body = action === 'checkout' ? { plan: 'monthly' } : {};
    assert.equal((await call(`billing/${action}`, { jar: alice.jar, body })).data.error, 'account_changed');
    const changed = await call(`billing/${action}`, { jar: bob.jar, body, headers: { 'X-DeadHangs-Account-Key': alice.id } });
    assert.equal(changed.status, 403); assert.equal(changed.data.error, 'account_changed');
    assert.equal((await call(`billing/${action}`, { jar: alice.jar, body, origin: 'https://evil.example', headers: { 'X-DeadHangs-Account-Key': alice.id } })).status, 403);
  }
  assert.equal((await call('billing/status', { method: 'GET', jar: bob.jar, headers: { 'X-DeadHangs-Account-Key': alice.id } })).status, 403);
  assert.equal(providerCalls.length, before);
});

test('client customer/amount/price/user fields are not accepted by checkout or portal', async () => {
  const before = providerCalls.length;
  for (const body of [{ plan: 'monthly', amount: 1 }, { plan: 'monthly', userId: bob.id }, { plan: 'monthly', customer: 'cus_elsewhere' }, { plan: ['monthly'] }, { plan: 'price_monthly' }]) {
    assert.equal((await call('billing/checkout', { jar: alice.jar, body, headers: { 'X-DeadHangs-Account-Key': alice.id } })).status, 400);
  }
  assert.equal((await call('billing/portal', { jar: alice.jar, body: { customer: 'cus_elsewhere' }, headers: { 'X-DeadHangs-Account-Key': alice.id } })).status, 400);
  assert.equal(providerCalls.length, before);
});

test('authenticated portal uses only mapped customer; wrong host and method fail closed', async () => {
  const result = await call('billing/portal', { jar: alice.jar, headers: { 'X-DeadHangs-Account-Key': alice.id } });
  assert.equal(result.status, 200, result.text); assert.match(result.data.url, /^https:\/\/billing.stripe.com\//);
  assert.equal(providerCalls.at(-1).body.customer, 'cus_alice');
  assert.equal(providerCalls.at(-1).body.configuration, 'bpc_fixture');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const before = providerCalls.length;
  assert.equal((await call('billing/portal', { jar: bob.jar, headers: { 'X-DeadHangs-Account-Key': bob.id } })).status, 409);
  assert.equal((await call('billing/portal', { method: 'GET', jar: alice.jar })).status, 405);
  assert.equal((await call('billing/portal', { jar: alice.jar, host: 'https://other.pages.dev', headers: { 'X-DeadHangs-Account-Key': alice.id } })).status, 503);
  assert.equal(providerCalls.length, before);
});

test('invalid JSON still forwards refreshed HttpOnly session cookie and no-store response', async () => {
  // Better Auth refreshes a live session after updateAge (24h).
  await db.prepare('UPDATE "session" SET "expiresAt"=?,"updatedAt"=? WHERE "userId"=?').bind(new Date(Date.now() + 2 * 86400000).toISOString(), new Date(Date.now() - 2 * 86400000).toISOString(), alice.id).run();
  const result = await call('billing/portal', { jar: alice.jar, body: '{', headers: { 'X-DeadHangs-Account-Key': alice.id } });
  assert.equal(result.status, 400, result.text);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.ok(result.headers.getSetCookie().some((value) => value.includes('HttpOnly') && value.includes('deadhangs.session_token')));
});

test('availability exposes only public fixed prices and no credentials', async () => {
  const result = await call('billing/availability', { method: 'GET' });
  assert.deepEqual(result.data, { paidAvailable: true, prices: { monthly: 499, yearly: 3900, currency: 'GBP' } });
  assert.equal((await call('billing/availability', { method: 'GET', host: 'https://wrong.example' })).data.paidAvailable, false);
});

const PLAN_BODY = { testSeconds: 60, repeatSeconds: 40, ageBand: '30-39', sessionsPerWeek: 3 };
test('plan checkout is account-less, origin-checked, input-validated and returns only a Stripe URL', async () => {
  const before = providerCalls.length;
  assert.equal((await call('billing/plan/checkout', { body: PLAN_BODY, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('billing/plan/checkout', { method: 'GET' })).status, 405);
  assert.equal((await call('billing/plan/checkout', { body: { ...PLAN_BODY, price: 'price_x' } })).data.error, 'invalid_plan_inputs');
  assert.equal((await call('billing/plan/checkout', { body: PLAN_BODY, host: 'https://other.pages.dev' })).status, 503);
  assert.equal(providerCalls.length, before);
  const ok = await call('billing/plan/checkout', { body: PLAN_BODY });
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.data.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const create = providerCalls.find((c) => c.path === '/v1/checkout/sessions').body;
  assert.equal(create.mode, 'payment');
  assert.equal(create.customer, undefined);
});

test('plan success endpoint verifies with Stripe, returns the view link once per session, and rejects bad ids', async () => {
  assert.equal((await call('billing/plan/success?session_id=nope', { method: 'GET' })).data.error, 'invalid_session');
  assert.equal((await call('billing/plan/success', { method: 'GET' })).status, 400);
  assert.equal((await call('billing/plan/success?session_id=cs_live_http1&x=1', { method: 'GET' })).status, 400);
  const first = await call('billing/plan/success?session_id=cs_live_http1', { method: 'GET' });
  assert.equal(first.status, 200, first.text);
  assert.match(first.data.url, /^\/plan\/view\/\?t=[A-Za-z0-9_-]{43}$/);
  const second = await call('billing/plan/success?session_id=cs_live_http1', { method: 'GET' });
  assert.equal(second.data.url, first.data.url);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM plan_purchases').first()).n, 1);
});
