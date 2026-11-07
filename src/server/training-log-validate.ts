import { normalizeStoredEntry } from '../lib/training-log.mjs';

export const CLOUD_SCHEMA_VERSION = 2;
export const ENTRY_KEYS = ['id', 'date', 'seconds', 'assistance', 'sets', 'kind', 'bar', 'grip', 'chalk', 'load', 'loadUnit', 'ended', 'bodyweightKg'] as const;
const ALLOWED = new Set<string>(ENTRY_KEYS);

export type CloudEntry = Record<string, unknown> & { id: string };
export type EntriesResult =
  | { ok: true; entries: CloudEntry[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Latest calendar date anywhere on Earth (UTC+14), so no user's "today" is rejected as future. */
export function latestCalendarDate(now = Date.now()): string {
  return new Date(now + 14 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Validates a whole snapshot. Rejects rather than drops or truncates anything. */
export function validateEntries(input: unknown, maxEntries: number, today = latestCalendarDate()): EntriesResult {
  if (!Array.isArray(input)) return { ok: false, status: 400, body: { error: 'invalid_entries', message: 'entries must be an array.' } };
  if (input.length > maxEntries) return { ok: false, status: 422, body: { error: 'too_many_entries', maxEntries, count: input.length } };
  const seen = new Set<string>();
  const entries: CloudEntry[] = [];
  for (let index = 0; index < input.length; index++) {
    const raw = input[index];
    const fail = (message: string): EntriesResult => ({ ok: false, status: 400, body: { error: 'invalid_entries', index, message } });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return fail('Entry must be an object.');
    const unknown = Object.keys(raw).find((key) => !ALLOWED.has(key));
    if (unknown !== undefined) return fail('Unknown field.');
    const entry = normalizeStoredEntry(raw, today) as CloudEntry | null;
    if (!entry) return fail('Entry has invalid values or a future date.');
    if (seen.has(entry.id)) return fail('Duplicate entry id.');
    seen.add(entry.id);
    entries.push(entry);
  }
  return { ok: true, entries };
}
