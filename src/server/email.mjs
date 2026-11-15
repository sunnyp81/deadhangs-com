// Every email the site sends goes through sendCompliantEmail. Nothing sends unless sendReadiness() is empty.
import { emailFlagOn } from '../lib/email-consent.mjs';
import { TIMER_PRESETS } from '../lib/timer-preset.mjs';
import { AGE_BANDS, MAX_TEST_SECONDS, ruleLookup, weekOneLine } from '../lib/plan8.mjs';
import { AGE_BAND_LABELS } from '../lib/plan8-render.mjs';
import { PLAN_PRICE_LABEL } from '../lib/plan-offer.mjs';
import rules from '../data/plan-rules.json' with { type: 'json' };

const BREVO = 'https://api.brevo.com/v3';
export const POSTAL_ADDRESS_PLACEHOLDER = 'POSTAL ADDRESS REQUIRED';
export const DEFAULT_LIST_ID = 3;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function postalAddress(env) {
  const value = typeof env?.EMAIL_POSTAL_ADDRESS === 'string' ? env.EMAIL_POSTAL_ADDRESS.trim() : '';
  if (value.length < 10 || value.toUpperCase().includes(POSTAL_ADDRESS_PLACEHOLDER)) return null;
  return value;
}

export function siteOrigin(env) {
  const value = env?.AUTH_BASE_URL;
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin;
  } catch { return null; }
}

export function senderEmail(env) {
  const value = typeof env?.EMAIL_SENDER === 'string' ? env.EMAIL_SENDER.trim() : '';
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
}

export function listId(env) {
  const raw = env?.EMAIL_LIST_ID;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIST_ID;
  return /^[1-9]\d{0,8}$/.test(String(raw)) ? Number(raw) : null;
}

/** Every reason a send would be refused. Empty array means sending is allowed. */
export function sendReadiness(env) {
  const blockers = [];
  if (!emailFlagOn(env?.EMAIL_CAPTURE_ENABLED)) blockers.push('EMAIL_CAPTURE_ENABLED is not "true"');
  if (!env?.BREVO_API_KEY) blockers.push('BREVO_API_KEY is missing');
  if (typeof env?.UNSUB_SECRET !== 'string' || env.UNSUB_SECRET.length < 32) blockers.push('UNSUB_SECRET must be set (32 or more characters)');
  if (!postalAddress(env)) blockers.push('EMAIL_POSTAL_ADDRESS is unset or still the placeholder');
  if (!senderEmail(env)) blockers.push('EMAIL_SENDER is missing or invalid');
  if (!siteOrigin(env)) blockers.push('AUTH_BASE_URL must be the https site origin');
  if (listId(env) === null) blockers.push('EMAIL_LIST_ID is invalid');
  return blockers;
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

async function unsubKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('deadhangs-unsub-v1:' + secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Opaque unsubscribe id: base64url(version | iv | AES-GCM(lowercased address)). The address never appears in a URL, and the GCM tag makes it tamper-proof with no token store. */
export async function makeUnsubId(email, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await unsubKey(secret), new TextEncoder().encode(String(email).trim().toLowerCase())));
  const out = new Uint8Array(1 + iv.length + body.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(body, 1 + iv.length);
  return base64url(out);
}

/** The address behind an unsubscribe id, or null when the id is missing, altered or made with another secret. */
export async function readUnsubId(id, secret) {
  const bytes = fromBase64url(id);
  if (!bytes || !secret || bytes.length < 30 || bytes.length > 400 || bytes[0] !== 1) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, await unsubKey(secret), bytes.slice(13));
    const email = new TextDecoder().decode(plain);
    return email && email.length <= 254 ? email : null;
  } catch { return null; }
}

export function unsubscribeUrl(origin, id) {
  return `${origin}/api/unsubscribe?u=${id}`;
}

