/**
 * training-log.mjs — pure helpers for the DeadHangs on-device training log.
 *
 * Everything here is browser-free and side-effect-free so it can be unit tested
 * with node:test. The component owns localStorage access; this module only
 * validates, normalises, serialises and exports.
 *
 * Entry shape (the ONLY fields ever stored or exported):
 *   { id, date: 'YYYY-MM-DD', seconds: int, assistance, sets: int,
 *     // optional, absent on older entries and never required:
 *     kind?: 'test', bar?, grip?, chalk?: boolean, load?: number, loadUnit?: 'kg'|'lb', ended? }
 * `load` is optional added load on the body, not body weight. No names, emails,
 * ages or any other identifier is accepted.
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

/** Optional setup fields. Stored as slugs; labels are for display only. */
export const BAR_TYPES = ['standard', 'thick', 'thin', 'rings', 'towel', 'other'];
export const BAR_LABELS = {
  standard: 'Standard bar',
  thick: 'Thick bar',
  thin: 'Thin bar',
  rings: 'Rings',
  towel: 'Towel',
  other: 'Other bar',
};
export const BAR_OPTION_LABELS = { ...BAR_LABELS, standard: 'Standard (about 28 to 32 mm)' };
export const GRIP_TYPES = ['overhand', 'underhand', 'mixed', 'neutral'];
export const GRIP_LABELS = { overhand: 'Overhand', underhand: 'Underhand', mixed: 'Mixed', neutral: 'Neutral' };
export const ENDED_TYPES = ['grip-gave-out', 'slipping', 'discomfort', 'chose-to-stop', 'time-goal'];
export const ENDED_LABELS = {
  'grip-gave-out': 'Grip gave out',
  slipping: 'Slipping',
  discomfort: 'Discomfort, so I stopped',
  'chose-to-stop': 'I chose to stop',
  'time-goal': 'Time goal reached',
};
export const LOAD_UNITS = ['kg', 'lb'];
export const MAX_LOAD = 500;
export const KG_PER_LB = 0.45359237;
export const KINDS = ['test'];

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

/** Added load: a plain decimal with at most one place, 0.1 to MAX_LOAD. Returns a number or null. */
export function parseLoad(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 && value <= MAX_LOAD && Math.round(value * 10) === value * 10 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n > 0 && n <= MAX_LOAD ? n : null;
}

/**
 * Validates the optional setup part of the form. Blank means "not recorded".
 * Returns { errors, value } where value holds only the fields that were set.
 */
export function validateSetupInput(input) {
  const raw = input || {};
  const errors = [];
  const value = {};
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  const bar = text(raw.bar);
  if (bar) { if (BAR_TYPES.includes(bar)) value.bar = bar; else errors.push('Choose a bar type from the list.'); }
  const grip = text(raw.grip);
  if (grip) { if (GRIP_TYPES.includes(grip)) value.grip = grip; else errors.push('Choose a grip from the list.'); }
  const chalk = text(raw.chalk);
  if (chalk) { if (chalk === 'yes' || chalk === 'no') value.chalk = chalk === 'yes'; else errors.push('Choose chalk or no chalk.'); }
  const load = text(raw.load);
  if (load) {
    const parsed = parseLoad(load);
    const unit = text(raw.loadUnit) || 'kg';
    if (parsed === null) errors.push(`Added load must be a number from 0.1 to ${MAX_LOAD} with at most one decimal place, or left blank.`);
    else if (!LOAD_UNITS.includes(unit)) errors.push('Choose kg or lb for the added load.');
    else { value.load = parsed; value.loadUnit = unit; }
  }
  const ended = text(raw.ended);
  if (ended) { if (ENDED_TYPES.includes(ended)) value.ended = ended; else errors.push('Choose how the hold ended from the list.'); }
  return { errors, value };
}

