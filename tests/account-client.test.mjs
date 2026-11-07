import test from 'node:test';
import assert from 'node:assert/strict';
import { accountRequest, mergeAccountEntries, cloudProgress, trustedRedirect } from '../src/lib/account-client.mjs';
import { normalizeStoredEntry, serializeLog, parseStoredLog } from '../src/lib/training-log.mjs';
const entry = (id, seconds = 20, date = '2026-10-01') => ({id,date,seconds,sets:3,assistance:'unassisted'});
test('legacy string loads roundtrip as numbers and merge with the identical numeric entry', () => {
  const numeric = { ...entry('weighted'), load: 5, loadUnit: 'kg' };
  const legacy = { ...numeric, load: '5.0' };
  const normal = normalizeStoredEntry(legacy);
  assert.deepEqual(normal, numeric);
  assert.equal(typeof normal.load, 'number');
  const roundtrip = parseStoredLog(serializeLog([normal]));
  assert.equal(roundtrip.status, 'ok');
  assert.deepEqual(roundtrip.entries, [numeric]);
  assert.deepEqual(mergeAccountEntries([numeric], [legacy]), [numeric]);
  for (const load of ['five', '5.01', -1, 501]) assert.equal(normalizeStoredEntry({ ...numeric, load }), null);
  assert.equal(normalizeStoredEntry({ ...legacy, loadUnit: 'stone' }), null);
});
test('explicit merge deduplicates identical entries, preserves distinct entries, refuses conflicts', () => {
  assert.equal(mergeAccountEntries([entry('a')], [entry('a'),entry('b')]).length,2);
  assert.throws(() => mergeAccountEntries([entry('a')],[entry('a',30)]), /entry_conflict/);
  assert.throws(() => mergeAccountEntries([entry('a')],[entry('b')],1), /too_many_entries/);
});
test('progress compares daily bests and separates exact load and max tests', () => {
  const groups = cloudProgress([entry('a',20),entry('b',25),entry('c',30,'2026-10-02'),{...entry('d'),kind:'test'},{...entry('e'),load:3,loadUnit:'kg'},{...entry('f'),load:4,loadUnit:'kg'}]);
  assert.equal(groups.length,4); assert.equal(groups[0].best,30); assert.equal(groups[0].change,5); assert.equal(groups[1].change,null);
});
test('requests carry cookies, forbid caches and expose revision conflicts without retry', async () => {
  let calls=0;
  await assert.rejects(accountRequest('/api/account/log',{method:'PUT',body:'{}'},async(path,options)=>{
    calls++; assert.equal(path,'/api/account/log'); assert.equal(options.cache,'no-store'); assert.equal(options.credentials,'same-origin');
    return new Response(JSON.stringify({error:'revision_conflict'}),{status:409});
  }), /revision_conflict/); assert.equal(calls,1);
});
test('external redirects allow only Google or Stripe HTTPS endpoints', () => {
  assert.equal(trustedRedirect('https://checkout.stripe.com/c/pay/test','stripe'),'https://checkout.stripe.com/c/pay/test');
  for (const url of ['javascript:alert(1)','https://checkout.stripe.com.evil.test','http://checkout.stripe.com','https://a@checkout.stripe.com']) assert.throws(()=>trustedRedirect(url,'stripe'));
});
