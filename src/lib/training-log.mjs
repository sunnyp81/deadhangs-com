/**
 * training-log.mjs — pure helpers for the DeadHangs on-device training log.
 *
 * Everything here is browser-free and side-effect-free so it can be unit tested
 * with node:test. The component owns localStorage access; this module only
 * validates, normalises, serialises and exports.
 *
 * Entry shape (the ONLY fields ever stored or exported):
 *   { id: string, date: 'YYYY-MM-DD', seconds: int, assistance: string, sets: int }
 * No names, emails, ages, weights or any other identifier is accepted.
 */

export const STORAGE_KEY = 'dh.training-log.v1';

/** Hard cap so a single localStorage key can never grow unbounded. */
export const MAX_ENTRIES = 200;

/** The only assistance values we accept. Best times never mix across these. */
export const ASSISTANCE_TYPES = ['unassisted', 'feet-supported'];

export const ASSISTANCE_LABELS = {
  unassisted: 'Unassisted',
  'feet-supported': 'Feet supported',
};

export const MIN_SECONDS = 1;
export const MAX_SECONDS = 3600;
export const MIN_SETS = 1;
export const MAX_SETS = 20;

/** Nothing before this counts as a plausible log date. */
export const MIN_DATE = '2000-01-01';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Local calendar date as 'YYYY-MM-DD'. Deliberately not toISOString(), which
 * shifts to UTC and can report yesterday/tomorrow depending on the timezone.
 */
