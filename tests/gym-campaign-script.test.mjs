import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { campaignSql } from '../scripts/gym-campaign.mjs';
import { joinCampaign, campaignView } from '../src/server/gym-store.mjs';

test('owner campaign script: validated input, escaped SQL that applies cleanly, hashed invite that works once', async () => {
  await assert.rejects(campaignSql({ gymName: 'X', title: 'Y', startsOn: '2026-12-31', endsOn: '2026-12-01', rule: { bar: 'a', grip: 'b', chalk: 'c' } }), { code: 'invalid_dates' });
  const now = Math.floor(Date.parse('2026-12-02T10:00:00Z') / 1000);
  const out = await campaignSql({ gymName: "O'Brien's Gym", title: 'December hang', startsOn: '2026-12-01', endsOn: '2026-12-31', rule: { bar: 'Rig bar', grip: 'Overhand', chalk: 'Allowed' } }, now);
  assert.equal(out.sql.includes(out.organiserToken), false, 'the raw token never goes into the database file');
  assert.match(out.sql, /O''Brien''s Gym/);
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
    const schema = (await fs.readFile(new URL('../migrations/0006_gym_pilot.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    await db.batch([...schema.split(';'), ...out.sql.split(';\n')].map((s) => s.trim().replace(/;$/, '')).filter(Boolean).map((s) => db.prepare(s)));
    await db.prepare(`INSERT INTO "user"(id) VALUES ('org')`).run();
    const joined = await joinCampaign(db, 'org', { token: out.organiserToken, displayName: 'Organiser', shareConsent: true }, now);
    assert.equal(joined.role, 'organiser');
    assert.equal((await campaignView(db, 'org', out.campaignId)).campaign.gymName, "O'Brien's Gym");
  } finally { await mf.dispose(); }
});
