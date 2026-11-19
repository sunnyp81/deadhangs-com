import { complianceFor, footerHtml, footerText, isSuppressed, listId, listUnsubscribeHeaders, senderEmail, sendReadiness, siteOrigin } from '../../src/server/email.mjs';
import { dripEmail, dripLink } from '../../src/server/drip-email.mjs';
import type { D1Database } from '../../src/server/env';

interface Env {
  BREVO_API_KEY?: string;
  EMAIL_CAPTURE_ENABLED?: string;
  EMAIL_LIST_ID?: string;
  UNSUB_SECRET?: string;
  EMAIL_POSTAL_ADDRESS?: string;
  EMAIL_SENDER?: string;
  EMAIL_SENDER_NAME?: string;
  AUTH_BASE_URL?: string;
  DRIP_CRON_SECRET?: string;
  DRIP_ENABLED?: string;
  DB?: D1Database;
}
interface Contact { email: string; emailBlacklisted?: boolean; attributes?: Record<string, string | number>; }
interface Context { request: Request; env: Env; }
const DRIP_DAYS = [3, 10];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function brevo(path: string, env: Env, opts: RequestInit = {}) {
  return fetch('https://api.brevo.com/v3' + path, { ...opts, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY! } });
}
export function nextEmail(contact: Contact, now = Date.now()) {
  if (contact.emailBlacklisted || !contact.email) return -1;
  const value = contact.attributes?.CONSENT_AT;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return -1;
  const signup = Date.parse(value);
  const date = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(signup) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value.slice(0, 10)) return -1;
  const last = String(contact.attributes?.DRIP_LAST_SENT);
  if (!['-1', '0', '1'].includes(last) || now < signup) return -1;
  const next = Number(last) + 1;
  return next < DRIP_DAYS.length && now - signup >= DRIP_DAYS[next] * 86400000 ? next : -1;
}
async function recipientHash(email: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function run({ request, env }: Context, dryRun: boolean) {
  if (!env.DRIP_CRON_SECRET || request.headers.get('x-cron-secret') !== env.DRIP_CRON_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!dryRun && env.DRIP_ENABLED !== 'true') return json({ ok: true, enabled: false, dryRun: false, sent: 0 });
  const blockers: string[] = [];
  if (!env.BREVO_API_KEY) blockers.push('BREVO_API_KEY is missing');
  if (!dryRun) {
    for (const b of sendReadiness(env)) if (!blockers.includes(b)) blockers.push(b);
    if (!env.DB) blockers.push('DB is required for durable drip delivery claims');
  }
  const list = listId(env);
  if (list === null && !blockers.includes('EMAIL_LIST_ID is invalid')) blockers.push('EMAIL_LIST_ID is invalid');
  if (blockers.length) return json({ ok: false, dryRun, ready: false, sent: 0, blockers }, 503);
  let scanned = 0, due = 0, sent = 0, accepted = 0, skipped = 0;
  let pendingSend = false;
  const dueByStep = [0, 0];
  const now = Date.now();
  const recipients = new Set<string>();
  try {
    const limit = 50;
    let offset = Number(new URL(request.url).searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: 'Invalid offset' }, 400);
    while (scanned < 200) {
      const res = await brevo('/contacts/lists/' + list + '/contacts?limit=' + limit + '&offset=' + offset, env);
      if (!res.ok) return json({ error: 'Contact lookup failed', dryRun, sent, accepted }, 502);
      const data = await res.json() as { contacts?: Contact[] };
      if (!Array.isArray(data.contacts) || data.contacts.length > limit) return json({ error: 'Invalid contact response', dryRun, sent, accepted }, 502);
      if (!data.contacts.length) break;
      for (let n = 0; n < data.contacts.length; n++) {
        const contact = data.contacts[n]; scanned++;
        const recipient = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
        if (!recipient || recipients.has(recipient)) { skipped++; continue; }
        recipients.add(recipient);
        const i = nextEmail(contact, now);
        if (i < 0) { skipped++; continue; }
        due++; dueByStep[i]++;
        if (dryRun) continue;
        const db = env.DB!;
        const hash = await recipientHash(contact.email);
        // A unique D1 insert is the send lock, including across simultaneous cron invocations.
        // Claims never expire: an interrupted or timed-out send needs human reconciliation.
        const claim = await db.prepare("INSERT INTO drip_deliveries (recipient_hash, step, status, claimed_at) VALUES (?, ?, 'claimed', ?) ON CONFLICT DO NOTHING").bind(hash, i, new Date(now).toISOString()).run();
        if (claim.meta.changes !== 1) {
          const existing = await db.prepare('SELECT status FROM drip_deliveries WHERE recipient_hash = ? AND step = ?').bind(hash, i).first<{ status: string }>();
          if (existing?.status !== 'complete') return json({ error: 'Existing delivery claim requires review before retrying', dryRun, sent, accepted, reviewRequired: true }, 502);
          skipped++; continue;
        }
        pendingSend = true;
        const c = await complianceFor(env, contact.email);
        c.url = dripLink(c.url, siteOrigin(env), i);
        c.headers = listUnsubscribeHeaders(c.url, senderEmail(env));
        const copy = dripEmail(siteOrigin(env), i);
        const sender = { email: senderEmail(env), name: env.EMAIL_SENDER_NAME || 'DeadHangs' };
        // Check the current opt-out immediately before contacting the send endpoint.
        if (await isSuppressed(env.BREVO_API_KEY!, contact.email, true)) {
          await db.prepare("DELETE FROM drip_deliveries WHERE recipient_hash = ? AND step = ? AND status = 'claimed'").bind(hash, i).run();
          pendingSend = false;
          skipped++; due--; dueByStep[i]--; continue;
        }
        const delivery = await brevo('/smtp/email', env, { method: 'POST', body: JSON.stringify({ sender, replyTo: sender, to: [{ email: contact.email }], subject: copy.subject, htmlContent: copy.bodyHtml + footerHtml(c.url, c.postal), textContent: copy.bodyText + footerText(c.url, c.postal), headers: c.headers }) });
        if (!delivery.ok) return json({ error: 'Email provider rejected send; delivery claim retained for review', dryRun, sent, accepted, reviewRequired: true }, 502);
        accepted++;
        await db.prepare("UPDATE drip_deliveries SET status = 'accepted' WHERE recipient_hash = ? AND step = ?").bind(hash, i).run();
        const update = await brevo('/contacts/' + encodeURIComponent(contact.email), env, { method: 'PUT', body: JSON.stringify({ attributes: { DRIP_LAST_SENT: String(i) } }) });
        if (!update.ok) return json({ error: 'Send accepted but progress update failed; investigate before retrying', dryRun, sent, accepted, reviewRequired: true }, 502);
        await db.prepare("UPDATE drip_deliveries SET status = 'complete' WHERE recipient_hash = ? AND step = ?").bind(hash, i).run();
        pendingSend = false;
        sent++;
        if (sent >= 15) return json({ ok: true, enabled: true, dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: true, nextOffset: offset + n + 1 });
      }
      offset += data.contacts.length;
      if (data.contacts.length < limit) return json({ ok: true, enabled: env.DRIP_ENABLED === 'true', dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: false, nextOffset: null });
    }
    return json({ ok: true, enabled: env.DRIP_ENABLED === 'true', dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: scanned >= 200, nextOffset: scanned >= 200 ? offset : null });
  } catch { return json({ error: 'Email service or delivery ledger unavailable', dryRun, sent, accepted, reviewRequired: pendingSend || accepted > sent }, 502); }
}

// GET is always read-only. Sending requires POST, a dedicated secret and explicit enablement.
export const onRequestGet = (context: Context) => run(context, true);
export const onRequestPost = (context: Context) => run(context, false);
