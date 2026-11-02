import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_FIELDS,
  CSV_FIELDS_V2,
  STORAGE_KEY,
  bodyweightText,
  normalizeStoredEntry,
  parseBodyweight,
  parseSetupDefault,
  parseStoredLog,
  prepareLogImport,
  serializeLog,
  serializeSetupDefault,
  setupKey,
  toBackup,
  toCsv,
  validateEntryInput,
  validateSetupInput,
} from '../src/lib/training-log.mjs';

const TODAY = '2026-10-31';
const e = (over = {}) => ({ id: 'a1', date: '2026-10-20', seconds: 40, assistance: 'unassisted', sets: 1, ...over });

test('storage key is unchanged and old entries without body weight load as before', () => {
  assert.equal(STORAGE_KEY, 'dh.training-log.v1');
  const parsed = parseStoredLog(JSON.stringify([e()]), TODAY);
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(parsed.entries, [e()]);
  assert.equal(serializeLog(parsed.entries), JSON.stringify([e()]));
  assert.equal(bodyweightText(e()), '');
});

test('body weight is converted to kg with one decimal and range checked', () => {
  assert.equal(parseBodyweight('72.5', 'kg'), 72.5);
  assert.equal(parseBodyweight('160', 'lb'), 72.6);
  assert.equal(parseBodyweight('180.5', 'lb'), 81.9);
  for (const bad of ['', 'abc', '19.9', '300.1', '72.55', '-70', '1e2', '70,5']) assert.equal(parseBodyweight(bad, 'kg'), null, bad);
  assert.equal(parseBodyweight('40', 'lb'), null);
  assert.equal(parseBodyweight('70', 'st'), null);
});

test('form validation stores kg and reports clear errors', () => {
  assert.equal(validateSetupInput({ bodyweight: '160', bodyweightUnit: 'lb' }).value.bodyweightKg, 72.6);
  assert.deepEqual(validateSetupInput({ bodyweight: '', bodyweightUnit: 'lb' }).value, {});
  assert.equal(validateSetupInput({ bodyweight: '5', bodyweightUnit: 'kg' }).errors.length, 1);
  assert.equal(validateSetupInput({ bodyweight: '70', bodyweightUnit: 'st' }).errors.length, 1);
  const ok = validateEntryInput({ date: '2026-10-20', seconds: '30', sets: '1', assistance: 'unassisted', bodyweight: '72.5', bodyweightUnit: 'kg' }, TODAY);
  assert.equal(ok.value.bodyweightKg, 72.5);
  assert.equal('bodyweight' in ok.value, false);
});

test('stored entries accept valid kg and reject bad values', () => {
  assert.equal(normalizeStoredEntry(e({ bodyweightKg: 72.5 }), TODAY).bodyweightKg, 72.5);
  assert.deepEqual(normalizeStoredEntry(e({ bodyweightKg: null }), TODAY), e());
  for (const bad of [10, 301, 72.55, '72', NaN]) assert.equal(normalizeStoredEntry(e({ bodyweightKg: bad }), TODAY), null, String(bad));
});

test('body weight never changes the setup identity or the remembered setup', () => {
  assert.equal(setupKey(e({ bodyweightKg: 70 })), setupKey(e()));
  const text = serializeSetupDefault({ assistance: 'unassisted', bar: 'thick', grip: '', chalk: '', load: '', loadUnit: 'kg', ended: '', bodyweight: '72', bodyweightUnit: 'kg' });
  assert.equal(text.includes('ody'), false);
  assert.equal(parseSetupDefault(text).bar, 'thick');
});

test('display text shows kg and lb from the stored kg', () => {
  assert.equal(bodyweightText(e({ bodyweightKg: 72.5 })), '72.5 kg (159.8 lb)');
});

test('CSV export and re-import keep body weight', () => {
  const rows = [e({ bodyweightKg: 72.5 }), e({ id: 'a2', date: '2026-10-21' })];
  const csv = toCsv(rows);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], CSV_FIELDS.join(','));
  assert.equal(CSV_FIELDS.at(-1), 'bodyweight_kg');
  assert.ok(lines[1].endsWith(',72.5') || lines[2].endsWith(',72.5'));
  const back = prepareLogImport(csv, [], TODAY);
  assert.equal(back.ok, true);
  assert.deepEqual(back.entries.map((x) => x.bodyweightKg).sort(), [72.5, undefined]);
  assert.equal(prepareLogImport(csv, back.entries, TODAY).skipped, 2);
});

test('previous 11 column CSV still imports and bad CSV body weight rejects everything', () => {
  const old = `${CSV_FIELDS_V2.join(',')}\r\n2026-10-20,40,unassisted,1,hold,,,,,,\r\n`;
  const r = prepareLogImport(old, [], TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.entries[0].bodyweightKg, undefined);
  const bad = `${CSV_FIELDS.join(',')}\r\n2026-10-20,40,unassisted,1,hold,,,,,,,5\r\n`;
  assert.equal(prepareLogImport(bad, [], TODAY).ok, false);
});

test('JSON backup round trip keeps body weight and an import is non-destructive', () => {
  const rows = [e({ bodyweightKg: 81.9 })];
  const backup = toBackup(rows);
  assert.equal(JSON.parse(backup).entries[0].bodyweightKg, 81.9);
  const merged = prepareLogImport(backup, [e({ id: 'z', date: '2026-10-01' })], TODAY);
  assert.equal(merged.ok, true);
  assert.equal(merged.entries.length, 2);
  assert.equal(merged.entries.find((x) => x.id === 'a1').bodyweightKg, 81.9);
  assert.equal(prepareLogImport(backup, [e({ bodyweightKg: 70 })], TODAY).ok, false, 'same id with different body weight conflicts');
  assert.equal(prepareLogImport(toBackup([{ ...rows[0], bodyweightKg: 500 }]), [], TODAY).ok, false);
});
