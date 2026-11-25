import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { dispatchReminders, localParts, readReminderOff, reminderDue, reminderEmail, reminderOffUrl, turnRemindersOff } from '../src/server/programme-reminders.mjs';
import { applyOperation } from '../src/lib/programme-engine.mjs';
import { writeProgress, readProgress } from '../src/server/programme-store.mjs';

const rules = JSON.parse(await fs.readFile(new URL('../src/data/plan-rules.json', import.meta.url), 'utf8'));
const env0 = { UNSUB_SECRET: 'x'.repeat(40), AUTH_BASE_URL: 'https://deadhangs.com', EMAIL_CAPTURE_ENABLED: 'true', BREVO_API_KEY: 'fixture', EMAIL_POSTAL_ADDRESS: '1 Test Street', EMAIL_SENDER: 'hello@deadhangs.com', EMAIL_LIST_ID: '3', PROGRAMME_REMINDERS_ENABLED: 'true' };

test('due only on a chosen local day and hour, across daylight saving changes', () => {
  const london = { enabled: true, days: ['mon'], localTime: '18:00', timezone: 'Europe/London' };
  assert.deepEqual(reminderDue(london, new Date('2026-03-23T18:30:00Z')), { localDate: '2026-03-23' }, 'GMT: 18:30 UTC is 18:30 local');
  assert.deepEqual(reminderDue(london, new Date('2026-03-30T17:10:00Z')), { localDate: '2026-03-30' }, 'BST: 17:10 UTC is 18:10 local');
  assert.equal(reminderDue(london, new Date('2026-03-30T18:10:00Z')), null, 'BST: 18:10 UTC is 19:10 local');
  assert.equal(reminderDue(london, new Date('2026-03-31T17:10:00Z')), null, 'Tuesday is not chosen');
  const ny = { enabled: true, days: ['sun'], localTime: '07:00', timezone: 'America/New_York' };
  assert.deepEqual(reminderDue(ny, new Date('2026-11-01T12:30:00Z')), { localDate: '2026-11-01' }, 'local date follows the person, not UTC');
  assert.equal(reminderDue({ ...london, enabled: false }, new Date('2026-03-23T18:30:00Z')), null);
  assert.equal(reminderDue({ ...london, timezone: 'Not/AZone' }, new Date('2026-03-23T18:30:00Z')), null);
  assert.equal(localParts(new Date('2026-06-01T23:30:00Z'), 'Asia/Tokyo').date, '2026-06-02');
});

test('signed off-link: valid link decodes, altered links fail', async () => {
  const url = new URL(await reminderOffUrl(env0, 'User_AbC123'));
  assert.equal(url.pathname, '/api/programme/reminders-off');
  assert.equal(await readReminderOff(env0, url.searchParams.get('u'), url.searchParams.get('s')), 'User_AbC123');
  assert.equal(await readReminderOff(env0, url.searchParams.get('u'), 'A'.repeat(43)), null);
  assert.equal(await readReminderOff({ UNSUB_SECRET: 'y'.repeat(40) }, url.searchParams.get('u'), url.searchParams.get('s')), null);
  const text = reminderEmail({ origin: 'https://deadhangs.com', offUrl: url.href, sessionTitle: 'Week 1, session 2' }).bodyText;
  assert.match(text, /Turn them off in one click/);
  assert.equal(/streak|don't break|every day|max out/i.test(text), false);
});

test('dispatch: off by default, one per person per local day, rechecks pause, access and preference at send time', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT)').run();
    const sql = (await fs.readFile(new URL('../migrations/0005_programme.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
    await db.prepare(`INSERT INTO "user" VALUES ('a','a@example.com'),('b','b@example.com'),('c','c@example.com')`).run();
    const reminders = { enabled: true, days: ['mon'], localTime: '18:00', timezone: 'Europe/London' };
    const enrolled = (paused = false) => {
      let s = applyOperation(null, { op: 'enrol', route: 'standard', baselineSeconds: 10, setup: {}, localDate: '2026-11-02' }, rules, 'now').state;
      s = applyOperation(s, { op: 'reminders', reminders }, rules, 'now').state;
      return paused ? applyOperation(s, { op: 'pause' }, rules, 'now').state : s;
    };
    for (const id of ['a', 'b', 'c']) await writeProgress(db, id, 'hang4', 0, enrolled(id === 'c'));
    const sent = [];
    const deps = { rules, copy: {}, hasAccess: async (id) => id !== 'b', send: async (env, m) => { sent.push(m); return { sent: true }; } };
    const monday = new Date('2026-11-23T18:05:00Z');
    assert.deepEqual(await dispatchReminders({ ...env0, DB: db, PROGRAMME_REMINDERS_ENABLED: undefined }, deps, monday), { candidates: 0, due: 0, sent: 0, skipped: 0, failed: 0, alreadyClaimed: 0, off: true });
    const first = await dispatchReminders({ ...env0, DB: db }, deps, monday);
    assert.equal(first.candidates, 2, 'paused programmes are not candidates');
    assert.equal(first.sent, 1);
    assert.equal(first.skipped, 1, 'no access at send time means no email');
    assert.equal(sent[0].email, 'a@example.com');
    assert.match(sent[0].unsubscribeUrl, /\/api\/programme\/reminders-off\?u=/);
    const again = await dispatchReminders({ ...env0, DB: db }, deps, new Date('2026-11-23T18:40:00Z'));
    assert.equal(again.sent, 0);
    assert.equal(again.alreadyClaimed, 2, 'a retry or overlapping run never sends twice');
    await turnRemindersOff(db, 'a');
    assert.equal((await readProgress(db, 'a', 'hang4')).state.reminders.enabled, false);
    const nextWeek = await dispatchReminders({ ...env0, DB: db }, deps, new Date('2026-11-30T18:05:00Z'));
    assert.equal(nextWeek.sent, 0, 'turned off means no email, even with an earlier queue');
    assert.equal(sent.length, 1);
  } finally { await mf.dispose(); }
});
