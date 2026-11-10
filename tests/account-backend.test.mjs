// Runs the real account Pages Functions inside workerd (Miniflare) against a local D1 database.
// Google is simulated by an outbound fetch stub; no real Google account, token or customer data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { prepareLogImport } from '../src/lib/training-log.mjs';
import { signInBody } from '../src/lib/account-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://deadhangs.com';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dh-accounts-'));
const workerFile = path.join(tmp, 'worker.mjs');
// ACCOUNT_WORKER_BUNDLE may point at `wrangler pages functions build` output to exercise real Pages routing.
if (process.env.ACCOUNT_WORKER_BUNDLE) await fs.copyFile(process.env.ACCOUNT_WORKER_BUNDLE, workerFile);
else await build({
  entryPoints: [path.join(root, 'tests/fixtures/account-pages-router.ts')],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['node:*'],
  outfile: workerFile, logLevel: 'error',
});

const workerSource = await fs.readFile(workerFile, 'utf8');
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeIdToken = (claims) => `${b64url({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${b64url(claims)}.c2ln`;
const people = {
  alice: { sub: '100000000000000000001', email: 'alice@example.test', name: 'Test Alice' },
  bob: { sub: '100000000000000000002', email: 'bob@example.test', name: 'Test Bob' },
  // Different Google subject presenting Alice's email: must never reach Alice's account.
  aliceRenamed: { sub: '100000000000000000001', email: 'alice.new@example.test', name: 'Test Alice' },
  imposter: { sub: '100000000000000000003', email: 'alice@example.test', name: 'Other Person' },
  bobAsAliceNew: { sub: '100000000000000000002', email: 'alice.new@example.test', name: 'Test Bob' },
  dana: { sub: '100000000000000000004', email: 'dana@example.test', name: 'Dana' },
  eve: { sub: '100000000000000000005', email: 'eve@example.test', name: 'Eve' },
  fay: { sub: '100000000000000000006', email: 'fay@example.test', name: 'Fay' },
  gusUnverified: { sub: '100000000000000000007', email: 'gus@example.test', name: 'Gus', email_verified: false },
};
const outbound = [];
async function googleStub(request) {
  const url = new URL(request.url);
  outbound.push(url.origin + url.pathname);
  if (url.href === 'https://oauth2.googleapis.com/token' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text());
    const person = people[form.get('code')];
    if (!person || !form.get('code_verifier') || form.get('redirect_uri') !== `${ORIGIN}/api/auth/callback/google`) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile',
      id_token: fakeIdToken({ iss: 'https://accounts.google.com', aud: 'test-client-id', iat: now, exp: now + 3600, email_verified: true, picture: 'https://lh3.example.test/p.png', ...person }),
    });
  }
  return new Response('blocked in tests', { status: 599 });
}

