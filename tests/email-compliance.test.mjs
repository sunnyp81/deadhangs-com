import { deliveryDb } from './delivery-db.mjs';
// E1 email compliance gate. Every Brevo call is a fake; nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as mail from '../src/server/email.mjs';
import rules from '../src/data/plan-rules.json' with { type: 'json' };
import { consentSource, emailFlagOn, CONSENT_WORDING_VERSION } from '../src/lib/email-consent.mjs';

async function load(file) {
  const base = new URL('../' + file, import.meta.url);
  const out = ts.transpileModule(await fs.readFile(base, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from '(\.{1,2}\/[^']+)'/g, (_m, spec) => `from '${new URL(spec, base).href}'${spec.endsWith('.json') ? " with { type: 'json' }" : ''}`);
  return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));
}
const { onRequestPost: subscribe } = await load('functions/api/subscribe.ts');
const unsub = await load('functions/api/unsubscribe.ts');

const welcome = (origin, result, now) => mail.welcomeEmail(origin, result, now, rules);
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

test('flag is on only in production; preview and top-level vars stay off', async () => {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.vars.EMAIL_CAPTURE_ENABLED, undefined);
  assert.equal(cfg.env.preview.vars.EMAIL_CAPTURE_ENABLED, undefined);
  assert.equal(cfg.env.production.vars.EMAIL_CAPTURE_ENABLED, 'true');
  assert.equal(mail.postalAddress(cfg.env.production.vars) !== null, true);
  assert.equal(mail.senderEmail(cfg.env.production.vars), 'hello@deadhangs.com');
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

test('unsubscribe id is opaque, per address, case-insensitive and rejects tampering', async () => {
  const id = await mail.makeUnsubId('A@Example.com', SECRET);
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.equal(await mail.readUnsubId(id, SECRET), 'a@example.com');
  assert.notEqual(await mail.makeUnsubId('A@Example.com', SECRET), id);
  assert.equal(await mail.readUnsubId(id, 'x'.repeat(40)), null);
  assert.equal(await mail.readUnsubId(id.slice(0, -2) + (id.endsWith('AA') ? 'BB' : 'AA'), SECRET), null);
  assert.equal(await mail.readUnsubId(id.slice(1), SECRET), null);
  for (const bad of ['', 'abc', 'a@example.com', null, undefined, '!!!']) assert.equal(await mail.readUnsubId(bad, SECRET), null);
});

test('no address appears in any unsubscribe URL, header or footer, plain or encoded', async (t) => {
  const calls = fakeBrevo(t);
  await mail.sendCompliantEmail(ready, { email: 'Someone+tag@example.com', subject: 'S', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' });
  const send = calls[1].body;
  const urls = [...(send.headers['List-Unsubscribe'].match(/<https:[^>]+>/g) || []), ...(send.htmlContent + send.textContent).match(/https:\/\/deadhangs\.com\/api\/unsubscribe\S*/g)];
  assert.ok(urls.length >= 3);
  for (const url of urls) {
    assert.match(url, /\/api\/unsubscribe\?u=[A-Za-z0-9_-]+/);
    for (const needle of ['someone', 'example.com', '%40', '@', 'e=']) assert.ok(!url.toLowerCase().includes(needle), needle + ' in ' + url);
  }
});

test('a compliant send carries both unsubscribe headers, footer link and postal address', async (t) => {
  const calls = fakeBrevo(t);
  const result = await mail.sendCompliantEmail(ready, { email: 'a+b@example.com', subject: 'S', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/contacts/a%2Bb%40example.com');
  const send = calls[1].body;
  const url = send.headers['List-Unsubscribe'].match(/^<(https:\/\/deadhangs\.com\/api\/unsubscribe\?u=[A-Za-z0-9_-]+)>, <mailto:sender@example\.com\?subject=unsubscribe>$/)?.[1];
  assert.ok(url);
  assert.equal(await mail.readUnsubId(new URL(url).searchParams.get('u'), SECRET), 'a+b@example.com');
  assert.equal(send.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(send.htmlContent.includes(url));
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

test('GET with a valid token makes no Brevo call and returns the confirm form', async (t) => {
  const calls = fakeBrevo(t);
  const id = await mail.makeUnsubId('a@example.com', SECRET);
  const res = await unsub.onRequestGet({ request: unsubRequest('GET', `?u=${id}`), env: ready });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  const html = await res.text();
  assert.ok(html.includes(`<form method="post" action="/api/unsubscribe?u=${id}"><button type="submit">Unsubscribe</button></form>`));
  assert.match(html, /min-height:44px/);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
});

test('POST from the confirm form and the RFC 8058 one-click both blacklist the contact', async (t) => {
  const id = await mail.makeUnsubId('A@example.com', SECRET);
  for (const kind of ['form', 'one-click']) {
    t.mock.restoreAll();
    const calls = fakeBrevo(t);
    const request = kind === 'form'
      ? new Request(`https://deadhangs.com/api/unsubscribe?u=${id}`, { method: 'POST', headers: { accept: 'text/html,application/xhtml+xml', 'content-type': 'application/x-www-form-urlencoded' }, body: '' })
      : unsubRequest('POST', `?u=${id}`);
    const res = await unsub.onRequestPost({ request, env: ready });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/contacts/a%40example.com');
    assert.deepEqual(calls[0].body, { emailBlacklisted: true });
    const body = await res.text();
    if (kind === 'form') assert.match(body, /You are unsubscribed/); else assert.equal(body, 'done');
  }
});

test('forged, missing and unconfigured unsubscribe requests change nothing', async (t) => {
  const calls = fakeBrevo(t);
  const id = await mail.makeUnsubId('a@example.com', SECRET);
  assert.equal((await unsub.onRequestGet({ request: unsubRequest('GET', `?u=${id.slice(0, -3)}AAA`), env: ready })).status, 403);
  assert.equal((await unsub.onRequestGet({ request: unsubRequest('GET', '?e=a%40example.com'), env: ready })).status, 400);
  assert.equal((await unsub.onRequestPost({ request: unsubRequest('POST', '?u=' + await mail.makeUnsubId('a@example.com', 'z'.repeat(40))), env: ready })).status, 403);
  assert.equal((await unsub.onRequestPost({ request: unsubRequest('POST', ''), env: ready })).status, 400);
  const res = await unsub.onRequestGet({ request: unsubRequest('GET', `?u=${id}`), env: { BREVO_API_KEY: 'test-only' } });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /mailto:/);
  assert.equal(calls.length, 0);
});

test('unsubscribe still works with the send flag off, and the page has no dashes or broken characters', async (t) => {
  fakeBrevo(t);
  const id = await mail.makeUnsubId('a@example.com', SECRET);
  assert.equal((await unsub.onRequestPost({ request: unsubRequest('POST', `?u=${id}`), env: { ...ready, EMAIL_CAPTURE_ENABLED: undefined } })).status, 200);
  for (const state of ['confirm', 'done', 'invalid', 'unavailable']) assert.doesNotMatch(unsub.page(state, '/api/unsubscribe'), BAD_CHARS);
  const w = welcome('https://deadhangs.com');
  assert.doesNotMatch(w.bodyHtml + w.bodyText + mail.footerHtml('u', 'p') + w.subject, BAD_CHARS);
});

test('drip: a contact suppressed since the list snapshot is skipped, sends carry headers and footer', async (t) => {
  const { onRequestPost: drip } = await load('functions/api/drip-cron.ts');
  const env = { ...ready, DB: deliveryDb(), DRIP_CRON_SECRET: 'cron-test-only', DRIP_ENABLED: 'true' };
  const contact = (email) => ({ email, attributes: { CONSENT_AT: '2026-01-01T12:00:00.000Z', DRIP_LAST_SENT: '-1' } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
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
  const send = sends[0].body;
  assert.equal(send.templateId, undefined);
  assert.match(send.headers['List-Unsubscribe'], /<https:\/\/deadhangs\.com\/api\/unsubscribe\?u=/);
  for (const text of [send.htmlContent, send.textContent]) {
    assert.ok(text.includes(ready.EMAIL_POSTAL_ADDRESS));
    assert.ok(text.includes('/api/unsubscribe?u='));
    assert.match(text, /utm_campaign=e2/);
    assert.match(text, /utm_content=step0/);
  }
  assert.doesNotMatch(send.subject + send.htmlContent + send.textContent, BAD_CHARS);
  assert.ok(!calls.some((c) => c.url.includes('/smtp/templates/')));
  t.mock.restoreAll();
  let n = 0; t.mock.method(globalThis, 'fetch', async () => { n++; throw Error('must not call'); });
  const blocked = await drip({ request: new Request('https://deadhangs.com/api/drip-cron', { method: 'POST', headers: { 'x-cron-secret': 'cron-test-only' } }), env: { ...env, EMAIL_CAPTURE_ENABLED: undefined } });
  assert.equal(blocked.status, 503);
  assert.equal(n, 0);
});

test('both drip steps render tracked links and compliant code emails', async (t) => {
  const { onRequestPost: drip } = await load('functions/api/drip-cron.ts');
  for (const step of [0, 1]) {
    t.mock.restoreAll();
    let payload;
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
      if (url.includes('/contacts/lists/')) return Response.json({ contacts: [{ email: 'ok@example.com', attributes: { CONSENT_AT: '2026-01-01T12:00:00.000Z', DRIP_LAST_SENT: String(step - 1) } }] });
      if (url.includes('/contacts/') && !options.method) return Response.json({ emailBlacklisted: false });
      if (url.endsWith('/smtp/email')) { payload = JSON.parse(options.body); return new Response(null, { status: 201 }); }
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      throw Error('Unexpected provider call: ' + url);
    });
    const result = await drip({ request: new Request('https://deadhangs.com/api/drip-cron', { method: 'POST', headers: { 'x-cron-secret': 'cron-test-only' } }), env: { ...ready, DB: deliveryDb(), DRIP_ENABLED: 'true', DRIP_CRON_SECRET: 'cron-test-only' } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).sent, 1);
    assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(payload.templateId, undefined);
    for (const text of [payload.bodyText || payload.textContent, payload.htmlContent]) {
      assert.ok(text.includes(ready.EMAIL_POSTAL_ADDRESS));
      assert.ok(text.includes('/api/unsubscribe?u='));
      assert.doesNotMatch(text, BAD_CHARS);
    }
    const links = [...payload.htmlContent.matchAll(/href="(https:[^"]+)"/g)].map((m) => new URL(m[1].replaceAll('&amp;', '&'))).filter((u) => u.pathname !== '/api/unsubscribe');
    assert.ok(links.length > 0);
    for (const url of links) {
      assert.equal(url.searchParams.get('utm_source'), 'email');
      assert.equal(url.searchParams.get('utm_medium'), 'email');
      assert.equal(url.searchParams.get('utm_campaign'), 'e2');
      assert.equal(url.searchParams.get('utm_content'), 'step' + step);
    }
    if (step === 0) {
      const timer = links.find((u) => u.pathname === '/training-log/');
      assert.ok(timer);
      for (const [key, value] of Object.entries({ mode: 'simple', hang: '15', rest: '90', rounds: '3' })) assert.equal(timer.searchParams.get(key), value);
    } else {
      assert.ok(links.some((u) => u.pathname === '/pro/'));
      assert.match(payload.textContent, /4\.99/);
      assert.match(payload.textContent, /39/);
      assert.match(payload.textContent, /cancel any time/i);
    }
  }
});

test('consent wording version is bumped and the offer promises only what ships', async () => {
  const consent = await import('../src/lib/email-consent.mjs');
  assert.equal(consent.CONSENT_WORDING_VERSION, 'signup-2026-11-15');
  assert.equal(consent.CONSENT_WORDING, 'By subscribing, you ask to receive DeadHangs training emails. Unsubscribe in any received message.');
  assert.match(consent.OFFER_WORDING, /welcome email/);
  assert.match(consent.OFFER_WORDING, /starting hold/);
  assert.match(consent.OFFER_WORDING, /short starter series when it is ready/);
  assert.doesNotMatch(consent.OFFER_WORDING, /weekly|reminder|progress/);
  assert.doesNotMatch(consent.OFFER_WORDING + consent.CONSENT_WORDING, BAD_CHARS);
});

test('result validation drops anything out of range and keeps valid values', () => {
  assert.deepEqual(mail.cleanResult({ seconds: 45.4, ageBand: '40-59' }), { seconds: 45, ageBand: '40-59' });
  assert.deepEqual(mail.cleanResult({ seconds: 3600, ageBand: 'nonsense' }), { seconds: 3600, ageBand: null });
  for (const bad of [null, 'x', {}, { seconds: 0 }, { seconds: -5 }, { seconds: 3601 }, { seconds: '45' }, { seconds: NaN }, { seconds: Infinity }]) assert.equal(mail.cleanResult(bad), null);
});

test('welcome email applies the free 4-week programme rules to the submitted seconds, with a date 28 days out', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const w = welcome('https://deadhangs.com', { seconds: 50, ageBand: '40-59' }, now);
  for (const text of [w.bodyHtml, w.bodyText]) {
    assert.match(text, /50 seconds/);
    assert.match(text, /free 4-week programme/);
    assert.match(text, /about 80% of your max: for 50 seconds that is about 40 seconds, 3 sets, 90 seconds rest, three days a week/);
    assert.match(text, /\/4-week-program\/\?utm_source=newsletter/);
    assert.match(text, /18 December 2026/);
    assert.match(text, /training-log\/\?mode=simple&(amp;)?hang=40&(amp;)?rest=90&(amp;)?rounds=3&(amp;)?prep=5/);
    assert.match(text, /Open the timer set to 3 x 40 seconds/);
    assert.match(text, /£9 plan/);
    assert.doesNotMatch(text, /compared with|adults|Week 1|60 to 90|plan card/);
  }
  assert.match(w.bodyHtml, /<a href="https:\/\/deadhangs\.com\/4-week-program\/\?[^"]+">free 4-week programme<\/a>/);
  assert.match(w.subject, /50 second.*starting hold/);
  assert.doesNotMatch(w.subject + w.bodyHtml + w.bodyText, BAD_CHARS);
  assert.equal(mail.retestDate(new Date('2026-12-10T00:00:00Z')), '7 January 2027');
});

test('starting hold uses only w4 rules: no cap at 60, no age band, entry quote under 7 seconds', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.match(welcome('https://deadhangs.com', { seconds: 90, ageBand: 'under-40' }, now).bodyText, /about 72 seconds, 3 sets, 90 seconds rest/);
  assert.match(welcome('https://deadhangs.com', { seconds: 300 }, now).bodyText, /about 240 seconds, 3 sets/);
  assert.match(welcome('https://deadhangs.com', { seconds: 30 }, now).bodyText, /about 24 seconds, 3 sets/);
  assert.match(welcome('https://deadhangs.com', { seconds: 7 }, now).bodyText, /about 6 seconds, 3 sets/);
  const short = welcome('https://deadhangs.com', { seconds: 6, ageBand: null }, now);
  assert.match(short.bodyText, /Your result: 6 seconds\./);
  assert.match(short.bodyText, /"The program suits anyone who can hold the bar for about 5 seconds\."/);
  assert.doesNotMatch(short.bodyText, /that is about|3 x \d/);
  assert.deepEqual(mail.startingHold(6, rules), { entry: 'The program suits anyone who can hold the bar for about 5 seconds.' });
  assert.equal(mail.startingHold(50, rules).baseline, 40);
});

test('welcome email without a valid result is generic but still has a re-test date', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  for (const input of [undefined, null, { seconds: 99999 }, 'junk']) {
    const w = welcome('https://deadhangs.com', input, now);
    assert.ok(!w.bodyText.includes('Your result'));
    assert.match(w.bodyText, /18 December 2026/);
    assert.match(w.bodyText, /Start with Level 1/);
  }
});

test('subscribe passes the submitted result into the welcome email and ignores out-of-range values', async (t) => {
  let calls = fakeBrevo(t);
  assert.equal((await subscribe({ request: signup({ email: 'a@example.com', source: '/dead-hang-time-by-age/', result: { seconds: 63, ageBand: '60-plus' } }), env: ready })).status, 200);
  let send = calls.find((c) => c.url.endsWith('/smtp/email')).body;
  assert.match(send.textContent, /Your result: 63 seconds./);
  assert.match(send.textContent, /about 50 seconds, 3 sets, 90 seconds rest/);
  assert.match(send.textContent, /\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/);
  t.mock.restoreAll(); calls = fakeBrevo(t);
  await subscribe({ request: signup({ email: 'a@example.com', result: { seconds: 99999, ageBand: 'x' } }), env: ready });
  send = calls.find((c) => c.url.endsWith('/smtp/email')).body;
  assert.ok(!send.textContent.includes('Your result'));
});

test('flag off: a posted result is ignored and nothing is sent', async (t) => {
  const calls = fakeBrevo(t);
  await subscribe({ request: signup({ email: 'a@example.com', result: { seconds: 60, ageBand: 'under-40' } }), env: { ...ready, EMAIL_CAPTURE_ENABLED: undefined } });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body.attributes).sort(), ['DRIP_LAST_SENT', 'SIGNUP_DATE']);
});

test('baseline above the timer maximum: link text says "Open the timer", not a set-to figure', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const at = welcome('https://deadhangs.com', { seconds: 150 }, now);
  assert.match(at.bodyText, /about 120 seconds, 3 sets/);
  assert.match(at.bodyText, /Open the timer set to 3 x 120 seconds/);
  const over = welcome('https://deadhangs.com', { seconds: 300 }, now);
  for (const text of [over.bodyText, over.bodyHtml]) {
    assert.match(text, /Open the timer(:|<)/);
    assert.doesNotMatch(text, /set to 3 x/);
  }
});

test('max under 7 seconds: no Level 1 line or preset, links the how-to guide instead', () => {
  const w = welcome('https://deadhangs.com', { seconds: 6 }, new Date('2026-11-20T10:00:00Z'));
  for (const text of [w.bodyText, w.bodyHtml]) {
    assert.doesNotMatch(text, /Level 1|gentle place|mode=simple/);
    assert.match(text, /\/how-to-deadhang\/\?utm_source=newsletter/);
  }
  assert.match(w.bodyHtml, /<a href="https:\/\/deadhangs\.com\/how-to-deadhang\/\?[^"]+">Read how to dead hang<\/a>/);
});