/** Keeps only the known fields, in a fixed order, omitting anything unset. */
export function compactEntry(e) {
  const out = { id: e.id, date: e.date, seconds: e.seconds, assistance: e.assistance, sets: e.sets };
  if (e.kind === 'test') out.kind = 'test';
  if (e.bar) out.bar = e.bar;
  if (e.grip) out.grip = e.grip;
  if (typeof e.chalk === 'boolean') out.chalk = e.chalk;
  if (e.load !== undefined && e.load !== null) { out.load = e.load; out.loadUnit = e.loadUnit; }
  if (e.ended) out.ended = e.ended;
  return out;
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

  const setup = validateSetupInput(raw);
  errors.push(...setup.errors);
  const kind = raw.kind === 'test' ? 'test' : undefined;

  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors, value: { date, seconds, assistance, sets, ...(kind ? { kind } : {}), ...setup.value } };
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
  const present = (v) => v !== undefined && v !== null;
  if (present(raw.kind) && !KINDS.includes(raw.kind)) return null;
  if (present(raw.bar) && !BAR_TYPES.includes(raw.bar)) return null;
  if (present(raw.grip) && !GRIP_TYPES.includes(raw.grip)) return null;
  if (present(raw.chalk) && typeof raw.chalk !== 'boolean') return null;
  if (present(raw.ended) && !ENDED_TYPES.includes(raw.ended)) return null;
  if (present(raw.load) || present(raw.loadUnit)) {
    if (parseLoad(raw.load) === null || !LOAD_UNITS.includes(raw.loadUnit)) return null;
  }
  return compactEntry(raw);
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
  return JSON.stringify(entries.map(compactEntry));
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

/* ------------------------------------------------------------------ setups */

/** Added load in kilograms, or 0 when none was recorded. */
export function loadKg(entry) {
  if (entry?.load === undefined || entry?.load === null) return 0;
  return entry.loadUnit === 'lb' ? entry.load * KG_PER_LB : entry.load;
}

/** Load bands are defined in kilograms; pounds are converted first. */
export const LOAD_BANDS = ['none', 'up-to-5', '5-10', '10-20', 'over-20'];
export const LOAD_BAND_LABELS = {
  none: 'No added load',
  'up-to-5': 'Up to 5 kg added',
  '5-10': '5 to 10 kg added',
  '10-20': '10 to 20 kg added',
  'over-20': 'Over 20 kg added',
};
export function loadBand(entry) {
  const kg = loadKg(entry);
  if (kg <= 0) return 'none';
  if (kg <= 5) return 'up-to-5';
  if (kg <= 10) return '5-10';
  if (kg <= 20) return '10-20';
  return 'over-20';
}

/** True when the entry carries any of bar, grip, chalk or load. */
export function hasSetup(entry) {
  return Boolean(entry?.bar || entry?.grip || typeof entry?.chalk === 'boolean' || (entry?.load !== undefined && entry?.load !== null));
}

/**
 * Identity of a setup: bar + grip + chalk + load band + assistance. Each unrecorded
 * field is its own value, so "grip not recorded" never merges with "overhand".
 */
export function setupKey(entry) {
  if (!hasSetup(entry)) return `${entry.assistance}|unrecorded`;
  const chalk = typeof entry.chalk === 'boolean' ? (entry.chalk ? 'chalk' : 'no-chalk') : '?';
  return [entry.assistance, entry.bar || '?', entry.grip || '?', chalk, loadBand(entry)].join('|');
}

export function setupLabel(entry) {
  const assistance = ASSISTANCE_LABELS[entry.assistance] ?? entry.assistance;
  if (!hasSetup(entry)) return `Setup not recorded · ${assistance}`;
  const chalk = typeof entry.chalk === 'boolean' ? (entry.chalk ? 'Chalk' : 'No chalk') : 'Chalk not recorded';
  return [
    entry.bar ? BAR_LABELS[entry.bar] : 'Bar not recorded',
    entry.grip ? GRIP_LABELS[entry.grip] : 'Grip not recorded',
    chalk,
    LOAD_BAND_LABELS[loadBand(entry)],
    assistance,
  ].join(' · ');
}

/** Compact setup text for a table row (assistance is shown in its own column). */
export function setupSummary(entry) {
  if (!hasSetup(entry)) return 'Not recorded';
  const parts = [];
  if (entry.bar) parts.push(BAR_LABELS[entry.bar]);
  if (entry.grip) parts.push(GRIP_LABELS[entry.grip]);
  if (typeof entry.chalk === 'boolean') parts.push(entry.chalk ? 'Chalk' : 'No chalk');
  if (entry.load !== undefined && entry.load !== null) parts.push(`+${entry.load} ${entry.loadUnit}`);
  return parts.join(' · ');
}

/** Short load text for a row, in the unit the user entered. */
export function loadText(entry) {
  if (entry?.load === undefined || entry?.load === null) return '';
  return `${entry.load} ${entry.loadUnit}`;
}

/**
 * Every distinct setup in the log with its own best hold. Never compares across
 * setups and never uses anyone else's data. Sorted by best hold, longest first.
 */
export function bestsBySetup(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = setupKey(entry);
    const group = groups.get(key) ?? { key, label: setupLabel(entry), assistance: entry.assistance, best: null, count: 0 };
    group.count += 1;
    if (!group.best || entry.seconds > group.best.seconds || (entry.seconds === group.best.seconds && entry.date > group.best.date)) group.best = entry;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.best.seconds - a.best.seconds || (a.label < b.label ? -1 : 1));
}

