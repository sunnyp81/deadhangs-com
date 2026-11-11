// E1 email compliance gate. Every Brevo call is a fake; nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as mail from '../src/server/email.mjs';
import { consentSource, emailFlagOn, CONSENT_WORDING_VERSION } from '../src/lib/email-consent.mjs';

async function load(file) {
  const base = new URL('../' + file, import.meta.url);
  const out = ts.transpileModule(await fs.readFile(base, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from '(\.{1,2}\/[^']+)'/g, (_m, spec) => `from '${new URL(spec, base).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));
}
const { onRequestPost: subscribe } = await load('functions/api/subscribe.ts');
const unsub = await load('functions/api/unsubscribe.ts');

const SECRET = 's'.repeat(40);
const BAD_CHARS = new RegExp('[' + String.fromCharCode(0x2013, 0x2014, 0xfffd) + ']');
const ready = { BREVO_API_KEY: 'test-only', EMAIL_CAPTURE_ENABLED: 'true', UNSUB_SECRET: SECRET, EMAIL_POSTAL_ADDRESS: '1 Test Street, Testtown, TE1 1ST', EMAIL_SENDER: 'sender@example.com', AUTH_BASE_URL: 'https://deadhangs.com' };
const signup = (body) => new Request('https://deadhangs.com/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function fakeBrevo(t, { blacklisted = false, lookupStatus = 200 } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/contacts') && options.method === 'POST') return new Response('{}', { status: 201 });
    if (url.includes('/contacts/') && !options.method) return lookupStatus === 200 ? Response.json({ emailBlacklisted: blacklisted }) : new Response('', { status: lookupStatus });
    if (url.includes('/contacts/') && options.method === 'PUT') return new Response(null, { status: 204 });
    if (url.endsWith('/smtp/email')) return Response.json({ messageId: 'x' }, { status: 201 });
    throw Error('unexpected ' + url);
  });
  return calls;
}

test('flag reads only the exact string "true"; absent means off', () => {
  for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes', true]) assert.equal(emailFlagOn(v), false);
  assert.equal(emailFlagOn('true'), true);
});

test('flag is off in every wrangler environment and in the build flag module', async () => {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(!raw.includes('EMAIL_CAPTURE_ENABLED'));
  const { EMAIL_CAPTURE_ENABLED } = await import('../src/lib/email-flag.mjs');
  assert.equal(EMAIL_CAPTURE_ENABLED, process.env.EMAIL_CAPTURE_ENABLED === 'true');
});

test('send readiness lists every missing piece and blocks the placeholder postal address', () => {
  assert.deepEqual(mail.sendReadiness(ready), []);
  const blockers = mail.sendReadiness({});
  for (const word of ['EMAIL_CAPTURE_ENABLED', 'BREVO_API_KEY', 'UNSUB_SECRET', 'EMAIL_POSTAL_ADDRESS', 'EMAIL_SENDER', 'AUTH_BASE_URL']) assert.ok(blockers.some((b) => b.includes(word)), word);
  assert.ok(mail.sendReadiness({ ...ready, EMAIL_POSTAL_ADDRESS: mail.POSTAL_ADDRESS_PLACEHOLDER }).some((b) => b.includes('POSTAL')));
  assert.ok(mail.sendReadiness({ ...ready, UNSUB_SECRET: 'short' }).some((b) => b.includes('UNSUB_SECRET')));
  assert.ok(mail.sendReadiness({ ...ready, AUTH_BASE_URL: 'http://deadhangs.com' }).length);
  assert.ok(mail.sendReadiness({ ...ready, EMAIL_LIST_ID: 'abc' }).length);
  assert.equal(mail.listId({}), 3);
});

test('unsubscribe token is per address, case-insensitive and rejects tampering', async () => {
  const token = await mail.makeUnsubToken('A@Example.com', SECRET);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await mail.verifyUnsubToken('a@example.com', token, SECRET), true);
  assert.equal(await mail.verifyUnsubToken('b@example.com', token, SECRET), false);
  assert.equal(await mail.verifyUnsubToken('a@example.com', token, 'x'.repeat(40)), false);
  assert.equal(await mail.verifyUnsubToken('a@example.com', token.slice(1) + 'A', SECRET), false);
  assert.equal(await mail.verifyUnsubToken('a@example.com', '', SECRET), false);
});