/** RFC 2369 + RFC 8058 headers: https one-click first, mailto fallback. */
export function listUnsubscribeHeaders(url, mailto) {
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${mailto}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export function footerHtml(url, postal) {
  return `<hr style="border:none;border-top:1px solid #d6d3cb;margin:28px 0 16px">
<p style="margin:0;font-size:12px;line-height:1.6;color:#5c5a55">You are getting this because you signed up for training emails at deadhangs.com.
<a href="${escapeHtml(url)}" style="color:#5c5a55">Unsubscribe with one click</a>. DeadHangs is operated by ND Media Ltd, ${escapeHtml(postal)}.</p>`;
}

export function footerText(url, postal) {
  return `\n\n--\nYou are getting this because you signed up for training emails at deadhangs.com.\nUnsubscribe with one click: ${url}\nDeadHangs is operated by ND Media Ltd, ${postal}.`;
}

/** True when Brevo marks the contact as opted out. Any error counts as suppressed (fail closed). */
export async function isSuppressed(apiKey, email) {
  try {
    const res = await fetch(`${BREVO}/contacts/${encodeURIComponent(email)}`, { headers: { 'api-key': apiKey }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return false;
    if (!res.ok) return true;
    const contact = await res.json();
    return !contact || contact.emailBlacklisted === true;
  } catch { return true; }
}

/** Sets emailBlacklisted in Brevo. 404 means there is nothing to suppress. */
export async function blacklist(apiKey, email) {
  const res = await fetch(`${BREVO}/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ emailBlacklisted: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 404) throw new Error('blacklist failed ' + res.status);
}

/** Per-recipient unsubscribe URL and headers for a send. Used by the welcome email and the drip. */
export async function complianceFor(env, email) {
  const url = unsubscribeUrl(siteOrigin(env), await makeUnsubId(email, env.UNSUB_SECRET));
  return { url, headers: listUnsubscribeHeaders(url, senderEmail(env)), postal: postalAddress(env) };
}

/**
 * The only send path for code-built emails. Refuses while any readiness blocker exists,
 * checks suppression immediately before sending, then adds headers and footer.
 */
export async function sendCompliantEmail(env, { email, subject, bodyHtml, bodyText }) {
  const blockers = sendReadiness(env);
  if (blockers.length) return { sent: false, reason: 'not_ready', blockers };
  if (await isSuppressed(env.BREVO_API_KEY, email)) return { sent: false, reason: 'suppressed' };
  const { url, headers, postal } = await complianceFor(env, email);
  const sender = { email: senderEmail(env), name: env.EMAIL_SENDER_NAME || 'DeadHangs' };
  try {
    const res = await fetch(`${BREVO}/smtp/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
      body: JSON.stringify({
        sender, replyTo: sender, to: [{ email }], subject,
        htmlContent: bodyHtml + footerHtml(url, postal),
        textContent: bodyText + footerText(url, postal),
        headers,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { sent: true } : { sent: false, reason: 'provider_' + res.status };
  } catch { return { sent: false, reason: 'network' }; }
}

/** The visitor's by-age result as posted by the form. Anything out of range is dropped, never trusted. */
export function cleanResult(input) {
  if (!input || typeof input !== 'object') return null;
  const seconds = typeof input.seconds === 'number' ? Math.round(input.seconds) : NaN;
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TEST_SECONDS) return null;
  const ageBand = typeof input.ageBand === 'string' && AGE_BANDS.includes(input.ageBand) ? input.ageBand : null;
  return { seconds, ageBand };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Date four weeks after `now`, in UTC, written out in full for UK readers. */
export function retestDate(now = new Date()) {
  const d = new Date(now.getTime() + 28 * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Week-1 line from the plan rules: the baseline is the rule's share of the max hold, held to the plan's own limits. */
function weekOneFor(seconds) {
  const share = Number(/\d+/.exec(String(ruleLookup(rules)('w4.baseline_fraction').value))?.[0]) / 100;
  if (!(share > 0 && share < 1)) return null;
  const repeat = Math.min(Math.round(seconds * share), 60);
  const line = weekOneLine({ testSeconds: Math.max(seconds, repeat), repeatSeconds: repeat, ageBand: 'under-40', sessionsPerWeek: 3 }, rules);
  return line ? { text: line.text, repeat } : null;
}

/** Welcome email copy: personal when a valid result is supplied, generic otherwise. DRAFT until Sunny approves the wording. */
export function welcomeEmail(origin, result = null, now = new Date()) {
  const utm = 'utm_source=newsletter&utm_medium=email&utm_campaign=hang-longer';
  const preset = (name) => `${origin}${TIMER_PRESETS.find((p) => p.name === name).path}&${utm}`;
  const level1 = preset('Level 1 session');
  const planUrl = `${origin}/plan/?${utm}`;
  const date = retestDate(now);
  const r = cleanResult(result);
  const band = r?.ageBand ? AGE_BAND_LABELS[r.ageBand].toLowerCase() : null;
  const week1 = r ? weekOneFor(r.seconds) : null;
  const resultText = r ? `Your result: ${r.seconds} seconds${band ? `, compared with ${band}` : ''}.` : null;
  const holdsText = week1
    ? `${week1.text}. That starts at about 80% of your ${r.seconds} second max hold, three days a week.`
    : 'Start with Level 1: 3 hangs of 15 seconds, 90 seconds of rest between them, on 3 non-consecutive days a week. Stop each hang a second or two before your grip gives out.';
  const retestText = `Test again on ${date}, four weeks from today, in the same way on the same bar, and compare like with like.`;
  const planText = `If you would rather have it set out for you, the ${PLAN_PRICE_LABEL} plan builds eight weeks around your own holds.`;
  const closing = 'You will also get a short starter series when it is ready. The timer and your log stay free, with no account needed.';
  const h = escapeHtml;
  const resultHtml = resultText ? `<p>${h(resultText)}</p>\n` : '';
  const resultPlain = resultText ? `${resultText}\n\n` : '';
  return {
    subject: r ? `Your ${r.seconds} second dead hang and your first week` : 'Your first dead hang week and your re-test date',
    bodyHtml: `<p>Thanks for signing up to DeadHangs training emails.</p>\n${resultHtml}<p>${h(holdsText)} <a href="${h(level1)}">Open the free Level 1 timer preset</a>.</p>\n<p>${h(retestText)}</p>\n<p>${h(planText)} <a href="${h(planUrl)}">See the plan</a>.</p>\n<p>${h(closing)}</p>`,
    bodyText: `Thanks for signing up to DeadHangs training emails.\n\n${resultPlain}${holdsText}\nFree Level 1 timer preset: ${level1}\n\n${retestText}\n\n${planText}\nSee the plan: ${planUrl}\n\n${closing}`,
  };
}