/** Setups present in the log, optionally limited to one assistance type. */
export function listSetups(entries, assistance) {
  return bestsBySetup(entries.filter((e) => !assistance || e.assistance === assistance));
}

/** 'all' (or empty) keeps everything. */
export function filterBySetup(entries, key) {
  if (!key || key === 'all') return entries;
  return entries.filter((e) => setupKey(e) === key);
}

/** Form values copied from a saved entry: the "same setup again" shortcut. */
export function setupFormFromEntry(entry) {
  return {
    assistance: entry.assistance,
    bar: entry.bar ?? '',
    grip: entry.grip ?? '',
    chalk: typeof entry.chalk === 'boolean' ? (entry.chalk ? 'yes' : 'no') : '',
    load: entry.load !== undefined && entry.load !== null ? String(entry.load) : '',
    loadUnit: entry.loadUnit ?? 'kg',
    ended: '',
  };
}

export const EMPTY_SETUP_FORM = { assistance: ASSISTANCE_TYPES[0], bar: '', grip: '', chalk: '', load: '', loadUnit: 'kg', ended: '' };

/** Last-used setup, kept apart from the log so it never touches the entries array. */
export const SETUP_DEFAULT_KEY = 'dh.log-setup.v1';

export function serializeSetupDefault(form) {
  const clean = validateSetupInput({ ...form, ended: '' });
  const assistance = ASSISTANCE_TYPES.includes(form?.assistance) ? form.assistance : ASSISTANCE_TYPES[0];
  return JSON.stringify({ assistance, ...clean.value });
}

/** Returns a form-shaped default, or the empty default when the stored text is unusable. */
export function parseSetupDefault(text) {
  if (typeof text !== 'string' || text === '') return { ...EMPTY_SETUP_FORM };
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_SETUP_FORM };
    const form = {
      assistance: ASSISTANCE_TYPES.includes(raw.assistance) ? raw.assistance : ASSISTANCE_TYPES[0],
      bar: typeof raw.bar === 'string' ? raw.bar : '',
      grip: typeof raw.grip === 'string' ? raw.grip : '',
      chalk: typeof raw.chalk === 'boolean' ? (raw.chalk ? 'yes' : 'no') : '',
      load: raw.load !== undefined && raw.load !== null ? String(raw.load) : '',
      loadUnit: typeof raw.loadUnit === 'string' ? raw.loadUnit : 'kg',
      ended: '',
    };
    return validateSetupInput(form).errors.length ? { ...EMPTY_SETUP_FORM, assistance: form.assistance } : form;
  } catch {
    return { ...EMPTY_SETUP_FORM };
  }
}

/**
 * Pure append used by anything that writes a single new entry (for example the
 * timer's max-attempt test). Refuses rather than overwrite an unreadable or full log.
 */
export function appendToStoredLog(rawText, entry, today = toLocalDateString()) {
  const parsed = parseStoredLog(rawText, today);
  if (parsed.status === 'corrupt') return { ok: false, reason: 'corrupt', text: rawText, entries: [] };
  const clean = normalizeStoredEntry(entry, today);
  if (!clean) return { ok: false, reason: 'invalid', text: rawText, entries: parsed.entries };
  const added = addEntry(parsed.entries, clean);
  if (!added.ok) return { ok: false, reason: 'full', text: rawText, entries: parsed.entries };
  return { ok: true, reason: null, text: serializeLog(added.entries), entries: added.entries, entry: clean };
}

/* -------------------------------------------------------------------- export */

