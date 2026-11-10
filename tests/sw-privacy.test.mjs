import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('offline worker leaves account, checkout and API requests to the network', () => {
  const handlers = {};
  const source = fs.readFileSync(new URL('../scripts/sw-template.js', import.meta.url), 'utf8')
    .replace('__BUILD_ID__', 'privacy-test').replace('__PRECACHE__', '[]');
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://deadhangs.com' }, addEventListener: (name, fn) => handlers[name] = fn },
    URL, Set, Response, fetch: async () => new Response('network'),
  });
  for (const path of ['/account', '/account/', '/account/?billing=success', '/pro/', '/api/account/log', '/api/auth/callback/google']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `https://deadhangs.com${path}` }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://deadhangs.com/deadhang-guide/' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, true, 'public navigation retains the existing offline fallback');
});