export function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True only for a real calendar date in 'YYYY-MM-DD' form (rejects 2025-02-30). */
export function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Formats a stored date for display in the user's local calendar, no UTC shift. */
export function formatLocalDate(value) {
  if (!isCalendarDate(value)) return '—';
  const [y, mo, d] = value.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isInt(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Coerces a form string to an integer, or null when it is not a clean integer. */
export function parseIntStrict(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Validates raw form input. Returns { ok, errors, value } where `value` is the
 * entry without an id (the caller assigns one).
 * `today` is the local date string used as the future-date ceiling.
 */
export function validateEntryInput(input, today = toLocalDateString()) {
  const errors = [];
  const raw = input || {};

  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  if (!isCalendarDate(date)) {
    errors.push('Enter a valid date.');
  } else if (date > today) {
    errors.push('Date cannot be in the future.');
  } else if (date < MIN_DATE) {
    errors.push(`Date cannot be before ${MIN_DATE}.`);
  }

  const seconds = parseIntStrict(raw.seconds);
  if (seconds === null) {
    errors.push('Best hold must be a whole number of seconds.');
  } else if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    errors.push(`Best hold must be between ${MIN_SECONDS} and ${MAX_SECONDS} seconds.`);
  }

  const assistance = typeof raw.assistance === 'string' ? raw.assistance : '';
  if (!ASSISTANCE_TYPES.includes(assistance)) {
    errors.push('Choose an assistance type.');
  }

  const sets = parseIntStrict(raw.sets);
  if (sets === null) {
    errors.push('Sets must be a whole number.');
  } else if (sets < MIN_SETS || sets > MAX_SETS) {
    errors.push(`Sets must be between ${MIN_SETS} and ${MAX_SETS}.`);
  }

  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors, value: { date, seconds, assistance, sets } };
}

/**
 * Validates a single entry read back from storage. Returns the cleaned entry or
 * null. Unknown fields are dropped rather than trusted.
 */
export function normalizeStoredEntry(raw, today = toLocalDateString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return null;
  if (!isCalendarDate(raw.date) || raw.date > today || raw.date < MIN_DATE) return null;
  if (!isInt(raw.seconds, MIN_SECONDS, MAX_SECONDS)) return null;
  if (!ASSISTANCE_TYPES.includes(raw.assistance)) return null;
  if (!isInt(raw.sets, MIN_SETS, MAX_SETS)) return null;
  return { id: raw.id, date: raw.date, seconds: raw.seconds, assistance: raw.assistance, sets: raw.sets };
}

/**
 * Parses the raw localStorage string.
 * status: 'empty'   — nothing stored yet
 *         'ok'      — usable entries (`dropped` counts skipped bad rows)
 *         'corrupt' — unreadable; the caller must NOT overwrite it silently
 */
export function parseStoredLog(rawText, today = toLocalDateString()) {
  if (rawText === null || rawText === undefined || rawText === '') {
    return { status: 'empty', entries: [], dropped: 0 };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { status: 'corrupt', entries: [], dropped: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { status: 'corrupt', entries: [], dropped: 0 };
  }
  if (parsed.length === 0) {
    return { status: 'empty', entries: [], dropped: 0 };
  }

  const entries = [];
  const seenIds = new Set();
  let dropped = 0;
  for (const item of parsed) {
    const entry = normalizeStoredEntry(item, today);
    if (!entry || seenIds.has(entry.id)) {
      dropped += 1;
      continue;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  }
  if (entries.length === 0) {
    // Something is stored but none of it is readable — surface it, don't erase it.
    return { status: 'corrupt', entries: [], dropped };
  }
  // Preserve questionable data for explicit recovery rather than overwriting a
  // filtered or truncated view on the next ordinary save.
  if (dropped || entries.length > MAX_ENTRIES) return { status: 'corrupt', entries: [], dropped: dropped + Math.max(0, entries.length - MAX_ENTRIES) };
  return { status: 'ok', entries, dropped };
}

/** Newest date first; ties broken by longer hold, then id for stability. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.seconds !== b.seconds) return b.seconds - a.seconds;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function serializeLog(entries) {
  return JSON.stringify(
    entries.map((e) => ({
      id: e.id,
      date: e.date,
      seconds: e.seconds,
      assistance: e.assistance,
      sets: e.sets,
    })),
  );
}

/** Returns an id not already present in `entries`. */
export function makeEntryId(entries, random = Math.random) {
  const used = new Set(entries.map((e) => e.id));
  for (let i = 0; i < 50; i += 1) {
    const id = `e${Date.now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
    if (!used.has(id)) return id;
  }
  let n = 0;
  while (used.has(`e-${n}`)) n += 1;
  return `e-${n}`;
}

/**
 * Adds an entry, enforcing the cap. When full nothing is added and the caller
 * is expected to tell the user to export first.
 */
export function addEntry(entries, entry) {
  if (entries.length >= MAX_ENTRIES) {
    return { ok: false, reason: 'full', entries };
  }
  return { ok: true, reason: null, entries: sortEntries([...entries, entry]) };
}

export function removeEntry(entries, id) {
  return entries.filter((e) => e.id !== id);
}

/**
 * Best hold per assistance type. Types are kept strictly separate — a
 * feet-supported hold is never compared against an unassisted one.
 */
export function bestByAssistance(entries) {
  const best = {};
  for (const type of ASSISTANCE_TYPES) best[type] = null;
  for (const entry of entries) {
    if (!ASSISTANCE_TYPES.includes(entry.assistance)) continue;
    const current = best[entry.assistance];
    if (!current || entry.seconds > current.seconds) best[entry.assistance] = entry;
  }
  return best;
}

/** Fixed export columns. Nothing else is ever written to CSV. */
export const CSV_FIELDS = ['date', 'best_hold_seconds', 'assistance', 'sets'];

function csvCell(value) {
  let text = String(value);
  // Neutralise spreadsheet formula injection before quoting.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(entries) {
  const rows = [CSV_FIELDS.join(',')];
  for (const entry of sortEntries(entries)) {
    rows.push([
      csvCell(entry.date),
      csvCell(entry.seconds),
      csvCell(entry.assistance),
      csvCell(entry.sets),
    ].join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** Suggested download filename, local-dated. */
export function csvFilename(today = toLocalDateString()) {
  return `deadhangs-training-log-${today}.csv`;
}