test('a compliant send carries both unsubscribe headers, footer link and postal address', async (t) => {
  const calls = fakeBrevo(t);
  const result = await mail.sendCompliantEmail(ready, { email: 'a+b@example.com', subject: 'S', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/contacts/a%2Bb%40example.com');
  const send = calls[1].body;
  const token = await mail.makeUnsubToken('a+b@example.com', SECRET);
  const url = `https://deadhangs.com/api/unsubscribe?e=a%2Bb%40example.com&t=${token}`;
  assert.equal(send.headers['List-Unsubscribe'], `<${url}>, <mailto:sender@example.com?subject=unsubscribe>`);
  assert.equal(send.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(send.htmlContent.includes(url.replace(/&/g, '&amp;')));
  assert.ok(send.htmlContent.includes('1 Test Street') && send.textContent.includes('1 Test Street') && send.textContent.includes(url));
  assert.equal(calls.length, 2);
});

test('suppressed, unknown-state and not-ready contacts are never sent', async (t) => {
  let calls = fakeBrevo(t, { blacklisted: true });
  assert.deepEqual(await mail.sendCompliantEmail(ready, { email: 'a@example.com', subject: 'S', bodyHtml: '', bodyText: '' }), { sent: false, reason: 'suppressed' });
  assert.ok(!calls.some((c) => c.url.endsWith('/smtp/email')));
  t.mock.restoreAll(); calls = fakeBrevo(t, { lookupStatus: 500 });
  assert.equal((await mail.sendCompliantEmail(ready, { email: 'a@example.com', subject: 'S', bodyHtml: '', bodyText: '' })).reason, 'suppressed');
  t.mock.restoreAll(); calls = fakeBrevo(t);
  for (const env of [{ ...ready, EMAIL_CAPTURE_ENABLED: undefined }, { ...ready, EMAIL_POSTAL_ADDRESS: '' }, { ...ready, UNSUB_SECRET: undefined }]) {
    assert.equal((await mail.sendCompliantEmail(env, { email: 'a@example.com', subject: 'S', bodyHtml: '', bodyText: '' })).reason, 'not_ready');
  }
  assert.equal(calls.length, 0);
});

test('flag off: signup adds the contact, sends nothing and records no new attributes', async (t) => {
  const calls = fakeBrevo(t);
  const res = await subscribe({ request: signup({ email: 'a@example.com', source: '/dead-hang-time-by-age/' }), env: { ...ready, EMAIL_CAPTURE_ENABLED: undefined } });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body.attributes).sort(), ['DRIP_LAST_SENT', 'SIGNUP_DATE']);
});

test('flag on: consent source, time and wording are recorded and the welcome email is compliant', async (t) => {
  const calls = fakeBrevo(t);
  const res = await subscribe({ request: signup({ email: 'a@example.com', source: '/dead-hang-time-by-age/?x=1' }), env: ready });
  assert.equal(res.status, 200);
  const attrs = calls[0].body.attributes;
  assert.equal(attrs.CONSENT_SOURCE, '/dead-hang-time-by-age/');
  assert.equal(attrs.CONSENT_WORDING, CONSENT_WORDING_VERSION);
  assert.match(attrs.CONSENT_AT, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls[1].method, 'GET');
  const send = calls[2].body;
  assert.equal(send.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(send.htmlContent.includes('/training-log/?mode=simple&amp;hang=15&amp;rest=90&amp;rounds=3'));
  assert.ok(send.htmlContent.includes('utm_campaign=hang-longer'));
});

test('flag on but postal address still the placeholder: contact added, no send', async (t) => {
  const calls = fakeBrevo(t);
  await subscribe({ request: signup({ email: 'a@example.com' }), env: { ...ready, EMAIL_POSTAL_ADDRESS: mail.POSTAL_ADDRESS_PLACEHOLDER } });
  assert.equal(calls.length, 1);
});

test('consent source is allowlisted, never free text', () => {
  assert.equal(consentSource('/training-log/'), '/training-log/');
  assert.equal(consentSource('/training-log/?email=a@example.com'), '/training-log/');
  assert.equal(consentSource('/somewhere/a@example.com'), 'other');
  assert.equal(consentSource(42), 'other');
});

test('honeypot submissions get a quiet success and never reach Brevo', async (t) => {
  const calls = fakeBrevo(t);
  const res = await subscribe({ request: signup({ email: 'a@example.com', website: 'spam.example' }), env: ready });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

const unsubRequest = (method, query) => new Request('https://deadhangs.com/api/unsubscribe' + query, { method, ...(method === 'POST' ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' } : {}) });

test('one-click POST and footer GET blacklist the contact with a valid token', async (t) => {
  const token = await mail.makeUnsubToken('a@example.com', SECRET);
  for (const method of ['POST', 'GET']) {
    t.mock.restoreAll();
    const calls = fakeBrevo(t);
    const handler = method === 'POST' ? unsub.onRequestPost : unsub.onRequestGet;
    const res = await handler({ request: unsubRequest(method, `?e=A%40example.com&t=${token}`), env: ready });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/contacts/a%40example.com');
    assert.deepEqual(calls[0].body, { emailBlacklisted: true });
    if (method === 'GET') assert.match(await res.text(), /You are unsubscribed/);
  }
});

test('forged, missing and unconfigured unsubscribe requests change nothing', async (t) => {
  const calls = fakeBrevo(t);
  const token = await mail.makeUnsubToken('a@example.com', SECRET);
  assert.equal((await unsub.onRequestGet({ request: unsubRequest('GET', `?e=b%40example.com&t=${token}`), env: ready })).status, 403);
  assert.equal((await unsub.onRequestPost({ request: unsubRequest('POST', '?e=a%40example.com'), env: ready })).status, 400);
  const res = await unsub.onRequestGet({ request: unsubRequest('GET', `?e=a%40example.com&t=${token}`), env: { BREVO_API_KEY: 'test-only' } });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /mailto:/);
  assert.equal(calls.length, 0);
});

test('unsubscribe still works with the send flag off, and the page has no dashes or broken characters', async (t) => {
  fakeBrevo(t);
  const token = await mail.makeUnsubToken('a@example.com', SECRET);
  assert.equal((await unsub.onRequestPost({ request: unsubRequest('POST', `?e=a%40example.com&t=${token}`), env: { ...ready, EMAIL_CAPTURE_ENABLED: undefined } })).status, 200);
  for (const state of ['done', 'invalid', 'unavailable']) assert.doesNotMatch(unsub.page(state), BAD_CHARS);
  const w = mail.welcomeEmail('https://deadhangs.com');
  assert.doesNotMatch(w.bodyHtml + w.bodyText + mail.footerHtml('u', 'p') + w.subject, BAD_CHARS);
});

test('drip: a contact suppressed since the list snapshot is skipped, sends carry headers and params', async (t) => {
  const { onRequestPost: drip } = await load('functions/api/drip-cron.ts');
  const env = { ...ready, DRIP_CRON_SECRET: 'cron-test-only', DRIP_ENABLED: 'true', DRIP_TEMPLATE_IDS: '1,2,3,4,5,6,7,8,9,10,11,12' };
  const contact = (email) => ({ email, attributes: { SIGNUP_DATE: '2026-01-01', DRIP_LAST_SENT: '-1' } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/smtp/templates/')) return Response.json({ isActive: true, subject: 'S', sender: { email: 'sender@example.com' }, htmlContent: '{{ params.UNSUB_URL }} {{ params.POSTAL_ADDRESS }}' });
    if (url.includes('/contacts/lists/3/')) return Response.json({ contacts: [contact('gone@example.com'), contact('ok@example.com')] });
    if (url.includes('/contacts/') && !options.method) return Response.json({ emailBlacklisted: url.includes('gone') });
    return new Response(null, { status: options.method === 'POST' ? 201 : 204 });
  });
  const body = await (await drip({ request: new Request('https://deadhangs.com/api/drip-cron', { method: 'POST', headers: { 'x-cron-secret': 'cron-test-only' } }), env })).json();
  assert.equal(body.sent, 1);
  const sends = calls.filter((c) => c.url.endsWith('/smtp/email'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body.to[0].email, 'ok@example.com');
  assert.equal(sends[0].body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(sends[0].body.params.POSTAL_ADDRESS, ready.EMAIL_POSTAL_ADDRESS);
  t.mock.restoreAll();
  let n = 0; t.mock.method(globalThis, 'fetch', async () => { n++; throw Error('must not call'); });
  const blocked = await drip({ request: new Request('https://deadhangs.com/api/drip-cron', { method: 'POST', headers: { 'x-cron-secret': 'cron-test-only' } }), env: { ...env, EMAIL_CAPTURE_ENABLED: undefined } });
  assert.equal(blocked.status, 503);
  assert.equal(n, 0);
});
