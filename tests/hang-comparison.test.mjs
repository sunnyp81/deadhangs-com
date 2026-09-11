import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHang } from '../src/lib/hang-comparison.mjs';
test('compares against a personal target, including holds beyond it', () => {
  assert.deepEqual(compareHang(30, 60, 20), { percent:50, remaining:30, difference:10, change:50 });
  assert.deepEqual(compareHang(90, 60), { percent:150, remaining:0, difference:null, change:null });
});
test('zero current hold and regression are valid; invalid denominators are rejected', () => {
  assert.equal(compareHang(0, 60, 20).change, -100);
  assert.equal(compareHang(20.5, 60, 30).difference, -9.5);
  for (const values of [[-1,60],[Infinity,60],[20,0],[20,NaN],[20,60,0],[20,60,-10],[3601,60]]) assert.throws(()=>compareHang(...values));
});
