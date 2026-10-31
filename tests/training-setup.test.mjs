import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SETUP_FORM,
  appendToStoredLog,
  bestsBySetup,
  compactEntry,
  filterBySetup,
  listSetups,
  loadBand,
  normalizeStoredEntry,
  parseLoad,
  parseSetupDefault,
  parseStoredLog,
  prepareLogImport,
  serializeLog,
  serializeSetupDefault,
  setupFormFromEntry,
  setupKey,
  setupLabel,
  toBackup,
  toCsv,
  validateEntryInput,
  validateSetupInput,
} from '../src/lib/training-log.mjs';
import { progressFor } from '../src/lib/training-progress.mjs';

const TODAY = '2026-10-31';
const e = (over = {}) => ({ id: 'a1', date: '2026-10-20', seconds: 40, assistance: 'unassisted', sets: 1, ...over });
const full = (over = {}) => e({ bar: 'standard', grip: 'overhand', chalk: true, load: 5, loadUnit: 'kg', ended: 'grip-gave-out', kind: 'test', ...over });

test('legacy entries stay valid and serialize byte for byte', () => {
  const legacy = e();
  assert.deepEqual(normalizeStoredEntry(legacy, TODAY), legacy);
  assert.equal(serializeLog([legacy]), '[{"id":"a1","date":"2026-10-20","seconds":40,"assistance":"unassisted","sets":1}]');
  const parsed = parseStoredLog(JSON.stringify([legacy]), TODAY);
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(parsed.entries, [legacy]);
});

test('null optional fields normalize cleanly; present-but-invalid fields reject', () => {
  assert.deepEqual(normalizeStoredEntry(e({ bar: null, grip: null, chalk: null, load: null, loadUnit: null, ended: null, kind: null }), TODAY), e());
  for (const bad of [{ bar: 'bogus' }, { grip: 'x' }, { chalk: 'yes' }, { ended: 'tired' }, { kind: 'max' }, { load: 5 }, { load: 5, loadUnit: 'st' }, { load: -1, loadUnit: 'kg' }, { load: 501, loadUnit: 'kg' }, { loadUnit: 'kg' }]) {
    assert.equal(normalizeStoredEntry(e(bad), TODAY), null, JSON.stringify(bad));
  }
});

test('full entry round trips through storage and drops unknown fields', () => {
  const text = serializeLog([{ ...full(), secret: 'x' }]);
  assert.ok(!text.includes('secret'));
  const back = parseStoredLog(text, TODAY);
  assert.equal(back.status, 'ok');
  assert.deepEqual(back.entries, [full()]);
  assert.deepEqual(Object.keys(compactEntry(full())), ['id', 'date', 'seconds', 'assistance', 'sets', 'kind', 'bar', 'grip', 'chalk', 'load', 'loadUnit', 'ended']);
});

test('parseLoad accepts bounded decimals only', () => {
  assert.equal(parseLoad('2.5'), 2.5);
  assert.equal(parseLoad('10'), 10);
  for (const v of ['', '0', '0.0', '-3', '2.55', '1e2', '501', 'abc', ' ', '5kg']) assert.equal(parseLoad(v), null, v);
});

test('setup validation is optional and reports bad values', () => {
  assert.deepEqual(validateSetupInput({}), { errors: [], value: {} });
  assert.deepEqual(validateSetupInput({ bar: '', grip: '', chalk: '', load: '', ended: '' }).value, {});
  const ok = validateSetupInput({ bar: 'thick', grip: 'mixed', chalk: 'no', load: '12.5', loadUnit: 'lb', ended: 'slipping' });
  assert.deepEqual(ok.value, { bar: 'thick', grip: 'mixed', chalk: false, load: 12.5, loadUnit: 'lb', ended: 'slipping' });
  assert.equal(validateSetupInput({ bar: 'x', grip: 'y', chalk: 'maybe', load: 'z', ended: 'q' }).errors.length, 5);
});

test('validateEntryInput carries setup fields and the test kind', () => {
  const r = validateEntryInput({ date: '2026-10-20', seconds: '61', assistance: 'unassisted', sets: '1', kind: 'test', bar: 'rings', chalk: 'yes' }, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { date: '2026-10-20', seconds: 61, assistance: 'unassisted', sets: 1, kind: 'test', bar: 'rings', chalk: true });
  assert.equal(validateEntryInput({ date: '2026-10-20', seconds: '61', assistance: 'unassisted', sets: '1', grip: 'bad' }, TODAY).ok, false);
});

