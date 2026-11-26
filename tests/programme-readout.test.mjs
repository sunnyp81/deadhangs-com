import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { buildQuery, parseArgs, summarise } from '../scripts/programme-readout.mjs';

test('readout args: validated dates, 28-day default, safe excluded ids only', () => {
  assert.deepEqual(parseArgs([], new Date('2026-12-10T12:00:00Z')), { from: '2026-11-13', to: '2026-12-10', asof: '2026-12-10', exclude: [] });
  assert.throws(() => parseArgs(['--from', '2026-1-1']));
  assert.throws(() => parseArgs(['--exclude-users', "x'); DROP TABLE user;--"]));
  assert.throws(() => parseArgs(['--from', '2026-12-10', '--to', '2026-12-01']));
});

test('readout SQL runs on real SQLite and counts live purchases, refunds, week 4 and completion from aggregates only', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
    const sql = (await fs.readFile(new URL('../migrations/0005_programme.sql', import.meta.url), 'utf8') + (await fs.readFile(new URL('../migrations/0007_programme_settle_seq.sql', import.meta.url), 'utf8'))).replace(/^--.*$/gm, '');
    await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
    const t = (d) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 1000);
    const buy = (id, user, status, created, mode = 'live') => db.prepare(`INSERT INTO programme_purchases VALUES (?,?,'hang4','0.1.0',?, 'cus_x', NULL, 2900, 'gbp', ?, 'programme_page', ?, ?, ?, 0)`)
      .bind(id, user, mode, status, t(created), status === 'pending' ? null : t(created), t(created));
    const state = (keys, route = 'standard') => JSON.stringify({ v: 1, route, status: 'active', results: keys.map((k) => ({ sessionKey: k, sets: [10] })) });
    await db.batch([
      db.prepare('INSERT INTO "user"(id) VALUES (\'a\'),(\'b\'),(\'c\'),(\'owner\'),(\'t\')'),
      buy('cs_1', 'a', 'paid', '2026-11-01'), buy('cs_2', 'b', 'paid', '2026-11-20'), buy('cs_3', 'c', 'refunded', '2026-11-02'),
      buy('cs_4', 'owner', 'paid', '2026-11-03'), buy('cs_5', 't', 'paid', '2026-11-03', 'test'), buy('cs_6', 'c', 'pending', '2026-11-05'),
      db.prepare('INSERT INTO programme_progress VALUES (?,?,1,?,0,0)').bind('a', 'hang4', state(['w1s1', 'w4s1', 'w4s3'])),
      db.prepare('INSERT INTO programme_progress VALUES (?,?,1,?,0,0)').bind('b', 'hang4', state(['w1s1'], 'supported')),
      db.prepare('INSERT INTO programme_progress VALUES (?,?,1,?,0,0)').bind('c', 'hang4', state(['w1s1', 'w4s1'])),
      db.prepare("INSERT INTO programme_interest VALUES ('x@example.com','hang4','programme-interest-v1','programme_page',?,NULL)").bind(t('2026-11-10')),
    ]);
    const args = parseArgs(['--from', '2026-11-01', '--to', '2026-11-30', '--asof', '2026-11-30', '--exclude-users', 'owner']);
    const row = await db.prepare(buildQuery(args)).first();
    assert.equal(row.checkout_started, 4, 'owner and test-mode rows excluded');
    assert.equal(row.purchasers, 3);
    assert.equal(row.gross_pence, 8700);
    assert.equal(row.refunded_pence, 2900);
    assert.equal(row.unpaid_checkouts, 1);
    assert.equal(row.enrolled, 2, 'the refunded buyer is not counted as enrolled');
    assert.equal(row.enrolled_supported, 1);
    assert.equal(row.week4_eligible, 1, 'only a paid buyer from 21+ days ago is old enough');
    assert.equal(row.week4_active, 1);
    assert.equal(row.completed, 1);
    assert.equal(row.sessions_recorded, 4);
    assert.equal(row.interest_signups, 1);
    const text = summarise(row, args);
    assert.match(text, /net GBP 58\.00/);
    assert.match(text, /not enough data/);
    assert.equal(/@|cs_|cus_/.test(text), false, 'no personal or payment identifiers in the output');
  } finally { await mf.dispose(); }
});
