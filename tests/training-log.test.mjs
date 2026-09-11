import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ENTRIES,
  CSV_FIELDS,
  addEntry,
  bestByAssistance,
  csvFilename,
  formatLocalDate,
  isCalendarDate,
  makeEntryId,
  normalizeStoredEntry,
  parseIntStrict,
  parseStoredLog,
  removeEntry,
  serializeLog,
  sortEntries,
  toCsv,
  toLocalDateString,
  validateEntryInput,
} from '../src/lib/training-log.mjs';

const TODAY = '2026-09-11';

function entry(over = {}) {
  return { id: 'a1', date: '2026-09-10', seconds: 42, assistance: 'unassisted', sets: 3, ...over };
}

test('toLocalDateString uses local calendar fields, not UTC', () => {
  // 1 Jan local, late evening — toISOString() would report 2026-01-02 east of UTC.
  const d = new Date(2026, 0, 1, 23, 30, 0);
  assert.equal(toLocalDateString(d), '2026-01-01');
});

test('formatLocalDate does not shift the day', () => {
  const formatted = formatLocalDate('2026-03-01');
  assert.match(formatted, /1/);
  assert.ok(!/28|29/.test(formatted), `unexpected off-by-one: ${formatted}`);
  assert.equal(formatLocalDate('not-a-date'), '—');
});

test('isCalendarDate rejects impossible dates', () => {
  assert.ok(isCalendarDate('2026-02-28'));
  assert.ok(isCalendarDate('2024-02-29'));
  assert.ok(!isCalendarDate('2026-02-30'));
  assert.ok(!isCalendarDate('2026-13-01'));
  assert.ok(!isCalendarDate('2026-1-1'));
  assert.ok(!isCalendarDate(''));
  assert.ok(!isCalendarDate(20260101));
});

test('parseIntStrict rejects NaN, floats and junk', () => {
  assert.equal(parseIntStrict('30'), 30);
  assert.equal(parseIntStrict('-5'), -5);
  assert.equal(parseIntStrict(''), null);
  assert.equal(parseIntStrict('30.5'), null);
  assert.equal(parseIntStrict('30s'), null);
  assert.equal(parseIntStrict('NaN'), null);
  assert.equal(parseIntStrict(Number.NaN), null);
  assert.equal(parseIntStrict(undefined), null);
});

test('validateEntryInput accepts a clean submission', () => {
  const res = validateEntryInput(
    { date: '2026-09-11', seconds: '55', assistance: 'feet-supported', sets: '4' },
    TODAY,
  );
  assert.ok(res.ok);
  assert.deepEqual(res.value, {
    date: '2026-09-11',
    seconds: 55,
    assistance: 'feet-supported',
    sets: 4,
  });
});

test('validateEntryInput rejects future dates', () => {
  const res = validateEntryInput(
    { date: '2026-09-12', seconds: '30', assistance: 'unassisted', sets: '3' },
    TODAY,
  );
  assert.ok(!res.ok);
  assert.ok(res.errors.some((e) => /future/i.test(e)));
  assert.equal(res.value, null);
});

test('validateEntryInput rejects negative, zero, NaN and out-of-range values', () => {
  const bad = validateEntryInput(
    { date: '2026-09-10', seconds: '-10', assistance: 'unassisted', sets: '0' },
    TODAY,
  );
  assert.ok(!bad.ok);
  assert.equal(bad.errors.length, 2);

  const nan = validateEntryInput(
    { date: '2026-09-10', seconds: 'abc', assistance: 'unassisted', sets: '3' },
    TODAY,
  );
  assert.ok(!nan.ok);

  const huge = validateEntryInput(
    { date: '2026-09-10', seconds: '3601', assistance: 'unassisted', sets: '21' },
    TODAY,
  );
  assert.ok(!huge.ok);
  assert.equal(huge.errors.length, 2);
});

test('validateEntryInput rejects unknown assistance types and missing input', () => {
  const res = validateEntryInput(
    { date: '2026-09-10', seconds: '30', assistance: 'weighted', sets: '3' },
    TODAY,
  );
  assert.ok(!res.ok);
  assert.ok(res.errors.some((e) => /assistance/i.test(e)));
  assert.ok(!validateEntryInput(undefined, TODAY).ok);
});

test('validateEntryInput ignores any extra fields such as identifiers', () => {
  const res = validateEntryInput(
    { date: '2026-09-10', seconds: '30', assistance: 'unassisted', sets: '3', email: 'a@b.c', name: 'Sam' },
    TODAY,
  );
  assert.ok(res.ok);
  assert.deepEqual(Object.keys(res.value).sort(), ['assistance', 'date', 'seconds', 'sets']);
});

test('normalizeStoredEntry validates shape and strips unknown fields', () => {
  assert.deepEqual(normalizeStoredEntry({ ...entry(), extra: 'x' }, TODAY), entry());
  assert.equal(normalizeStoredEntry(null, TODAY), null);
  assert.equal(normalizeStoredEntry([], TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), id: 1 }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), seconds: '42' }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), seconds: Number.NaN }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), seconds: -1 }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), seconds: 12.5 }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), sets: 0 }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), date: '2026-09-12' }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), date: '1999-12-31' }, TODAY), null);
  assert.equal(normalizeStoredEntry({ ...entry(), assistance: 'banded' }, TODAY), null);
});

test('parseStoredLog treats absent and empty storage as empty', () => {
  for (const raw of [null, undefined, '', '[]']) {
    const res = parseStoredLog(raw, TODAY);
    assert.equal(res.status, 'empty');
    assert.deepEqual(res.entries, []);
  }
});

