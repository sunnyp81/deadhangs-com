// Runs the real auth, account, billing webhook, programme and gym Pages Functions inside workerd (Miniflare) against a
// local D1 database with every migration applied. Google and Stripe are simulated by an outbound stub: no real account,
// key, card or customer data is used. This is the HTTP-level journey for a test-mode preview origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createCampaign } from '../src/server/gym-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://preview.deadhangs-com-bew.pages.dev';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dh-programme-'));
const workerFile = path.join(tmp, 'worker.mjs');
await build({ entryPoints: [path.join(root, 'tests/fixtures/programme-pages-router.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['node:*'], outfile: workerFile, logLevel: 'error', loader: { '.json': 'json' } });
const copy = JSON.parse(await fs.readFile(path.join(root, 'src/server/programmes/hang4.copy.json'), 'utf8'));
const paidTitles = ['standard', 'supported'].flatMap((r) => Object.values(copy[r]).map((s) => s.title)).filter(Boolean);

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeIdToken = (claims) => `${b64url({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${b64url(claims)}.c2ln`;
const people = { alice: { sub: '200000000000000000001', email: 'alice@example.test', name: 'Test Alice' }, bob: { sub: '200000000000000000002', email: 'bob@example.test', name: 'Test Bob' } };
const stripe = { customers: new Map(), sessions: new Map(), intents: new Map(), n: 0 };
const stripeJson = (value, status = 200) => Response.json(value, { status });

async function outbound(request) {
  const url = new URL(request.url);
  if (url.href === 'https://oauth2.googleapis.com/token' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text());
    const person = people[form.get('code')];
    if (!person || form.get('redirect_uri') !== `${ORIGIN}/api/auth/callback/google`) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    return Response.json({ access_token: 't', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile',
      id_token: fakeIdToken({ iss: 'https://accounts.google.com', aud: 'test-client-id', iat: now, exp: now + 3600, email_verified: true, ...person }) });
  }
  if (url.origin !== 'https://api.stripe.com') return new Response('blocked in tests', { status: 599 });
  assert.equal(request.headers.get('authorization'), 'Bearer sk_test_fixture');
  const form = Object.fromEntries(new URLSearchParams(request.method === 'POST' ? await request.text() : ''));
  const p = url.pathname;
  if (p === '/v1/account') return stripeJson({ id: 'acct_fixture', charges_enabled: true });
  if (p === '/v1/prices/price_programme') return stripeJson({ id: 'price_programme', livemode: false, active: true, currency: 'gbp', unit_amount: 2900, type: 'one_time', product: { id: 'prod_p', livemode: false, active: true, metadata: { app: 'deadhangs', product: 'programme_hang4' } } });
  if (p === '/v1/customers' && request.method === 'POST') {
    const c = { id: `cus_${++stripe.n}x`, livemode: false, metadata: { app: form['metadata[app]'], deadhangs_user_ref: form['metadata[deadhangs_user_ref]'] } };
    stripe.customers.set(c.id, c); return stripeJson(c);
  }
  if (p.startsWith('/v1/customers/')) return stripe.customers.has(p.split('/')[3]) ? stripeJson(stripe.customers.get(p.split('/')[3])) : stripeJson({}, 404);
  if (p === '/v1/subscriptions') return stripeJson({ data: [], has_more: false });
  if (p === '/v1/checkout/sessions' && request.method === 'POST') {
    const metadata = Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
    const s = { id: `cs_test_${++stripe.n}x`, livemode: false, mode: form.mode, customer: form.customer, status: 'open', payment_status: 'unpaid', amount_total: 2900, currency: 'gbp', url: 'https://checkout.stripe.com/c/pay/fixture', metadata, payment_intent: null };
    stripe.sessions.set(s.id, s); return stripeJson(s);
  }
  if (p === '/v1/checkout/sessions') return stripeJson({ data: [...stripe.sessions.values()].filter((s) => s.customer === url.searchParams.get('customer') && s.status === 'open'), has_more: false });
  if (p.startsWith('/v1/checkout/sessions/')) {
    const s = stripe.sessions.get(p.split('/')[4]);
    if (!s) return stripeJson({}, 404);
    if (p.endsWith('/expire')) s.status = 'expired';
    const value = structuredClone(s);
    if (s.payment_intent && url.searchParams.getAll('expand[]').includes('payment_intent.latest_charge')) value.payment_intent = structuredClone(stripe.intents.get(s.payment_intent));
    return stripeJson(value);
  }
  return stripeJson({ error: 'fixture_missing' }, 404);
}
function pay(sessionId) {
  const s = stripe.sessions.get(sessionId);
  const pi = `pi_${sessionId.slice(8)}`;
  stripe.intents.set(pi, { id: pi, livemode: false, customer: s.customer, status: 'succeeded', amount_received: 2900,
    latest_charge: { id: `ch_${sessionId.slice(8)}`, livemode: false, paid: true, customer: s.customer, payment_intent: pi, amount: 2900, amount_refunded: 0, refunded: false, disputed: false, currency: 'gbp' } });
  Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: pi });
  return pi;
}

const env = { BETTER_AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'), GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret', AUTH_BASE_URL: ORIGIN,
  BILLING_ENABLED: 'true', BILLING_MODE: 'test', BILLING_LAUNCH_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  STRIPE_ACCOUNT_ID: 'acct_fixture', STRIPE_PRODUCT_ID: 'prod_fixture', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_YEARLY_PRICE_ID: 'price_yearly', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
  PROGRAMME_LAUNCH_ENABLED: 'true', PROGRAMME_ALLOW_DRAFT: 'true', STRIPE_PROGRAMME_PRICE_ID: 'price_programme', GYM_PILOT_ENABLED: 'true' };
const mf = new Miniflare({ modules: [{ type: 'ESModule', path: 'worker.mjs', contents: await fs.readFile(workerFile, 'utf8') }], compatibilityDate: '2025-09-01', compatibilityFlags: ['nodejs_compat'],
  bindings: env, d1Databases: { DB: 'programme-test' }, outboundService: outbound });
const db = await mf.getD1Database('DB');
for (const file of (await fs.readdir(path.join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = (await fs.readFile(path.join(root, 'migrations', file), 'utf8')).replace(/^--.*$/gm, '');
  await db.batch(sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
}
test.after(async () => { await mf.dispose(); await fs.rm(tmp, { recursive: true, force: true }); });

class Jar {
  cookies = new Map(); accountKey = null;
  absorb(response) { for (const line of response.headers.getSetCookie()) { const [pair] = line.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1).trim(); if (v) this.cookies.set(pair.slice(0, i).trim(), v); else this.cookies.delete(pair.slice(0, i).trim()); } }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}
let ip = 0;
async function call(pathname, { method = 'GET', jar, body, origin = method === 'GET' ? null : ORIGIN, headers = {} } = {}) {
  const h = { 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(jar?.accountKey ? { 'X-DeadHangs-Account-Key': jar.accountKey } : {}), ...headers };
  if (origin) h.origin = origin;
  if (jar?.header()) h.cookie = jar.header();
  if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  const response = await mf.dispatchFetch(ORIGIN + pathname, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
  jar?.absorb(response);
  const text = await response.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, text, headers: response.headers };
}
async function signIn(who) {
  const jar = new Jar();
  const start = await call('/api/auth/sign-in/social', { method: 'POST', jar, body: { provider: 'google', callbackURL: '/programme/app/' } });
  assert.equal(start.status, 200, start.text);
  const state = new URL(start.data.url).searchParams.get('state');
  await call(`/api/auth/callback/google?code=${who}&state=${encodeURIComponent(state)}`, { jar });
  jar.accountKey = (await call('/api/account', { jar })).data?.accountKey;
  assert.ok(jar.accountKey, `${who} signed in`);
  return jar;
}
function signedWebhook(event) {
  const raw = JSON.stringify(event); const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_fixture').update(`${t}.${raw}`).digest('hex');
  return call('/api/billing/webhook', { method: 'POST', body: raw, origin: null, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } });
}
const leaks = (text) => paidTitles.filter((title) => text.includes(title));

test('programme journey over HTTP: interest, sign-in, test-mode purchase, delivery, conflicts, refund, export and deletion', async () => {
  const open = await call('/api/programme/availability?programme=hang4');
  assert.deepEqual(open.data, { programme: 'hang4', open: true, test: true, price: { amount: 2900, currency: 'gbp' } });
  assert.equal((await call('/api/programme/state')).status, 401);
  assert.equal((await call('/api/programme/interest', { method: 'POST', body: { email: 'x@example.test', programme: 'hang4', consent: false } })).status, 400);
  assert.equal((await call('/api/programme/interest', { method: 'POST', origin: 'https://evil.example', body: { email: 'x@example.test', programme: 'hang4', consent: true } })).status, 403);
  assert.deepEqual((await call('/api/programme/interest', { method: 'POST', body: { email: 'X@example.test', programme: 'hang4', consent: true, website: '' } })).data, { saved: true });

  const alice = await signIn('alice');
  const bob = await signIn('bob');
  const before = await call('/api/programme/state?programme=hang4', { jar: alice });
  assert.equal(before.data.access.active, false);
  assert.equal(before.data.progress, null);
  assert.deepEqual(leaks(before.text), [], 'no paid copy before purchase');
  assert.equal((await call('/api/programme/progress', { method: 'POST', jar: alice, body: { programme: 'hang4', baseRevision: 0, op: { op: 'pause' } } })).status, 402);

  const checkout = await call('/api/programme/checkout', { method: 'POST', jar: alice, body: { programme: 'hang4', source: 'programme_page' } });
  assert.equal(checkout.status, 200, checkout.text);
  assert.match(checkout.data.url, /^https:\/\/checkout\.stripe\.com\//);
  const sessionId = [...stripe.sessions.keys()].at(-1);
  assert.equal((await call('/api/programme/checkout', { method: 'POST', jar: alice, headers: { 'X-DeadHangs-Account-Key': 'someone-else' }, body: { programme: 'hang4' } })).status, 403, 'stale account key');
  assert.equal((await call('/api/programme/settle', { method: 'POST', jar: alice, body: { sessionId } })).data.status, 'pending', 'redirect before payment grants nothing');
  pay(sessionId);
  assert.equal((await call('/api/programme/settle', { method: 'POST', jar: bob, body: { sessionId } })).status, 403, 'another account cannot claim it');
  assert.equal((await call('/api/programme/settle', { method: 'POST', jar: alice, body: { sessionId } })).data.status, 'paid');

  const bought = await call('/api/programme/state?programme=hang4&today=2026-11-26', { jar: alice });
  assert.equal(bought.data.access.active, true);
  assert.equal(bought.data.progress.next.type, 'enrol');
  const enrol = await call('/api/programme/progress', { method: 'POST', jar: alice, body: { programme: 'hang4', baseRevision: 0, today: '2026-11-26',
    op: { op: 'enrol', route: 'standard', baselineSeconds: 12, maxTestSeconds: 15, setup: { bar: 'standard', grip: 'overhand' }, localDate: '2026-11-26' } } });
  assert.equal(enrol.status, 200, enrol.text);
  assert.equal(enrol.data.progress.next.session.key, 'w1s1');
  assert.ok(leaks(enrol.text).length > 0, 'buyers get the session copy');
  const record = { programme: 'hang4', baseRevision: 1, op: { op: 'record', id: 'retry-safe-0001', sessionKey: 'w1s1', sets: [12, 11, null], setup: { bar: 'standard', grip: 'overhand' }, localDate: '2026-11-26' } };
  assert.equal((await call('/api/programme/progress', { method: 'POST', jar: alice, body: record })).status, 200);
  const stale = await call('/api/programme/progress', { method: 'POST', jar: alice, body: record });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.data, { error: 'revision_conflict', revision: 2 });
  const retried = await call('/api/programme/progress', { method: 'POST', jar: alice, body: { ...record, baseRevision: 2 } });
  assert.equal(retried.data.changed, false, 'a retry with the same id changes nothing');

  const bobView = await call('/api/programme/state?programme=hang4', { jar: bob });
  assert.equal(bobView.data.access.active, false);
  assert.deepEqual(leaks(bobView.text), [], 'other accounts never see the paid copy');
  assert.equal(bobView.text.includes('retry-safe-0001'), false, 'or another person\'s records');

  const pi = stripe.sessions.get(sessionId).payment_intent;
  Object.assign(stripe.intents.get(pi).latest_charge, { amount_refunded: 2900, refunded: true });
  const hook = await signedWebhook({ id: 'evt_refund1', type: 'charge.refunded', livemode: false, data: { object: { id: `ch_${sessionId.slice(8)}`, payment_intent: pi } } });
  assert.equal(hook.status, 200, hook.text);
  const after = await call('/api/programme/state?programme=hang4', { jar: alice });
  assert.equal(after.data.access.status, 'refunded');
  assert.equal(after.data.progress.readOnly, true);
  assert.equal(after.data.progress.results.length, 1, 'their own records stay readable');
  assert.deepEqual(leaks(after.text), [], 'paid copy stops after a refund');
  assert.equal((await call('/api/programme/progress', { method: 'POST', jar: alice, body: { programme: 'hang4', baseRevision: 2, op: { op: 'pause' } } })).status, 402);

  const exported = await call('/api/account/export', { jar: alice });
  assert.equal(exported.data.programmes.progress.length, 1);
  assert.equal(exported.data.programmes.purchases[0].status, 'refunded');
  assert.equal(JSON.stringify(exported.data.programmes).includes('cs_test'), false, 'no payment identifiers in the export');

  const removed = await call('/api/account', { method: 'DELETE', jar: alice, body: { confirm: 'delete-account' } });
  assert.equal(removed.status, 200, removed.text);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM programme_progress').first()).n, 0);
  const kept = await db.prepare('SELECT user_id, status FROM programme_purchases').first();
  assert.deepEqual(kept, { user_id: null, status: 'refunded' });
});

test('gym routes over HTTP: organiser invite, member isolation, export, and 404 for anything outside the caller\'s campaign', async () => {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const a = await createCampaign(db, { gymName: 'Synthetic Gym A', title: 'Hang month', startsOn: today, endsOn: later, rule: { bar: 'Rig', grip: 'Overhand', chalk: 'Allowed' } }, now);
  const b = await createCampaign(db, { gymName: 'Synthetic Gym B', title: 'Hang month', startsOn: today, endsOn: later, rule: { bar: 'Rig', grip: 'Overhand', chalk: 'Allowed' } }, now);
  const organiser = await signIn('alice');
  const member = await signIn('bob');
  assert.equal((await call('/api/gym/join', { method: 'POST', jar: organiser, body: { token: a.organiserToken, displayName: 'Org A', shareConsent: true } })).data.role, 'organiser');
  const invite = await call('/api/gym/organiser', { method: 'POST', jar: organiser, body: { campaignId: a.campaignId, op: 'invite' } });
  assert.match(invite.data.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('/api/gym/join', { method: 'POST', jar: member, body: { token: invite.data.token, displayName: 'Member', showOnBoard: true, shareConsent: true } })).data.role, 'participant');
  assert.equal((await call('/api/gym/result', { method: 'POST', jar: member, body: { campaignId: a.campaignId, id: 'gym-result-0001', seconds: 42, localDate: today, ruleConfirmed: true } })).status, 200);
  assert.equal((await call(`/api/gym/campaign?id=${b.campaignId}`, { jar: member })).status, 404, 'other gym unreadable');
  assert.equal((await call(`/api/gym/export?id=${a.campaignId}`, { jar: member })).status, 403, 'members cannot export');
  const csv = await call(`/api/gym/export?id=${a.campaignId}`, { jar: organiser });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /Member,.*,42,42,,yes/);
  assert.equal(/@example|bob|alice/i.test(csv.text), false);
  const view = await call(`/api/gym/campaign?id=${a.campaignId}`, { jar: organiser });
  assert.equal(view.data.board[0].best, 42);
  assert.equal(view.text.includes(member.accountKey), false, 'organisers never see account ids');
  assert.equal((await call('/api/gym/enquiry', { method: 'POST', body: { gymName: 'G', contactName: 'C', email: 'c@example.test', consent: true } })).data.saved, true);
});
