import test from 'node:test';
import assert from 'node:assert/strict';
import { trackAffiliateClick } from '../src/scripts/affiliate-tracking.js';

function fixture({ consent = 'accepted', href = 'https://www.amazon.co.uk/s?k=pullup&tag=deadhangs-21', type = 'click', button = 0 } = {}) {
  const calls = [];
  const browser = { localStorage: { getItem: () => consent }, location: { pathname: '/dead-hang-time-by-age/' }, gtag: (...args) => calls.push(args) };
  const event = { type, button, target: { closest: () => ({ href }) }, preventDefault: () => assert.fail('must not interfere with navigation') };
  return { calls, browser, event };
}

test('consented affiliate click adds no link query or visitor identifiers', () => {
  const { calls, browser, event } = fixture();
  trackAffiliateClick(event, browser);
  assert.deepEqual(calls, [['event', 'affiliate_click', {
    send_to: 'G-YBPRQVR2Y3', affiliate_partner: 'amazon', affiliate_store: 'UK',
    affiliate_tag: 'deadhangs-21', page_path: '/dead-hang-time-by-age/',
  }]]);
});

test('unknown and rejected consent emit nothing', () => {
  for (const consent of [null, 'declined', 'rejected']) {
    const f = fixture({ consent });
    trackAffiliateClick(f.event, f.browser);
    assert.equal(f.calls.length, 0);
  }
});

test('non-affiliate and lookalike URLs emit nothing', () => {
  for (const href of ['https://deadhangs.com/', 'https://www.amazon.co.uk/s?k=pullup', 'https://www.amazon.co.uk.evil.test/?tag=deadhangs-21', 'http://www.amazon.co.uk/?tag=deadhangs-21', 'javascript:alert(1)', 'https://www.amazon.com/?tag=private%40email.test']) {
    const f = fixture({ href });
    trackAffiliateClick(f.event, f.browser);
    assert.equal(f.calls.length, 0, href);
  }
});

test('middle clicks counted; right clicks and duplicate auxiliary left clicks ignored', () => {
  for (const [type, button, expected] of [['auxclick', 1, 1], ['auxclick', 2, 0], ['auxclick', 0, 0], ['click', 1, 0], ['click', 0, 1], ['mousedown', 0, 0]]) {
    const f = fixture({ type, button });
    trackAffiliateClick(f.event, f.browser);
    assert.equal(f.calls.length, expected);
  }
});

test('storage restrictions, missing analytics, and non-link clicks are harmless', () => {
  const f = fixture();
  f.browser.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => trackAffiliateClick(f.event, f.browser));
  f.browser.localStorage.getItem = () => 'accepted';
  delete f.browser.gtag;
  assert.doesNotThrow(() => trackAffiliateClick(f.event, f.browser));
  f.event.target = null;
  assert.doesNotThrow(() => trackAffiliateClick(f.event, f.browser));
  assert.equal(f.calls.length, 0);
});