const secrets = { BETTER_AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'), GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret', AUTH_BASE_URL: ORIGIN };
function makeMf(bindings = secrets, d1 = true) {
  return new Miniflare({
    modules: [{ type: 'ESModule', path: 'worker.mjs', contents: workerSource }], compatibilityDate: '2025-09-01', compatibilityFlags: ['nodejs_compat'],
    bindings, d1Databases: d1 ? { DB: 'accounts-test' } : {}, outboundService: googleStub,
  });
}
const mf = makeMf();
const db = await mf.getD1Database('DB');
const migrationFiles = (await fs.readdir(path.join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
  const sql = (await fs.readFile(path.join(root, 'migrations', file), 'utf8')).replace(/^--.*$/gm, '');
  const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  await db.batch(statements.map((s) => db.prepare(s)));
}
test.after(async () => { await mf.dispose(); await fs.rm(tmp, { recursive: true, force: true }); });

class Jar {
  cookies = new Map();
  accountKey = null;
  absorb(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  clone() { const j = new Jar(); j.cookies = new Map(this.cookies); j.accountKey = this.accountKey; return j; }
}

let ipCounter = 0;
async function call(target, pathname, { method = 'GET', jar, body, headers = {}, origin = method === 'GET' ? null : ORIGIN, host = ORIGIN, mfi = mf } = {}) {
  const h = { ...(jar?.accountKey ? { 'X-DeadHangs-Account-Key': jar.accountKey } : {}), 'cf-connecting-ip': `198.51.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`, ...headers };
  if (origin) h.origin = origin;
  if (jar && jar.header()) h.cookie = jar.header();
  if (body !== undefined && !('content-type' in h)) h['content-type'] = 'application/json';
  const response = await mfi.dispatchFetch(host + pathname, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
  jar?.absorb(response);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, data, text };
}

async function signIn(who, jar = new Jar(), callbackURL = '/training-log/') {
  const start = await call(null, '/api/auth/sign-in/social', { method: 'POST', jar, body: { provider: 'google', callbackURL } });
  assert.equal(start.status, 200, start.text);
  const auth = new URL(start.data.url);
  const state = auth.searchParams.get('state');
  const done = await call(null, `/api/auth/callback/google?code=${who}&state=${encodeURIComponent(state)}`, { jar });
  if ([...jar.cookies.keys()].some(k => k.endsWith('session_token'))) jar.accountKey = (await call(null, '/api/account', { jar })).data?.accountKey;
  return { start, auth, done, jar };
}

const entry = (n, extra = {}) => ({ id: `e${n}`, date: '2026-10-01', seconds: 30 + n, assistance: 'unassisted', sets: 3, ...extra });

test('unconfigured or wrong-host deployments fail closed with 503 and no outbound calls', async () => {
  for (const missing of ['BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_BASE_URL']) {
    const bindings = { ...secrets }; delete bindings[missing];
    const other = makeMf(bindings);
    try {
      assert.equal((await call(null, '/api/account', { mfi: other })).status, 503);
      const r = await call(null, '/api/auth/sign-in/social', { mfi: other, method: 'POST', body: { provider: 'google' } });
      assert.equal(r.status, 503); assert.deepEqual(r.data, { error: 'accounts_unavailable' });
    } finally { await other.dispose(); }
  }
  const noDb = makeMf(secrets, false);
  try { assert.equal((await call(null, '/api/account', { mfi: noDb })).status, 503); } finally { await noDb.dispose(); }
  const shortSecret = makeMf({ ...secrets, BETTER_AUTH_SECRET: 'short' });
  try { assert.equal((await call(null, '/api/auth/sign-in/social', { mfi: shortSecret, method: 'POST', body: { provider: 'google' } })).status, 503); } finally { await shortSecret.dispose(); }
  const before = outbound.length;
  for (const host of ['https://deadhangs-com-bew.pages.dev', 'https://abc.deadhangs-com-bew.pages.dev', 'http://deadhangs.com']) {
    assert.equal((await call(null, '/api/account', { host })).status, 503);
    assert.equal((await call(null, '/api/auth/sign-in/social', { host, origin: host, method: 'POST', body: { provider: 'google' } })).status, 503);
  }
  assert.equal(outbound.length, before);
});

test('signed-out requests are rejected', async () => {
  assert.deepEqual((await call(null, '/api/account')).data, { error: 'signed_out' });
  for (const [p, method, body] of [['/api/account', 'GET'], ['/api/account/log', 'GET'], ['/api/account/export', 'GET'], ['/api/account/log', 'PUT', { baseRevision: 0, entries: [] }], ['/api/account/log/import', 'POST', { entries: [] }], ['/api/account', 'DELETE', { confirm: 'delete-account' }], ['/api/account/sessions/revoke', 'POST']]) {
    assert.equal((await call(null, p, { method, body })).status, 401, `${method} ${p}`);
  }
  const forged = new Jar(); forged.cookies.set('__Secure-deadhangs.session_token', 'forged.value');
  assert.equal((await call(null, '/api/account', { jar: forged })).status, 401);
});

test('sign-in only accepts Google, allowlisted callback paths and known keys', async () => {
  const post = (body, opts = {}) => call(null, '/api/auth/sign-in/social', { method: 'POST', body, ...opts });
  for (const callbackURL of ['https://evil.test/', '//evil.test/', '/training-log/?next=https://evil.test', '/somewhere/', 'javascript:alert(1)', '/training-log']) {
    assert.deepEqual((await post({ provider: 'google', callbackURL })).data, { error: 'invalid_callback' }, callbackURL);
    assert.equal((await post({ provider: 'google', errorCallbackURL: callbackURL })).status, 400);
    assert.equal((await post({ provider: 'google', newUserCallbackURL: callbackURL })).status, 400);
  }
  for (const body of [{ provider: 'github' }, { provider: 'google', idToken: { token: 'x' } }, { provider: 'google', scopes: ['https://www.googleapis.com/auth/drive'] }, { provider: 'google', requestSignUp: true }, { provider: 'google', disableRedirect: true }, { provider: 'google', loginHint: 'a@b.c' }, { provider: 'google', additionalData: { a: 1 } }, ['google']]) {
    assert.deepEqual((await post(body)).data, { error: 'invalid_request' }, JSON.stringify(body));
  }
  assert.equal((await post({ provider: 'google' }, { origin: null })).status, 403);
  assert.equal((await post({ provider: 'google' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await post({ provider: 'google' }, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await post('provider=google', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  for (const [method, p] of [['POST', '/api/auth/sign-up/email'], ['POST', '/api/auth/sign-in/email'], ['POST', '/api/auth/update-user'], ['POST', '/api/auth/delete-user'], ['GET', '/api/auth/list-sessions'], ['GET', '/api/auth/sign-in/social'], ['POST', '/api/auth/callback/google'], ['GET', '/api/auth/error'], ['POST', '/api/auth/link-social'], ['GET', '/api/auth/ok']]) {
    assert.equal((await call(null, p, { method, body: method === 'POST' ? {} : undefined })).status, 404, `${method} ${p}`);
  }
});

test('authorization URL uses PKCE S256, exact redirect URI and minimal scopes', async () => {
  const jar = new Jar();
  const { data } = await call(null, '/api/auth/sign-in/social', { method: 'POST', jar, body: { provider: 'google', callbackURL: '/account/' } });
  const url = new URL(data.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback/google`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge')?.length >= 43);
  assert.ok(url.searchParams.get('state')?.length >= 16);
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
  assert.notEqual(url.searchParams.get('access_type'), 'offline');
  assert.ok(!data.url.includes('test-client-secret'));
  const stateCookie = [...jar.cookies.keys()].find((k) => k.includes('state'));
  assert.ok(stateCookie?.startsWith('__Secure-deadhangs.'), 'state cookie is set');
});

test('callback rejects forged state and missing state cookie without creating a session', async () => {
  const { auth } = await signIn('nobody');
  const users = () => db.prepare('SELECT count(*) AS n FROM "user"').first('n');
  const before = await users();
  const jar = new Jar();
  const start = await call(null, '/api/auth/sign-in/social', { method: 'POST', jar, body: { provider: 'google' } });
  const state = new URL(start.data.url).searchParams.get('state');
  const forged = await call(null, `/api/auth/callback/google?code=alice&state=forged-${state}`, { jar: jar.clone() });
  assert.equal(forged.status, 302);
  assert.match(forged.headers.get('location'), /^https:\/\/deadhangs\.com\/account\/\?error=/);
  const noCookie = await call(null, `/api/auth/callback/google?code=alice&state=${encodeURIComponent(state)}`, { jar: new Jar() });
  assert.equal(noCookie.status, 302);
  assert.match(noCookie.headers.get('location'), /\/account\/\?error=/);
  assert.ok(!noCookie.headers.getSetCookie().some((c) => c.includes('session_token=') && !c.includes('Max-Age=0')));
  assert.equal(await users(), before);
  assert.ok(auth.searchParams.get('state'));
});

let alice; let bob;
test('Google sign-in creates a persisted session without storing tokens, IP, user agent or picture', async () => {
  const a = await signIn('alice');
  assert.equal(a.done.status, 302, a.done.text);
  assert.equal(a.done.headers.get('location'), '/training-log/');
  const setCookie = a.done.headers.getSetCookie().find((c) => c.startsWith('__Secure-deadhangs.session_token='));
  assert.ok(setCookie, 'session cookie set');
  assert.match(setCookie, /Max-Age=2592000/i); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=Lax/i); assert.match(setCookie, /Path=\//);
  alice = a.jar;
  bob = (await signIn('bob')).jar;
  const me = await call(null, '/api/account', { jar: alice, headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'TestAgent/1' } });
  assert.equal(me.status, 200);
  assert.equal(typeof me.data.accountKey, 'string');
  const { accountKey, ...accountData } = me.data;
  assert.deepEqual(accountData, { user: { name: 'Test Alice', email: 'alice@example.test' }, plan: 'free', limits: { maxEntries: 200 }, log: { exists: false, revision: 0, count: 0, updatedAt: null } });
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const accounts = (await db.prepare('SELECT * FROM "account"').all()).results;
  assert.equal(accounts.length, 2);
  for (const row of accounts) {
    assert.equal(row.providerId, 'google');
    for (const col of ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'password']) assert.equal(row[col], null, col);
  }
  assert.deepEqual(accounts.map((r) => r.accountId).sort(), [people.alice.sub, people.bob.sub]);
  for (const row of (await db.prepare('SELECT * FROM "session"').all()).results) { assert.equal(row.ipAddress, null); assert.equal(row.userAgent, null); }
  for (const row of (await db.prepare('SELECT * FROM "user"').all()).results) assert.equal(row.image, null);
  const dump = JSON.stringify((await db.prepare('SELECT * FROM "account"').all()).results) + JSON.stringify((await db.prepare('SELECT * FROM "session"').all()).results);
  assert.ok(!dump.includes('test-access-token') && !dump.includes('test-refresh-token') && !dump.includes('203.0.113.9'));
  const session = await call(null, '/api/auth/get-session', { jar: alice });
  assert.equal(session.status, 404, 'raw library session endpoint is not exposed');
  assert.ok(!me.text.includes(people.alice.sub));
});

test('sign-in started on /pro/ returns to /pro/ with the body the pricing page sends', async () => {
  const body = signInBody(true);
  assert.deepEqual(body, { provider: 'google', callbackURL: '/pro/', errorCallbackURL: '/pro/' });
  assert.deepEqual(signInBody(false), { provider: 'google', callbackURL: '/account/', errorCallbackURL: '/account/' });
  const jar = new Jar();
  const start = await call(null, '/api/auth/sign-in/social', { method: 'POST', jar, body });
  assert.equal(start.status, 200, start.text);
  const state = new URL(start.data.url).searchParams.get('state');
  const done = await call(null, `/api/auth/callback/google?code=alice&state=${encodeURIComponent(state)}`, { jar });
  assert.equal(done.status, 302, done.text);
  assert.equal(done.headers.get('location'), '/pro/');
  for (const callbackURL of ['/pro', '/pro/?plan=yearly', '/pro/#plans']) assert.equal((await call(null, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', callbackURL } })).status, 400, callbackURL);
  await call(null, '/api/auth/sign-out', { method: 'POST', jar });
});

test('a different Google subject with an existing email is refused, not linked', async () => {
  const result = await signIn('imposter');
  assert.equal(result.done.status, 302);
  assert.match(result.done.headers.get('location'), /\/account\/\?error=/);
  assert.ok(![...result.jar.cookies.keys()].some((k) => k.endsWith('session_token')));
  assert.equal(result.done.headers.get('location'), `${ORIGIN}/account/?error=account_not_linked`);
  const linked = await db.prepare('SELECT count(*) AS n FROM "account" WHERE "accountId" = ?').bind(people.imposter.sub).first('n');
  assert.equal(linked, 0);
});

test('identity follows the Google subject when the Google email changes', async () => {
  const renamed = await signIn('aliceRenamed');
  assert.equal(renamed.done.headers.get('location'), '/training-log/');
  const me = await call(null, '/api/account', { jar: renamed.jar });
  assert.equal(me.data.user.name, 'Test Alice');
  assert.equal(me.data.user.email, 'alice.new@example.test', 'stored email follows Google on sign-in');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "user"').first('n'), 2, 'no duplicate user for the same subject');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "account" WHERE "accountId" = ?').bind(people.alice.sub).first('n'), 1);
  for (const row of (await db.prepare('SELECT * FROM "user"').all()).results) assert.equal(row.image, null);
  // A refresh onto an email another user already holds keeps the old email instead of failing sign-in.
  const clash = await signIn('bobAsAliceNew');
  assert.equal(clash.done.headers.get('location'), '/training-log/');
  assert.equal((await call(null, '/api/account', { jar: clash.jar })).data.user.email, 'bob@example.test');
  const back = await signIn('alice');
  assert.equal(back.done.headers.get('location'), '/training-log/');
  assert.equal((await call(null, '/api/account', { jar: back.jar })).data.user.email, 'alice@example.test');
});

test('an interrupted first sign-in is repaired only by a validated Google sign-in for that email', async () => {
  const real = await db.prepare('SELECT "createdAt" FROM "user" WHERE "email" = ?').bind('alice@example.test').first('createdAt');
  assert.match(real, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'repair relies on Better Auth writing ISO-8601 UTC createdAt');
  const old = new Date(Date.now() - 5 * 60_000).toISOString();
  const fresh = new Date().toISOString();
  const users = 'INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?,?,?,?,?,?)';
  await db.prepare(users).bind('orphan-old', 'Dana', 'dana@example.test', 1, old, old).run();
  await db.prepare(users).bind('orphan-other', 'Gus', 'gus@example.test', 1, old, old).run();
  await db.prepare(users).bind('orphan-new', 'Eve', 'eve@example.test', 1, fresh, fresh).run();
  await db.prepare(users).bind('orphan-data', 'Fay', 'fay@example.test', 1, old, old).run();
  await db.prepare('INSERT INTO billing_accounts (user_id,app_user_ref,created_at) VALUES (?,?,?)').bind('orphan-data', 'ref-orphan-data', 1).run();
  const exists = async (id) => (await db.prepare('SELECT count(*) AS n FROM "user" WHERE "id" = ?').bind(id).first('n')) === 1;
  const allSeeded = async (msg) => { for (const id of ['orphan-old', 'orphan-other', 'orphan-new', 'orphan-data']) assert.ok(await exists(id), `${id} kept after ${msg}`); };

  // Invalid callbacks never reach the repair.
  const missing = await call(null, '/api/auth/callback/google?code=dana', { jar: new Jar() });
  assert.equal(missing.status, 302); assert.match(missing.headers.get('location'), /\/account\/\?error=/);
  await allSeeded('missing state');
  const jar = new Jar();
  const start = await call(null, '/api/auth/sign-in/social', { method: 'POST', jar, body: { provider: 'google' } });
  const state = new URL(start.data.url).searchParams.get('state');
  const forged = await call(null, `/api/auth/callback/google?code=dana&state=forged-${state}`, { jar: jar.clone() });
  assert.match(forged.headers.get('location'), /\/account\/\?error=/);
  await allSeeded('forged state');
  const failed = await signIn('no-such-google-code');
  assert.match(failed.done.headers.get('location'), /\/account\/\?error=/, 'provider exchange failure');
  await allSeeded('failed provider exchange');
  const unverified = await signIn('gusUnverified');
  assert.match(unverified.done.headers.get('location'), /\/account\/\?error=account_not_linked/);
  await allSeeded('unverified Google email');

  // Fresh (possibly in-flight) and data-owning rows block their own email rather than being removed.
  for (const who of ['eve', 'fay']) {
    const r = await signIn(who);
    assert.equal(r.done.headers.get('location'), `${ORIGIN}/account/?error=account_not_linked`, who);
  }
  await allSeeded('fresh and data-owning sign-ins');

  // A valid sign-in repairs only its own stale orphan.
  const dana = await signIn('dana');
  assert.equal(dana.done.headers.get('location'), '/training-log/', 'stale orphan removed so sign-up completes');
  assert.equal((await call(null, '/api/account', { jar: dana.jar })).data.user.email, 'dana@example.test');
  assert.equal(await exists('orphan-old'), false);
  for (const id of ['orphan-other', 'orphan-new', 'orphan-data']) assert.ok(await exists(id), `${id} untouched by another email's sign-in`);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "account" WHERE "accountId" = ?').bind(people.dana.sub).first('n'), 1);
  assert.ok(await db.prepare('SELECT 1 FROM "user" WHERE "email" = ?').bind('alice@example.test').first(), 'linked users untouched');
  // Fresh-row protection is temporary: once the row is past the in-flight window the next sign-in repairs it.
  await db.prepare('UPDATE "user" SET "createdAt" = ? WHERE "id" = ?').bind(old, 'orphan-new').run();
  const eve = await signIn('eve');
  assert.equal(eve.done.headers.get('location'), '/training-log/');
  assert.equal(await exists('orphan-new'), false);
  assert.ok(await exists('orphan-other') && await exists('orphan-data'));
  const again = await signIn('alice');
  assert.equal(again.done.headers.get('location'), '/training-log/', 'normal returning sign-in still works');

  await db.prepare('DELETE FROM billing_accounts WHERE user_id = ?').bind('orphan-data').run();
  await db.prepare('DELETE FROM "user" WHERE "id" IN (?, ?) OR "email" IN (?, ?)').bind('orphan-data', 'orphan-other', 'dana@example.test', 'eve@example.test').run();
});

// Seed a verified billing cache only inside the isolated D1 fixture. Stripe verification
// and mode separation are exercised by billing-core and billing-http tests.
async function grantFixturePro(jar) {
  const id = jar.accountKey, now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT OR REPLACE INTO billing_accounts (user_id,app_user_ref,stripe_customer_id,provider_mode,verified_at,created_at) VALUES (?,?,?,?,?,?)').bind(id, `ref-${id}`, `cus_${id}`, 'live', now, now).run();
  await db.prepare('INSERT OR REPLACE INTO billing_subscriptions (stripe_subscription_id,user_id,stripe_customer_id,stripe_price_id,status,paid_through,cancel_at_period_end,verified_at,eligible) VALUES (?,?,?,?,?,?,?,?,?)').bind(`sub_${id}`, id, `cus_${id}`, 'price_fixture', 'active', now + 3600, 0, now, 1).run();
}

test('free accounts cannot write cloud data, and a stale account key cannot act on another user', async () => {
  const body = { baseRevision: 0, entries: [entry(1)] };
  assert.deepEqual((await call(null, '/api/account/log', { method: 'PUT', jar: alice, body })).data, { error: 'pro_required' });
  for (const [path, method, payload] of [['/api/account/log', 'PUT', body], ['/api/account/log', 'GET'], ['/api/account/export', 'GET'], ['/api/account', 'DELETE', {confirm:'delete-account'}], ['/api/account/sessions/revoke', 'POST', {}]]) {
    const r = await call(null, path, { method, jar: bob, body: payload, headers: {'X-DeadHangs-Account-Key':alice.accountKey} });
    assert.equal(r.status, 403); assert.equal(r.data.error, 'account_changed');
  }
  assert.equal((await call(null, '/api/account/export', {jar:alice})).status,200);
  await grantFixturePro(alice); await grantFixturePro(bob);
  assert.equal((await call(null, '/api/account', {jar:alice})).data.plan,'pro');
});

test('training log push enforces revisions and isolates users', async () => {
  const put = (jar, baseRevision, entries, opts) => call(null, '/api/account/log', { method: 'PUT', jar, body: { baseRevision, entries }, ...opts });
  const first = await put(alice, 0, [entry(1), entry(2, { kind: 'test', bar: 'thick', grip: 'mixed', chalk: true, load: 5, loadUnit: 'kg', ended: 'grip-gave-out', bodyweightKg: 70.5 })]);
  assert.equal(first.status, 200, first.text); assert.equal(first.data.revision, 1); assert.equal(first.data.count, 2);
  assert.deepEqual((await put(alice, 0, [entry(3)])).data, { error: 'revision_conflict', revision: 1 });
  assert.equal((await put(alice, 7, [entry(3)])).status, 409);
  const second = await put(alice, 1, [entry(1), entry(3)]);
  assert.equal(second.data.revision, 2);
  const staleTab = await put(alice, 1, [entry(9)]);
  assert.deepEqual(staleTab.data, { error: 'revision_conflict', revision: 2 });
  const log = await call(null, '/api/account/log', { jar: alice });
  assert.deepEqual(log.data.entries, [entry(1), entry(3)]);
  assert.equal(log.data.revision, 2); assert.equal(log.data.exists, true); assert.equal(log.data.maxEntries, 200); assert.equal(log.data.schemaVersion, 2);

  const bobLog = await call(null, '/api/account/log', { jar: bob });
  assert.deepEqual([bobLog.data.entries, bobLog.data.revision, bobLog.data.exists], [[], 0, false]);
  assert.equal((await put(bob, 2, [entry(5)])).status, 409, "Bob cannot write at Alice's revision");
  assert.equal((await call(null, '/api/account/log', { method: 'PUT', jar: bob, body: { baseRevision: 0, entries: [entry(5)], userId: 'x' } })).status, 400);
  const aliceId = await db.prepare('SELECT "userId" FROM "account" WHERE "accountId" = ?').bind(people.alice.sub).first('userId');
  assert.equal((await call(null, '/api/account/log', { method: 'PUT', jar: bob, body: { baseRevision: 0, entries: [entry(5)], ownerId: aliceId } })).status, 400);
  assert.equal((await put(bob, 0, [entry(5)])).data.revision, 1);
  assert.deepEqual((await call(null, '/api/account/log', { jar: alice })).data.entries, [entry(1), entry(3)]);
  assert.deepEqual((await call(null, '/api/account/log', { jar: bob })).data.entries, [entry(5)]);
});

test('invalid, unknown, oversize and excessive entries are rejected without partial writes', async () => {
  const before = (await call(null, '/api/account/log', { jar: alice })).data;
  const put = (body, opts = {}) => call(null, '/api/account/log', { method: 'PUT', jar: alice, body, ...opts });
  const base = before.revision;
  const cases = [
    [[{ ...entry(1), note: 'free text' }], 400],
    [[{ ...entry(1), userId: 'x' }], 400],
    [[{ ...entry(1), date: '2026-02-30' }], 400],
    [[{ ...entry(1), date: '2999-01-01' }], 400],
    [[{ ...entry(1), seconds: 0 }], 400],
    [[{ ...entry(1), seconds: 3601 }], 400],
    [[{ ...entry(1), assistance: 'band' }], 400],
    [[{ ...entry(1), load: 5 }], 400],
    [[{ ...entry(1), bodyweightKg: 19 }], 400],
    [[{ ...entry(1), id: '' }], 400],
    [[{ ...entry(1), id: 'x'.repeat(65) }], 400],
    [[entry(1), entry(1)], 400],
    [['string'], 400],
    [{ length: 1 }, 400],
    [Array.from({ length: 201 }, (_, i) => entry(i)), 422],
  ];
  for (const [entries, status] of cases) {
    const r = await put({ baseRevision: base, entries });
    assert.equal(r.status, status, JSON.stringify(entries).slice(0, 80));
  }
  const exact = await put({ baseRevision: base, entries: Array.from({ length: 200 }, (_, i) => entry(i)) });
  assert.equal(exact.status, 200);
  assert.equal(exact.data.count, 200);
  const big = JSON.stringify({ baseRevision: exact.data.revision, entries: [{ ...entry(1), id: 'a'.repeat(64) }], pad: 'x'.repeat(100 * 1024) });
  assert.equal((await put(big)).status, 413);
  assert.equal((await put('{"baseRevision":', {})).status, 400);
  assert.equal((await put(JSON.stringify({ baseRevision: exact.data.revision, entries: [] }), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await put({ baseRevision: -1, entries: [] })).status, 400);
  assert.equal((await put({ baseRevision: 1.5, entries: [] })).status, 400);
  const after = (await call(null, '/api/account/log', { jar: alice })).data;
  assert.equal(after.revision, exact.data.revision);
  assert.equal(after.entries.length, 200);
  const today = new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal((await put({ baseRevision: after.revision, entries: [entry(1), { ...entry(2), date: today }] })).status, 200);
});

test('cross-site and non-JSON writes are refused (CSRF)', async () => {
  const rev = (await call(null, '/api/account/log', { jar: alice })).data.revision;
  const attempt = (opts) => call(null, '/api/account/log', { method: 'PUT', jar: alice, body: { baseRevision: rev, entries: [] }, ...opts });
  assert.equal((await attempt({ origin: null })).status, 403);
  assert.equal((await attempt({ origin: 'https://evil.test' })).status, 403);
  assert.equal((await attempt({ origin: 'https://deadhangs-com-bew.pages.dev' })).status, 403);
  assert.equal((await attempt({ headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await attempt({ headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const [p, method, body] of [['/api/account', 'DELETE', { confirm: 'delete-account' }], ['/api/account/log', 'DELETE', { confirm: 'delete-cloud-log', baseRevision: rev }], ['/api/account/log/import', 'POST', { entries: [] }], ['/api/account/sessions/revoke', 'POST', {}], ['/api/auth/sign-out', 'POST', {}]]) {
    assert.equal((await call(null, p, { method, jar: alice, body, origin: 'https://evil.test' })).status, 403, p);
  }
  assert.equal((await call(null, '/api/account/log', { jar: alice })).data.revision, rev);
  assert.equal((await call(null, '/api/account', { jar: alice })).status, 200);
});

test('stale imports cannot resurrect cleared entries; a fresh revision permits explicit PUT', async () => {
  const carol = (await signIn('bob', new Jar())).jar; // second Bob device
  const bobRev = (await call(null, '/api/account/log', { jar: bob })).data.revision;
  const imp = (jar, entries) => call(null, '/api/account/log/import', { method: 'POST', jar, body: { entries } });
  assert.deepEqual((await imp(bob, [entry(7)])).data, { error: 'cloud_log_exists', revision: bobRev });
  assert.equal((await call(null, '/api/account/log/import', { method: 'POST', jar: bob, body: { entries: [], baseRevision: 0 } })).status, 400);
  assert.equal((await call(null, '/api/account/log', { method: 'DELETE', jar: bob, body: { baseRevision: bobRev } })).status, 400);
  assert.equal((await call(null, '/api/account/log', { method: 'DELETE', jar: bob, body: { confirm: 'delete-cloud-log', baseRevision: bobRev - 1 } })).status, 409);
  const cleared = await call(null, '/api/account/log', { method: 'DELETE', jar: carol, body: { confirm: 'delete-cloud-log', baseRevision: bobRev } });
  assert.deepEqual(cleared.data, { deleted: true, revision: bobRev + 1 });
  const empty = (await call(null, '/api/account/log', { jar: bob })).data;
  assert.deepEqual([empty.exists, empty.entries, empty.revision], [false, [], bobRev + 1]);
  assert.equal((await imp(carol, [entry(8)])).status, 409, 'stale initial import cannot recreate a cleared log');
  const reimported = await call(null, '/api/account/log', { method:'PUT', jar:carol, body:{baseRevision:empty.revision,entries:[entry(8)]} });
  assert.equal(reimported.data.revision, bobRev + 2);
  // The first device still holds bobRev; it must not overwrite the re-imported data.
  assert.equal((await call(null, '/api/account/log', { method: 'PUT', jar: bob, body: { baseRevision: bobRev, entries: [entry(99)] } })).status, 409);
  assert.deepEqual((await call(null, '/api/account/log', { jar: bob })).data.entries, [entry(8)]);
  assert.equal((await imp(bob, Array.from({ length: 201 }, (_, i) => entry(i)))).status, 422);
  const fresh = (await signIn('alice', new Jar())).jar;
  assert.equal((await imp(fresh, [entry(1)])).status, 409, 'Alice already has a cloud log');
});

test('expired Pro cannot write but can export an account backup into the free local log', async () => {
  await db.prepare('UPDATE billing_subscriptions SET paid_through=0 WHERE user_id=?').bind(alice.accountKey).run();
  assert.equal((await call(null,'/api/account/log',{method:'PUT',jar:alice,body:{baseRevision:99,entries:[]}})).status,402);
  const r = await call(null, '/api/account/export', { jar: alice });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="deadhangs-account-export-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(r.data.format, 'deadhangs-account-export');
  assert.deepEqual(Object.keys(r.data.account).sort(), ['createdAt', 'email', 'name', 'plan', 'signIn']);
  assert.equal(r.data.account.email, 'alice@example.test');
  assert.ok(!r.text.includes('Test Bob') && !r.text.includes('token'));
  const restored = prepareLogImport(JSON.stringify(r.data), [], '2999-12-31');
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.added, r.data.trainingLog.entries.length);
});

test('sign-out and revoke-all invalidate sessions server-side', async () => {
  const device1 = (await signIn('bob', new Jar())).jar;
  const device2 = (await signIn('bob', new Jar())).jar;
  const copy = device1.clone();
  const out = await call(null, '/api/auth/sign-out', { method: 'POST', jar: device1, body: {} });
  assert.equal(out.status, 200, out.text);
  assert.equal((await call(null, '/api/account', { jar: copy })).status, 401, 'stolen copy of signed-out cookie is dead');
  assert.equal((await call(null, '/api/account', { jar: device2 })).status, 200);
  const bobId = await db.prepare('SELECT "userId" FROM "account" WHERE "accountId" = ?').bind(people.bob.sub).first('userId');
  const revoked = await call(null, '/api/account/sessions/revoke', { method: 'POST', jar: device2 });
  assert.deepEqual(revoked.data, { revoked: true });
  assert.ok(revoked.headers.getSetCookie().some((c) => c.startsWith('__Secure-deadhangs.session_token=;') && /Max-Age=0/.test(c)));
  for (const jar of [device2, bob]) assert.equal((await call(null, '/api/account', { jar })).status, 401);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "session" WHERE "userId" = ?').bind(bobId).first('n'), 0);
  assert.equal((await call(null, '/api/account', { jar: alice })).status, 200, 'other users unaffected');
});

test('account deletion removes all cloud data and needs no payment', async () => {
  const other = (await signIn('alice', new Jar())).jar;
  assert.equal((await call(null, '/api/account', { method: 'DELETE', jar: alice, body: {} })).status, 400);
  const aliceId = await db.prepare('SELECT "userId" FROM "account" WHERE "accountId" = ?').bind(people.alice.sub).first('userId');
  const blocked = await call(null, '/api/account', { method:'DELETE', jar:alice, body:{confirm:'delete-account'} });
  assert.equal(blocked.status,503,'billing cancellation must be confirmed before deletion');
  assert.equal((await call(null,'/api/account',{jar:alice})).status,200,'refusal retains the account');
  // Remove only the synthetic billing fixture to exercise a never-paying account deletion.
  await db.prepare('DELETE FROM billing_subscriptions WHERE user_id=?').bind(aliceId).run();
  await db.prepare('DELETE FROM billing_accounts WHERE user_id=?').bind(aliceId).run();
  const del = await call(null, '/api/account', { method: 'DELETE', jar: alice, body: { confirm: 'delete-account' } });
  assert.deepEqual(del.data, { deleted: true });
  assert.ok(del.headers.getSetCookie().some((c) => /session_token=;.*Max-Age=0/.test(c)));
  for (const [table, col] of [['user', 'id'], ['session', 'userId'], ['account', 'userId'], ['training_log', 'user_id']]) {
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${col}" = ?`).bind(aliceId).first('n'), 0, table);
  }
  assert.equal((await call(null, '/api/account', { jar: other })).status, 401);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "user"').first('n'), 1, 'Bob remains');
  const again = await signIn('alice');
  assert.equal(again.done.status, 302);
  const fresh = await call(null, '/api/account', { jar: again.jar });
  assert.equal(fresh.data.log.revision, 0, 'a re-created account starts empty');
});

test('clearing a never-used log creates a revision barrier against stale upload', async () => {
  const jar = (await signIn('alice', new Jar())).jar;
  const initial = (await call(null,'/api/account/log',{jar})).data;
  assert.equal(initial.revision,0);
  const cleared = await call(null,'/api/account/log',{method:'DELETE',jar,body:{confirm:'delete-cloud-log',baseRevision:0}});
  assert.deepEqual(cleared.data,{deleted:true,revision:1});
  await grantFixturePro(jar);
  assert.equal((await call(null,'/api/account/log',{method:'PUT',jar,body:{baseRevision:0,entries:[entry(1)]}})).status,409);
  assert.equal((await call(null,'/api/account/log/import',{method:'POST',jar,body:{entries:[entry(1)]}})).status,409);
  assert.deepEqual((await call(null,'/api/account/log',{jar})).data.entries,[]);
  assert.equal((await call(null,'/api/account/log',{method:'PUT',jar,body:{baseRevision:1,entries:[entry(1)]}})).status,200);
});

test('auth endpoints are rate limited per client IP', async () => {
  const headers = { 'cf-connecting-ip': '192.0.2.77' };
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(null, '/api/auth/sign-in/social', { method: 'POST', headers, body: { provider: 'google' } })).status);
  assert.ok(statuses.includes(429), statuses.join(','));
  assert.equal((await call(null, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } })).status, 200, 'other clients unaffected');
});

test('migrations match the Better Auth schema for the configured options', async () => {
  const out = path.join(tmp, 'drift.mjs');
  await build({
    stdin: { contents: `import { getMigrations } from 'better-auth/db/migration'; import { authOptions } from './src/server/auth'; export { getMigrations, authOptions };`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', external: ['node:*'],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const { DatabaseSync } = await import('node:sqlite');
  const { getMigrations, authOptions } = await import(pathToFileURL(out).href);
  const sqlite = new DatabaseSync(':memory:');
  for (const file of migrationFiles) sqlite.exec(await fs.readFile(path.join(root, 'migrations', file), 'utf8'));
  const migrations = await getMigrations(authOptions({ ...secrets, DB: sqlite }));
  assert.deepEqual(migrations.toBeCreated, []);
  assert.deepEqual(migrations.toBeAdded, []);
});