test('load bands convert pounds to kilograms first', () => {
  assert.equal(loadBand(e()), 'none');
  assert.equal(loadBand(e({ load: 5, loadUnit: 'kg' })), 'up-to-5');
  assert.equal(loadBand(e({ load: 10, loadUnit: 'lb' })), 'up-to-5');
  assert.equal(loadBand(e({ load: 10, loadUnit: 'kg' })), '5-10');
  assert.equal(loadBand(e({ load: 22, loadUnit: 'lb' })), '5-10');
  assert.equal(loadBand(e({ load: 25, loadUnit: 'lb' })), '10-20');
  assert.equal(loadBand(e({ load: 20.1, loadUnit: 'kg' })), 'over-20');
});

test('setup keys keep unrecorded fields distinct and ignore the ended tag', () => {
  const a = setupKey(full());
  assert.equal(setupKey(full({ ended: 'slipping', kind: undefined })), a);
  assert.notEqual(setupKey(full({ grip: undefined })), a);
  assert.notEqual(setupKey(full({ chalk: false })), a);
  assert.notEqual(setupKey(full({ chalk: undefined })), setupKey(full({ chalk: false })));
  assert.notEqual(setupKey(full({ bar: 'thick' })), a);
  assert.notEqual(setupKey(full({ assistance: 'feet-supported' })), a);
  assert.equal(setupKey(full({ load: 4, loadUnit: 'kg' })), a, 'same band');
  assert.notEqual(setupKey(full({ load: 6, loadUnit: 'kg' })), a, 'different band');
  assert.equal(setupKey(e()), 'unassisted|unrecorded');
  assert.equal(setupKey(e({ assistance: 'feet-supported' })), 'feet-supported|unrecorded');
  assert.match(setupLabel(e()), /^Setup not recorded/);
  assert.match(setupLabel(full()), /Standard bar · Overhand · Chalk · Up to 5 kg added · Unassisted/);
});

test('bests are per setup, never one global PB', () => {
  const rows = [
    e({ id: '1', seconds: 60 }),
    e({ id: '2', seconds: 45, bar: 'standard', grip: 'overhand', chalk: true }),
    e({ id: '3', seconds: 50, bar: 'standard', grip: 'overhand', chalk: true, date: '2026-10-25' }),
    e({ id: '4', seconds: 30, bar: 'thick', grip: 'overhand', chalk: true }),
    e({ id: '5', seconds: 25, assistance: 'feet-supported', bar: 'standard', grip: 'overhand', chalk: true }),
  ];
  const groups = bestsBySetup(rows);
  assert.equal(groups.length, 4);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.equal(byKey[setupKey(rows[1])].best.seconds, 50);
  assert.equal(byKey[setupKey(rows[1])].count, 2);
  assert.equal(byKey[setupKey(rows[3])].best.seconds, 30);
  assert.equal(byKey['unassisted|unrecorded'].best.seconds, 60);
  assert.deepEqual(listSetups(rows, 'feet-supported').map((g) => g.best.seconds), [25]);
});

test('setup filter narrows entries and feeds the progress graph', () => {
  const rows = [
    e({ id: '1', seconds: 60, date: '2026-10-28' }),
    e({ id: '2', seconds: 45, bar: 'standard', grip: 'overhand', date: '2026-10-27' }),
    e({ id: '3', seconds: 50, bar: 'standard', grip: 'overhand', date: '2026-10-29' }),
  ];
  const key = setupKey(rows[1]);
  assert.equal(filterBySetup(rows, 'all').length, 3);
  assert.equal(filterBySetup(rows, '').length, 3);
  assert.equal(filterBySetup(rows, key).length, 2);
  const progress = progressFor(filterBySetup(rows, key), 'unassisted', null, new Date(2026, 9, 31), 90);
  assert.deepEqual(progress.daily.map((d) => d.seconds), [45, 50]);
  assert.equal(progress.allTimeBest, 50);
});

test('last-used setup default round trips, excludes the ended tag and survives junk', () => {
  const text = serializeSetupDefault({ assistance: 'feet-supported', bar: 'rings', grip: 'neutral', chalk: 'yes', load: '2.5', loadUnit: 'kg', ended: 'slipping' });
  assert.ok(!text.includes('slipping'));
  assert.deepEqual(parseSetupDefault(text), { assistance: 'feet-supported', bar: 'rings', grip: 'neutral', chalk: 'yes', load: '2.5', loadUnit: 'kg', ended: '' });
  for (const junk of [null, undefined, '', '{', '[]', '"x"', '{"bar":"nope","assistance":"feet-supported"}']) {
    const form = parseSetupDefault(junk);
    assert.equal(form.bar, '');
    assert.ok(['unassisted', 'feet-supported'].includes(form.assistance));
  }
  assert.deepEqual(parseSetupDefault(null), EMPTY_SETUP_FORM);
  assert.deepEqual(setupFormFromEntry(full()), { assistance: 'unassisted', bar: 'standard', grip: 'overhand', chalk: 'yes', load: '5', loadUnit: 'kg', ended: '' });
});

