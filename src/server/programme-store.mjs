// D1 persistence for programme progress: one revisioned JSON state per user and programme.
import { parseStoredState } from '../lib/programme-engine.mjs';

export class ProgrammeStoreError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
const missingTable = (error) => /no such table/i.test(String(error?.message || error));
async function guarded(fn) {
  try { return await fn(); }
  catch (error) { if (missingTable(error)) throw new ProgrammeStoreError('programme_unavailable'); throw error; }
}

export async function readProgress(db, userId, programmeId) {
  return guarded(async () => {
    const row = await db.prepare('SELECT revision, state_json FROM programme_progress WHERE user_id = ? AND programme_id = ?').bind(userId, programmeId).first();
    if (!row) return { revision: 0, state: null };
    const state = parseStoredState(row.state_json);
    if (!state) throw new ProgrammeStoreError('programme_state_unreadable', 500);
    return { revision: row.revision, state };
  });
}

/** Writes only when the caller holds the current revision. Returns { ok, revision }. */
export async function writeProgress(db, userId, programmeId, baseRevision, state, now = Date.now()) {
  return guarded(async () => {
    const body = JSON.stringify(state);
    if (body.length > 262144) throw new ProgrammeStoreError('programme_state_too_large', 413);
    const reminder = state?.reminders?.enabled && state.status === 'active' ? 1 : 0;
    const row = baseRevision === 0
      ? await db.prepare(`INSERT INTO programme_progress (user_id, programme_id, revision, state_json, reminder_enabled, updated_at)
          VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(user_id, programme_id) DO NOTHING RETURNING revision`).bind(userId, programmeId, body, reminder, now).first()
      : await db.prepare(`UPDATE programme_progress SET revision = revision + 1, state_json = ?, reminder_enabled = ?, updated_at = ?
          WHERE user_id = ? AND programme_id = ? AND revision = ? RETURNING revision`).bind(body, reminder, now, userId, programmeId, baseRevision).first();
    if (row) return { ok: true, revision: row.revision };
    const current = await db.prepare('SELECT revision FROM programme_progress WHERE user_id = ? AND programme_id = ?').bind(userId, programmeId).first();
    return { ok: false, revision: current?.revision ?? 0 };
  });
}

/** Account export: progress states and purchase status (no payment identifiers). Empty when the tables are not migrated. */
export async function exportProgramme(db, userId) {
  try {
    const progress = (await db.prepare('SELECT programme_id, revision, state_json, updated_at FROM programme_progress WHERE user_id = ?').bind(userId).all()).results
      .map((row) => ({ programmeId: row.programme_id, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString(), state: parseStoredState(row.state_json) }));
    const purchases = (await db.prepare("SELECT programme_id, programme_version, amount, currency, status, created_at, paid_at FROM programme_purchases WHERE user_id = ? AND status <> 'pending' AND status <> 'expired'").bind(userId).all()).results
      .map((row) => ({ programmeId: row.programme_id, version: row.programme_version, amount: row.amount, currency: row.currency, status: row.status, createdAt: new Date(row.created_at * 1000).toISOString(), paidAt: row.paid_at ? new Date(row.paid_at * 1000).toISOString() : null }));
    return { progress, purchases };
  } catch (error) {
    if (missingTable(error)) return { progress: [], purchases: [] };
    throw error;
  }
}

/** Statements for account deletion: progress is personal data and goes; the payment record stays, detached from the person. */
export async function programmeDeletionStatements(db, userId) {
  const tables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('programme_progress', 'programme_purchases', 'programme_reminder_deliveries')").all()).results.map((row) => row.name));
  const statements = [];
  if (tables.has('programme_reminder_deliveries')) statements.push(db.prepare('DELETE FROM programme_reminder_deliveries WHERE user_id = ?').bind(userId));
  if (tables.has('programme_progress')) statements.push(db.prepare('DELETE FROM programme_progress WHERE user_id = ?').bind(userId));
  if (tables.has('programme_purchases')) statements.push(db.prepare('UPDATE programme_purchases SET user_id = NULL WHERE user_id = ?').bind(userId));
  return statements;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INTEREST_CONSENT_VERSION = 'programme-interest-v1';

/** Saves one "email me when it opens" request. Returns { saved: true } only after the row is written, and never says whether the address was already there. */
export async function saveInterest(db, { email, programmeId, source }, now = Math.floor(Date.now() / 1000)) {
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (clean.length > 254 || !EMAIL.test(clean)) throw new ProgrammeStoreError('invalid_email', 400);
  return guarded(async () => {
    await db.prepare(`INSERT INTO programme_interest (email, programme_id, consent_version, source, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(email, programme_id) DO NOTHING`).bind(clean, programmeId, INTEREST_CONSENT_VERSION, source, now).run();
    return { saved: true };
  });
}
