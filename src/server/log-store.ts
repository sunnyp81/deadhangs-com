import type { D1Database } from './env';
import { CLOUD_SCHEMA_VERSION, type CloudEntry } from './training-log-validate';

export interface StoredLog {
  exists: boolean;
  revision: number;
  updatedAt: string | null;
  createdAt: string | null;
  entries: CloudEntry[];
}

type Row = { revision: number; cleared: number; entries_json: string; entry_count: number; created_at: number; updated_at: number };
type Written = { revision: number; updated_at: number; entry_count: number };
export type WriteResult = { ok: true; revision: number; updatedAt: string; count: number } | { ok: false; revision: number };

const iso = (ms: number | null | undefined) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

export async function readLog(db: D1Database, userId: string): Promise<StoredLog> {
  const row = await db.prepare('SELECT revision, cleared, entries_json, entry_count, created_at, updated_at FROM training_log WHERE user_id = ?').bind(userId).first<Row>();
  if (!row) return { exists: false, revision: 0, updatedAt: null, createdAt: null, entries: [] };
  const entries = row.cleared ? [] : (JSON.parse(row.entries_json) as CloudEntry[]);
  return { exists: !row.cleared, revision: row.revision, updatedAt: iso(row.updated_at), createdAt: iso(row.created_at), entries };
}

export async function currentRevision(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT revision FROM training_log WHERE user_id = ?').bind(userId).first<{ revision: number }>();
  return row?.revision ?? 0;
}

const written = (row: Written | null | undefined): WriteResult | null =>
  row ? { ok: true, revision: row.revision, updatedAt: iso(row.updated_at)!, count: row.entry_count } : null;

/** Replaces the snapshot only when the caller holds the current revision (single conditional statement). */
export async function writeLog(db: D1Database, userId: string, baseRevision: number, entries: CloudEntry[], now = Date.now()): Promise<WriteResult> {
  const body = JSON.stringify(entries);
  let row: Written | null;
  if (baseRevision === 0) {
    row = await db.prepare(
      `INSERT INTO training_log (user_id, schema_version, revision, cleared, entry_count, entries_json, created_at, updated_at)
       VALUES (?, ?, 1, 0, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING
       RETURNING revision, updated_at, entry_count`,
    ).bind(userId, CLOUD_SCHEMA_VERSION, entries.length, body, now, now).first<Written>();
  } else {
    row = await db.prepare(
      `UPDATE training_log SET revision = revision + 1, cleared = 0, schema_version = ?, entry_count = ?, entries_json = ?, updated_at = ?
       WHERE user_id = ? AND revision = ?
       RETURNING revision, updated_at, entry_count`,
    ).bind(CLOUD_SCHEMA_VERSION, entries.length, body, now, userId, baseRevision).first<Written>();
  }
  return written(row) ?? { ok: false, revision: await currentRevision(db, userId) };
}

/** First upload only. A previously cleared log must use a revision-checked PUT. */
export async function importLog(db: D1Database, userId: string, entries: CloudEntry[], now = Date.now()): Promise<WriteResult> {
  const body = JSON.stringify(entries);
  const row = await db.prepare(
    `INSERT INTO training_log (user_id, schema_version, revision, cleared, entry_count, entries_json, created_at, updated_at)
     VALUES (?, ?, 1, 0, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING
     RETURNING revision, updated_at, entry_count`,
  ).bind(userId, CLOUD_SCHEMA_VERSION, entries.length, body, now, now).first<Written>();
  return written(row) ?? { ok: false, revision: await currentRevision(db, userId) };
}

/** Clears cloud entries, keeping a tombstone so revisions are never reused. */
export async function clearLog(db: D1Database, userId: string, baseRevision: number, now = Date.now()): Promise<WriteResult> {
  if (baseRevision === 0) {
    const row = await db.prepare(
      `INSERT INTO training_log (user_id, schema_version, revision, cleared, entry_count, entries_json, created_at, updated_at)
       VALUES (?, ?, 1, 1, 0, '[]', ?, ?) ON CONFLICT(user_id) DO NOTHING
       RETURNING revision, updated_at, entry_count`,
    ).bind(userId, CLOUD_SCHEMA_VERSION, now, now).first<Written>();
    return written(row) ?? { ok: false, revision: await currentRevision(db, userId) };
  }
  const row = await db.prepare(
    `UPDATE training_log SET revision = revision + 1, cleared = 1, entry_count = 0, entries_json = '[]', updated_at = ?
     WHERE user_id = ? AND revision = ?
     RETURNING revision, updated_at, entry_count`,
  ).bind(now, userId, baseRevision).first<Written>();
  return written(row) ?? { ok: false, revision: await currentRevision(db, userId) };
}

/** Removes every row owned by the user in one batch (D1 runs a batch as a single transaction). */
export async function deleteAccountData(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM training_log WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(userId),
    db.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(userId),
    db.prepare('DELETE FROM "user" WHERE "id" = ?').bind(userId),
  ]);
}

export async function deleteSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(userId).run();
}