test('parseStoredLog reports malformed JSON as corrupt without data loss', () => {
  const res = parseStoredLog('{not json', TODAY);
  assert.equal(res.status, 'corrupt');
  assert.deepEqual(res.entries, []);
});

test('parseStoredLog reports wrong top-level shape as corrupt', () => {
  assert.equal(parseStoredLog('{"a":1}', TODAY).status, 'corrupt');
  assert.equal(parseStoredLog('"string"', TODAY).status, 'corrupt');
  assert.equal(parseStoredLog('42', TODAY).status, 'corrupt');
});

test('parseStoredLog protects a partly malformed log from ordinary writes', () => {
  const raw = JSON.stringify([entry({ id: 'a' }), { junk: true }, entry({ id: 'b', seconds: -4 })]);
  const res = parseStoredLog(raw, TODAY);
  assert.equal(res.status, 'corrupt');
  assert.equal(res.entries.length, 0);
  assert.equal(res.dropped, 2);
});

test('parseStoredLog requires recovery for duplicate ids', () => {
  const raw = JSON.stringify([entry({ id: 'dup' }), entry({ id: 'dup', seconds: 50 })]);
  const res = parseStoredLog(raw, TODAY);
  assert.equal(res.status, 'corrupt');
  assert.equal(res.entries.length, 0);
  assert.equal(res.dropped, 1);
});

test('parseStoredLog is corrupt when an array holds no readable rows', () => {
  const res = parseStoredLog(JSON.stringify([{ junk: true }, 5]), TODAY);
  assert.equal(res.status, 'corrupt');
  assert.equal(res.dropped, 2);
});

test('parseStoredLog protects oversized logs from silent truncation', () => {
  const many = Array.from({ length: MAX_ENTRIES + 25 }, (_, i) =>
    entry({ id: `id-${i}`, seconds: (i % 300) + 1 }));
  const res = parseStoredLog(JSON.stringify(many), TODAY);
  assert.equal(res.status, 'corrupt');
  assert.equal(res.entries.length, 0);
  assert.equal(res.dropped, 25);
});

test('addEntry refuses to exceed the cap', () => {
  const full = Array.from({ length: MAX_ENTRIES }, (_, i) => entry({ id: `id-${i}` }));
  const res = addEntry(full, entry({ id: 'new' }));
  assert.ok(!res.ok);
  assert.equal(res.reason, 'full');
  assert.equal(res.entries.length, MAX_ENTRIES);
  assert.ok(!res.entries.some((e) => e.id === 'new'));

  const room = addEntry(full.slice(0, MAX_ENTRIES - 1), entry({ id: 'new' }));
  assert.ok(room.ok);
  assert.equal(room.entries.length, MAX_ENTRIES);
});

test('sortEntries orders newest first', () => {
  const sorted = sortEntries([
    entry({ id: 'a', date: '2026-01-01' }),
    entry({ id: 'b', date: '2026-05-01' }),
    entry({ id: 'c', date: '2026-03-01' }),
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ['b', 'c', 'a']);
});

test('removeEntry removes only the targeted id', () => {
  const list = [entry({ id: 'a' }), entry({ id: 'b' })];
  assert.deepEqual(removeEntry(list, 'a').map((e) => e.id), ['b']);
  assert.equal(removeEntry(list, 'missing').length, 2);
});

test('bestByAssistance never mixes assistance types', () => {
  const best = bestByAssistance([
    entry({ id: 'a', assistance: 'unassisted', seconds: 30 }),
    entry({ id: 'b', assistance: 'feet-supported', seconds: 120 }),
    entry({ id: 'c', assistance: 'unassisted', seconds: 45 }),
    entry({ id: 'd', assistance: 'feet-supported', seconds: 90 }),
  ]);
  assert.equal(best.unassisted.seconds, 45);
  assert.equal(best['feet-supported'].seconds, 120);
});

test('bestByAssistance returns null for a type with no entries', () => {
  const best = bestByAssistance([entry({ assistance: 'unassisted', seconds: 30 })]);
  assert.equal(best['feet-supported'], null);
  assert.deepEqual(bestByAssistance([]), { unassisted: null, 'feet-supported': null });
});

test('serializeLog writes only the fixed fields and round-trips', () => {
  const text = serializeLog([{ ...entry(), secret: 'nope' }]);
  assert.ok(!text.includes('secret'));
  const back = parseStoredLog(text, TODAY);
  assert.equal(back.status, 'ok');
  assert.deepEqual(back.entries, [entry()]);
});

test('toCsv emits fixed headers and one row per entry', () => {
  const csv = toCsv([entry({ id: 'a', date: '2026-02-01', seconds: 30 }), entry({ id: 'b', date: '2026-03-01', seconds: 40 })]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], CSV_FIELDS.join(','));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '2026-03-01,40,unassisted,3');
});

test('toCsv ignores extra object fields and neutralises formula injection', () => {
  const csv = toCsv([{ ...entry(), assistance: '=cmd()', note: 'leaked' }]);
  assert.ok(!csv.includes('leaked'));
  assert.ok(csv.includes("'=cmd()"));
});

test('toCsv on an empty log is just the header', () => {
  assert.equal(toCsv([]), `${CSV_FIELDS.join(',')}\r\n`);
});

test('makeEntryId never collides with existing ids', () => {
  const existing = [entry({ id: 'e-0' }), entry({ id: 'e-1' })];
  const stuck = makeEntryId(existing, () => 0);
  assert.ok(!existing.some((e) => e.id === stuck));
  assert.equal(typeof stuck, 'string');
  assert.ok(stuck.length > 0);
});

test('csvFilename is local-dated', () => {
  assert.equal(csvFilename(TODAY), 'deadhangs-training-log-2026-09-11.csv');
});
