// Optional programme training reminders. Sending is off unless PROGRAMME_REMINDERS_ENABLED === 'true' and every
// email readiness gate passes. Preferences, pause, access and account existence are re-read at send time.
// Reminders only ever say a session is available; they never push extra or daily maximal work.
import { parseStoredState, nextStep } from '../lib/programme-engine.mjs';
import { sendReadiness, siteOrigin } from './email.mjs';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Local weekday, date and hour:minute for an instant in an IANA timezone. DST is handled by Intl. */
export function localParts(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), weekday: parts.weekday.slice(0, 3).toLowerCase() };
}

/**
 * Due when reminders are on, today is a chosen day in the person's timezone and the run falls in the chosen hour.
 * The cron is expected hourly; the delivery claim makes any extra run harmless.
 */
export function reminderDue(reminders, instant) {
  if (!reminders?.enabled || !Array.isArray(reminders.days) || !reminders.days.length) return null;
  let local;
  try { local = localParts(instant, reminders.timezone); } catch { return null; }
  if (!DAY_KEYS.includes(local.weekday) || !reminders.days.includes(local.weekday)) return null;
  const [hour] = String(reminders.localTime || '').split(':').map(Number);
  return local.hour === hour ? { localDate: local.date } : null;
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { key, sig: new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))) };
}

/** Signed one-click "turn reminders off" link. Works whether or not the address is a newsletter contact. */
export async function reminderOffUrl(env, userId) {
  const { sig } = await hmac(env.UNSUB_SECRET, `deadhangs:reminders-off:${userId}`);
  return `${siteOrigin(env)}/api/programme/reminders-off?u=${encodeURIComponent(b64url(enc.encode(userId)))}&s=${b64url(sig)}`;
}

/** Returns the user id for a valid signed link, else null. */
export async function readReminderOff(env, u, s) {
  if (typeof env.UNSUB_SECRET !== 'string' || env.UNSUB_SECRET.length < 32 || typeof u !== 'string' || typeof s !== 'string' || u.length > 200 || s.length > 100) return null;
  let userId;
  try { userId = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); } catch { return null; }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  let given;
  try { given = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); } catch { return null; }
  const key = await crypto.subtle.importKey('raw', enc.encode(env.UNSUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return (await crypto.subtle.verify('HMAC', key, given, enc.encode(`deadhangs:reminders-off:${userId}`))) ? userId : null;
}

/** Turns reminders off for every programme the person has, in both the flag column and the stored state. */
export async function turnRemindersOff(db, userId, now = Date.now()) {
  // One statement per person: no read-modify-write, so a progress save at the same moment is never lost.
  // The revision moves on, so a device holding the old revision re-reads before its next write.
  const result = await db.prepare(`UPDATE programme_progress SET reminder_enabled = 0,
      state_json = CASE WHEN json_type(state_json, '$.reminders') = 'object' THEN json_set(state_json, '$.reminders.enabled', json('false')) ELSE state_json END,
      revision = revision + 1, updated_at = ? WHERE user_id = ?`).bind(now, userId).run();
  return result.meta.changes;
}

export function reminderEmail({ origin, offUrl, sessionTitle, restDayReminder }) {
  const app = `${origin}/programme/app/`;
  const subject = 'Your next DeadHangs session is ready';
  const lines = [
    `Your next session${sessionTitle ? `, ${sessionTitle},` : ''} is ready when you are.`,
    restDayReminder ? 'If you trained yesterday, the plan asks for a rest day between sessions, so another day is fine.' : 'If today does not suit you, nothing changes: the programme waits for you.',
    'Stop and step down under control if anything hurts.',
  ];
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    subject,
    bodyText: `${lines.join('\n\n')}\n\nOpen your programme: ${app}\n\nYou asked for these reminders. Turn them off in one click: ${offUrl}\n`,
    bodyHtml: `${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p><a href="${app}">Open your programme</a></p><p style="font-size:13px">You asked for these reminders. <a href="${offUrl}">Turn reminders off</a>.</p>`,
  };
}

/**
 * One cron pass. `deps.send(env, message)` is the compliant sender (sendCompliantEmail), `deps.rules` the plan rules,
 * `deps.copy` the programme copy, `deps.hasAccess(userId)` the entitlement check. Returns counts, never addresses.
 */
export async function dispatchReminders(env, deps, instant = new Date()) {
  const counts = { candidates: 0, due: 0, sent: 0, skipped: 0, failed: 0, alreadyClaimed: 0 };
  if (env.PROGRAMME_REMINDERS_ENABLED !== 'true') return { ...counts, off: true };
  if (sendReadiness(env).length) return { ...counts, off: true, notReady: true };
  const rows = (await env.DB.prepare(`SELECT g.user_id, g.programme_id, g.state_json, u.email FROM programme_progress g JOIN "user" u ON u.id = g.user_id
    WHERE g.reminder_enabled = 1`).all()).results;
  counts.candidates = rows.length;
  for (const row of rows) {
    const state = parseStoredState(row.state_json);
    const due = state && state.status === 'active' ? reminderDue(state.reminders, instant) : null;
    if (!due) continue;
    counts.due += 1;
    const claim = await env.DB.prepare("INSERT INTO programme_reminder_deliveries (user_id, local_date, status, claimed_at) VALUES (?, ?, 'claimed', ?) ON CONFLICT DO NOTHING")
      .bind(row.user_id, due.localDate, Math.floor(instant.getTime() / 1000)).run();
    if (claim.meta.changes !== 1) { counts.alreadyClaimed += 1; continue; }
    const mark = (status) => env.DB.prepare('UPDATE programme_reminder_deliveries SET status = ? WHERE user_id = ? AND local_date = ?').bind(status, row.user_id, due.localDate).run();
    // Re-read right before sending: the person may have paused, turned reminders off or lost access since the scan.
    try {
    const fresh = await env.DB.prepare('SELECT state_json, reminder_enabled FROM programme_progress WHERE user_id = ? AND programme_id = ?').bind(row.user_id, row.programme_id).first();
    const current = fresh && parseStoredState(fresh.state_json);
    const stillDue = current && current.status === 'active' ? reminderDue(current.reminders, instant) : null;
    if (!fresh || fresh.reminder_enabled !== 1 || !stillDue || stillDue.localDate !== due.localDate || !(await deps.hasAccess(row.user_id, row.programme_id))) {
      await mark('skipped'); counts.skipped += 1; continue;
    }
    const step = nextStep(current, deps.rules);
    if (step.type !== 'session') { await mark('skipped'); counts.skipped += 1; continue; }
    const offUrl = await reminderOffUrl(env, row.user_id);
    const message = reminderEmail({ origin: siteOrigin(env), offUrl, sessionTitle: deps.copy?.[current.route]?.[step.session.key]?.title || '', restDayReminder: true });
    const result = await deps.send(env, { email: row.email, ...message, unsubscribeUrl: offUrl, footer: 'reminders' });
    if (result.sent) { await mark('sent'); counts.sent += 1; } else { await mark(result.reason === 'suppressed' ? 'skipped' : 'failed'); counts[result.reason === 'suppressed' ? 'skipped' : 'failed'] += 1; }
    } catch {
      // One person's failure never stops the batch; the claim stays so a timeout cannot cause a second send.
      await mark('failed').catch(() => {}); counts.failed += 1;
    }
  }
  return counts;
}
