// Every email the site sends goes through sendCompliantEmail. Nothing sends unless sendReadiness() is empty.
import { emailFlagOn } from '../lib/email-consent.mjs';
import { TIMER_PRESETS } from '../lib/timer-preset.mjs';

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

/** base64url(HMAC-SHA256(lowercased email, secret)); recomputed on unsubscribe, so no token store. */
export async function makeUnsubToken(email, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(email).trim().toLowerCase()));
  return base64url(new Uint8Array(sig));
}

export async function verifyUnsubToken(email, token, secret) {
  if (!email || typeof token !== 'string' || !token || !secret) return false;
  const expected = await makeUnsubToken(email, secret);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function unsubscribeUrl(origin, email, token) {
  return `${origin}/api/unsubscribe?e=${encodeURIComponent(String(email).trim().toLowerCase())}&t=${token}`;
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
  const token = await makeUnsubToken(email, env.UNSUB_SECRET);
  const url = unsubscribeUrl(siteOrigin(env), email, token);
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

/** Welcome email copy. DRAFT: needs Sunny's approval before EMAIL_CAPTURE_ENABLED turns on. */
export function welcomeEmail(origin) {
  const utm = 'utm_source=newsletter&utm_medium=email&utm_campaign=hang-longer';
  const preset = (name) => `${origin}${TIMER_PRESETS.find((p) => p.name === name).path}&${utm}`;
  const level1 = preset('Level 1 session');
  const maxTest = preset('Max test');
  return {
    subject: 'Your first dead hang session',
    bodyHtml: `<p>Thanks for signing up to DeadHangs training emails.</p>
<p>You will get a starter plan, a weekly test reminder and a note on when to progress. Nothing else.</p>
<p>Start with Level 1: 3 hangs of 15 seconds, 90 seconds of rest between them, on 3 non-consecutive days a week. Stop each hang a second or two before your grip gives out. <a href="${escapeHtml(level1)}">Open the timer with Level 1 set up</a>.</p>
<p>Want a baseline first? <a href="${escapeHtml(maxTest)}">Run the max hang test in the timer</a> and log the result.</p>
<p>The timer and your log stay free, with no account needed.</p>`,
    bodyText: `Thanks for signing up to DeadHangs training emails.\n\nYou will get a starter plan, a weekly test reminder and a note on when to progress. Nothing else.\n\nStart with Level 1: 3 hangs of 15 seconds, 90 seconds of rest between them, on 3 non-consecutive days a week. Stop each hang a second or two before your grip gives out.\nOpen the timer with Level 1 set up: ${level1}\n\nWant a baseline first? Run the max hang test in the timer: ${maxTest}\n\nThe timer and your log stay free, with no account needed.`,
  };
}