test('CSV and backup carry the new fields and round trip', () => {
  const rows = [full({ id: 'f1' }), e({ id: 'l1', seconds: 33 })];
  const csv = prepareLogImport(toCsv(rows), [], TODAY);
  assert.equal(csv.ok, true);
  assert.equal(csv.added, 2);
  const strip = (x) => { const { id, ...rest } = x; return rest; };
  assert.deepEqual(csv.entries.map(strip).sort((a, b) => a.seconds - b.seconds), [strip(rows[1]), strip(rows[0])]);
  const json = prepareLogImport(toBackup(rows), [], TODAY);
  assert.deepEqual(json.entries.sort((a, b) => a.seconds - b.seconds), [rows[1], rows[0]]);
  assert.equal(JSON.parse(toBackup(rows)).version, 2);
});

test('same time on different setups is not collapsed by CSV de-duplication', () => {
  const a = e({ id: 'a', bar: 'standard' });
  const b = e({ id: 'b', bar: 'thick' });
  const first = prepareLogImport(toCsv([a]), [], TODAY);
  const second = prepareLogImport(toCsv([a, b]), first.entries, TODAY);
  assert.equal(second.added, 1);
  assert.equal(second.skipped, 1);
});

test('old version 1 backups and legacy four column CSVs still import', () => {
  const v1 = JSON.stringify({ format: 'deadhangs-training-log', version: 1, entries: [e(), e({ id: 'a2', seconds: 20 })] });
  const r1 = prepareLogImport(v1, [], TODAY);
  assert.equal(r1.ok, true);
  assert.equal(r1.added, 2);
  const legacyCsv = 'date,best_hold_seconds,assistance,sets\r\n2026-10-20,40,unassisted,1\r\n2026-10-21,22,feet-supported,3\r\n';
  const r2 = prepareLogImport(legacyCsv, [], TODAY);
  assert.equal(r2.ok, true);
  assert.equal(r2.added, 2);
  assert.ok(r2.entries.every((x) => !('bar' in x) && !('kind' in x)));
});

test('invalid setup values in imports reject the whole file', () => {
  const header = 'date,best_hold_seconds,assistance,sets,entry_type,bar,grip,chalk,added_load,load_unit,hold_ended_by\r\n';
  for (const row of [
    '2026-10-20,40,unassisted,1,hold,bogus,,,,,',
    '2026-10-20,40,unassisted,1,max,,,,,,',
    '2026-10-20,40,unassisted,1,hold,,,maybe,,,',
    '2026-10-20,40,unassisted,1,hold,,,,5,,',
    '2026-10-20,40,unassisted,1,hold,,,,abc,kg,',
    '2026-10-20,40,unassisted,1,hold,,,,,,tired',
  ]) {
    assert.equal(prepareLogImport(header + row + '\r\n', [], TODAY).ok, false, row);
  }
  assert.equal(prepareLogImport(JSON.stringify({ format: 'deadhangs-training-log', version: 2, entries: [e({ grip: 'zzz' })] }), [], TODAY).ok, false);
});

test('appendToStoredLog adds one validated entry and never overwrites bad data', () => {
  const start = appendToStoredLog(null, full(), TODAY);
  assert.equal(start.ok, true);
  assert.equal(parseStoredLog(start.text, TODAY).entries.length, 1);
  const more = appendToStoredLog(start.text, full({ id: 'b2', seconds: 70 }), TODAY);
  assert.equal(more.ok, true);
  assert.equal(more.entries.length, 2);
  assert.equal(appendToStoredLog('{broken', full(), TODAY).reason, 'corrupt');
  assert.equal(appendToStoredLog(start.text, full({ id: 'c3', seconds: 0 }), TODAY).reason, 'invalid');
  const fullLog = JSON.stringify(Array.from({ length: 200 }, (_, i) => e({ id: 'x' + i })));
  assert.equal(appendToStoredLog(fullLog, full({ id: 'z' }), TODAY).reason, 'full');
});

import { setupSummary } from '../src/lib/training-log.mjs';
test('setupSummary is compact and says when nothing was recorded', () => {
  assert.equal(setupSummary(e()), 'Not recorded');
  assert.equal(setupSummary(full()), 'Standard bar · Overhand · Chalk · +5 kg');
  assert.equal(setupSummary(e({ grip: 'mixed' })), 'Mixed');
});