/** Original four columns, still accepted on import. */
export const CSV_FIELDS_V1 = ['date', 'best_hold_seconds', 'assistance', 'sets'];
/** Fixed export columns. Nothing else is ever written to CSV. */
export const CSV_FIELDS = [...CSV_FIELDS_V1, 'entry_type', 'bar', 'grip', 'chalk', 'added_load', 'load_unit', 'hold_ended_by'];

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
    const hasLoad = entry.load !== undefined && entry.load !== null;
    rows.push([
      csvCell(entry.date),
      csvCell(entry.seconds),
      csvCell(entry.assistance),
      csvCell(entry.sets),
      csvCell(entry.kind === 'test' ? 'test' : 'hold'),
      csvCell(entry.bar ?? ''),
      csvCell(entry.grip ?? ''),
      csvCell(typeof entry.chalk === 'boolean' ? (entry.chalk ? 'yes' : 'no') : ''),
      csvCell(hasLoad ? entry.load : ''),
      csvCell(hasLoad ? entry.loadUnit : ''),
      csvCell(entry.ended ?? ''),
    ].join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** Suggested download filename, local-dated. */
export function csvFilename(today = toLocalDateString()) {
  return `deadhangs-training-log-${today}.csv`;
}

/** Portable, versioned backup. Version 2 adds the optional setup fields; version 1 backups still import. */
export const MAX_IMPORT_BYTES = 128 * 1024;
export const BACKUP_VERSION = 2;
export function toBackup(entries) {
  return JSON.stringify({ format: 'deadhangs-training-log', version: BACKUP_VERSION, entries: JSON.parse(serializeLog(entries)) }, null, 2);
}

const INVALID = '\u0000invalid';
function csvEntry(cells, index) {
  const [date, seconds, assistance, sets, type, bar, grip, chalk, load, unit, ended] = cells;
  const entry = { id: 'csv-' + index, date, seconds: parseIntStrict(seconds), assistance, sets: parseIntStrict(sets) };
  if (cells.length === CSV_FIELDS_V1.length) return entry;
  if (type === 'test') entry.kind = 'test';
  else if (type !== 'hold' && type !== '') entry.kind = INVALID;
  if (bar) entry.bar = bar;
  if (grip) entry.grip = grip;
  if (chalk === 'yes') entry.chalk = true;
  else if (chalk === 'no') entry.chalk = false;
  else if (chalk) entry.chalk = INVALID;
  if (load || unit) { entry.load = parseLoad(load) ?? INVALID; entry.loadUnit = unit; }
  if (ended) entry.ended = ended;
  return entry;
}

/** Validate the whole file before proposing a non-destructive merge. */
export function prepareLogImport(text, existing, today = toLocalDateString()) {
  const fail = (error) => ({ ok: false, error, entries: existing, added: 0, skipped: 0 });
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return fail('Choose a backup smaller than 128 KB.');
  const raw = text.replace(/^﻿/, '').trim();
  let imported;
  let csv = false;
  if (raw.startsWith('[') || raw.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return fail('This JSON file could not be read.'); }
    if (Array.isArray(parsed)) imported = parsed;
    else if (parsed?.format === 'deadhangs-training-log' && (parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.entries)) imported = parsed.entries;
    else return fail('Choose a DeadHangs version 1 or 2 backup or exported CSV.');
  } else {
    csv = true;
    const lines = raw.split(/\r?\n/);
    const cell = (s) => /^"[^"]*"$/.test(s) ? s.slice(1, -1) : s;
    const header = lines.shift()?.split(',').map(cell).join(',');
    const width = header === CSV_FIELDS.join(',') ? CSV_FIELDS.length : header === CSV_FIELDS_V1.join(',') ? CSV_FIELDS_V1.length : 0;
    if (!width) return fail('CSV columns must match a DeadHangs export.');
    imported = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split(',').map(cell);
      if (cells.length !== width) return fail('CSV row ' + (i + 2) + ' has the wrong number of columns. Nothing was imported.');
      imported.push(csvEntry(cells, i));
    }
  }
  if (imported.length > MAX_ENTRIES) return fail('This file exceeds the 200-entry limit. Nothing was imported.');
  const validated = imported.map((entry) => normalizeStoredEntry(entry, today));
  const badIndex = validated.findIndex((entry) => !entry);
  if (badIndex >= 0) return fail('Entry ' + (badIndex + 1) + ' has invalid values or a future date. Nothing was imported.');
  const key = (e) => JSON.stringify([e.date, e.seconds, e.assistance, e.sets, e.kind ?? null, e.bar ?? null, e.grip ?? null, e.chalk ?? null, e.load ?? null, e.loadUnit ?? null, e.ended ?? null]);
  const next = [...existing];
  const byId = new Map(next.map(e => [e.id, e]));
  const remaining = new Map();
  for (const e of existing) remaining.set(key(e), (remaining.get(key(e)) || 0) + 1);
  let skipped = 0;
  for (const e of validated) {
    if (csv) {
      const count = remaining.get(key(e)) || 0;
      if (count > 0) { remaining.set(key(e), count - 1); skipped++; continue; }
      e.id = makeEntryId(next);
    } else if (byId.has(e.id)) {
      if (key(byId.get(e.id)) !== key(e)) return fail('A backup entry conflicts with an existing ID. Nothing was changed.');
      skipped++; continue;
    }
    next.push(e); byId.set(e.id, e);
  }
  if (next.length > MAX_ENTRIES) return fail('The merged log would exceed 200 entries. Export your current log and make room first.');
  return { ok: true, error: '', entries: sortEntries(next), added: next.length - existing.length, skipped };
}
