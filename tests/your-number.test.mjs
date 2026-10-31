import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHold, parseAge, describeHold, parseHoldParam } from '../src/lib/your-number.mjs';

test('parseHold accepts seconds and m:ss', () => {
  assert.equal(parseHold('65').seconds, 65);
  assert.equal(parseHold('1:05').seconds, 65);
  assert.equal(parseHold('0:08').seconds, 8);
  assert.equal(parseHold('2:30.5').seconds, 150.5);
  assert.equal(parseHold(' 12.5 ').seconds, 12.5);
  assert.equal(parseHold('60:00').seconds, 3600);
});

test('parseHold rejects junk and out of range', () => {
  for (const v of ['', 'abc', '0', '-5', '1:75', '3601', '1:2:3', '1e3', '60:01'])
    assert.equal(parseHold(v).ok, false, v);
});

test('parseAge optional and whole', () => {
  assert.deepEqual(parseAge(''), { ok: true, age: null });
  assert.equal(parseAge('40').age, 40);
  assert.equal(parseAge('0').ok, false);
  assert.equal(parseAge('4.5').ok, false);
  assert.equal(parseAge('200').ok, false);
});

const pos = (r, kind, sex) => r.lines.find((l) => l.kind === kind && l.sex === sex).position;

test('positions against each reference', () => {
  const r = describeHold(65, { sex: '' });
  assert.equal(r.lines.length, 4);
  assert.equal(pos(r, 'measured', 'men'), 'above');
  assert.equal(pos(r, 'measured', 'women'), 'above');
  assert.equal(pos(r, 'target', 'men'), 'below');
  assert.equal(pos(r, 'target', 'women'), 'below');
  const w = describeHold(50, { sex: 'women' });
  assert.equal(w.lines.length, 2);
  assert.equal(pos(w, 'measured', 'women'), 'above');
  assert.equal(pos(describeHold(50, { sex: 'men' }), 'measured', 'men'), 'below');
  const eq = describeHold(120, { sex: 'men' });
  assert.equal(pos(eq, 'target', 'men'), 'equal');
  assert.equal(eq.lines[1].label, 'At');
  assert.equal(describeHold(30, { sex: 'men' }).lines[0].label, 'Below');
});

test('age only adds a note, never changes the lines', () => {
  const a = describeHold(30, { sex: 'men', age: null });
  const b = describeHold(30, { sex: 'men', age: 70 });
  assert.deepEqual(a.lines, b.lines);
  assert.equal(a.ageNote, null);
  assert.match(b.ageNote, /thin/);
});

test('ladder under 10 s and log link', () => {
  assert.equal(describeHold(8, {}).showLadder, true);
  assert.equal(describeHold(10, {}).showLadder, false);
  assert.equal(describeHold(64.6, {}).logHref, '/training-log/?hold=65');
});

test('no percentile or ranking language in any output', () => {
  for (const s of [8, 30, 50, 65, 100, 150]) {
    const r = describeHold(s, { age: 40 });
    const all = r.lines.map((l) => l.text + l.source).join(' ') + r.ageNote;
    assert.doesNotMatch(all, /percent|top \d|rank|average person/i);
  }
});

test('parseHoldParam validates', () => {
  assert.equal(parseHoldParam('?hold=65'), '65');
  assert.equal(parseHoldParam('?hold=0'), null);
  assert.equal(parseHoldParam('?hold=3601'), null);
  assert.equal(parseHoldParam('?hold=1.5'), null);
  assert.equal(parseHoldParam('?hold=x'), null);
  assert.equal(parseHoldParam(''), null);
});
