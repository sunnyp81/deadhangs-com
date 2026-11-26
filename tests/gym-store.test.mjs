import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { addResult, campaignView, createCampaign, exportCampaign, joinCampaign, leaveCampaign, organiserAction, saveEnquiry } from '../src/server/gym-store.mjs';

// Two synthetic gyms in a local D1 database. Every cross-gym read, write, export and role change must fail.
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2025-09-01', d1Databases: ['DB'] });
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY)').run();
const sql = (await fs.readFile(new URL('../migrations/0006_gym_pilot.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
test.after(() => mf.dispose());

const NOW = Math.floor(Date.parse('2026-12-02T10:00:00Z') / 1000);
const rule = { bar: 'Rig bar 3', grip: 'Overhand', chalk: 'Chalk allowed' };
let n = 0;
const rid = () => `res-${String(++n).padStart(6, '0')}`;
const code = async (promise) => { try { await promise; } catch (error) { return error.code; } return null; };

async function setup() {
  await db.batch(['DELETE FROM gym_results', 'DELETE FROM gym_members', 'DELETE FROM gym_invites', 'DELETE FROM gym_campaigns', 'DELETE FROM gym_enquiries', 'DELETE FROM "user"',
    `INSERT INTO "user"(id) VALUES ('orgA'),('memA1'),('memA2'),('orgB'),('memB1'),('stranger')`].map((s) => db.prepare(s)));
  const a = await createCampaign(db, { gymName: 'Synthetic Gym A', title: 'December hang', startsOn: '2026-12-01', endsOn: '2026-12-31', rule }, NOW);
  const b = await createCampaign(db, { gymName: 'Synthetic Gym B', title: 'December hang', startsOn: '2026-12-01', endsOn: '2026-12-31', rule, boardVisibility: 'members' }, NOW);
  await joinCampaign(db, 'orgA', { token: a.organiserToken, displayName: 'Organiser A', shareConsent: true }, NOW);
  await joinCampaign(db, 'orgB', { token: b.organiserToken, displayName: 'Organiser B', shareConsent: true }, NOW);
  const inviteA = (await organiserAction(db, 'orgA', { campaignId: a.campaignId, op: 'invite' }, NOW)).token;
  const inviteB = (await organiserAction(db, 'orgB', { campaignId: b.campaignId, op: 'invite' }, NOW)).token;
  await joinCampaign(db, 'memA1', { token: inviteA, displayName: 'A one', showOnBoard: true, shareConsent: true }, NOW);
  await joinCampaign(db, 'memA2', { token: inviteA, displayName: 'A two', shareConsent: true }, NOW);
  await joinCampaign(db, 'memB1', { token: inviteB, displayName: 'B one', showOnBoard: true, shareConsent: true }, NOW);
  return { A: a.campaignId, B: b.campaignId, inviteA, inviteB, orgTokenA: a.organiserToken };
}

test('enquiries need consent and are stored before success is reported', async () => {
  await setup();
  assert.equal(await code(saveEnquiry(db, { gymName: 'G', contactName: 'C', email: 'c@example.com' })), 'consent_required');
  assert.equal(await code(saveEnquiry(db, { gymName: 'G', contactName: 'C', email: 'nope', consent: true })), 'invalid_email');
  assert.equal(await code(saveEnquiry(db, { gymName: '<script>', contactName: 'C', email: 'c@example.com', consent: true })), 'invalid_field');
  assert.deepEqual(await saveEnquiry(db, { gymName: 'G', contactName: 'C', email: 'C@Example.com', consent: true }, NOW), { saved: true });
  assert.equal((await db.prepare('SELECT email FROM gym_enquiries').first()).email, 'c@example.com');
});

test('invites are single-purpose, expire, can be revoked, and the organiser invite works once', async () => {
  const t = await setup();
  assert.equal(await code(joinCampaign(db, 'stranger', { token: t.orgTokenA, displayName: 'X', shareConsent: true }, NOW)), 'invite_invalid', 'organiser invite has one use');
  assert.equal(await code(joinCampaign(db, 'stranger', { token: 'x'.repeat(43), displayName: 'X', shareConsent: true }, NOW)), 'invite_invalid');
  assert.equal(await code(joinCampaign(db, 'stranger', { token: t.inviteA, displayName: 'X', shareConsent: false }, NOW)), 'consent_required');
  assert.equal(await code(joinCampaign(db, 'stranger', { token: t.inviteA, displayName: 'X', shareConsent: true }, NOW + 61 * 86400)), 'invite_invalid', 'expired');
  await organiserAction(db, 'orgA', { campaignId: t.A, op: 'revoke_invites' }, NOW);
  assert.equal(await code(joinCampaign(db, 'stranger', { token: t.inviteA, displayName: 'X', shareConsent: true }, NOW)), 'invite_invalid', 'revoked');
  const view = await campaignView(db, 'memA1', t.A);
  assert.equal(view.me.role, 'participant');
});

test('members cannot read, write, export or manage another gym, and cannot alter anyone else\'s result', async () => {
  const t = await setup();
  await addResult(db, 'memA1', { campaignId: t.A, id: rid(), seconds: 40, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  const bResult = rid();
  await addResult(db, 'memB1', { campaignId: t.B, id: bResult, seconds: 55, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  assert.equal(await code(campaignView(db, 'memA1', t.B)), 'not_found', 'cross-gym read');
  assert.equal(await code(campaignView(db, 'stranger', t.A)), 'not_found');
  assert.equal(await code(addResult(db, 'memA1', { campaignId: t.B, id: rid(), seconds: 99, localDate: '2026-12-02', ruleConfirmed: true }, NOW)), 'not_found', 'cross-gym write');
  assert.equal(await code(exportCampaign(db, 'orgA', t.B)), 'not_found', 'cross-gym export');
  assert.equal(await code(organiserAction(db, 'orgA', { campaignId: t.B, op: 'correct', resultId: bResult, seconds: 1, note: 'x' }, NOW)), 'not_found', 'cross-gym correction');
  assert.equal(await code(organiserAction(db, 'orgA', { campaignId: t.A, op: 'correct', resultId: bResult, seconds: 1, note: 'x' }, NOW)), 'not_found', 'result from another gym through own campaign');
  assert.equal(await code(organiserAction(db, 'memA1', { campaignId: t.A, op: 'remove_result', resultId: bResult }, NOW)), 'organiser_only');
  assert.equal(await code(addResult(db, 'memA2', { campaignId: t.A, id: bResult, seconds: 1, localDate: '2026-12-02', ruleConfirmed: true }, NOW)), 'id_conflict', 'cannot overwrite a result by reusing its id');
  assert.equal((await db.prepare('SELECT seconds FROM gym_results WHERE id = ?').bind(bResult).first()).seconds, 55);
});

test('results follow the campaign rule and dates; the board shows only people who opted in, labelled self-reported', async () => {
  const t = await setup();
  assert.equal(await code(addResult(db, 'memA1', { campaignId: t.A, id: rid(), seconds: 40, localDate: '2026-11-30', ruleConfirmed: true }, NOW)), 'outside_campaign_dates');
  assert.equal(await code(addResult(db, 'memA1', { campaignId: t.A, id: rid(), seconds: 40, localDate: '2026-12-02', ruleConfirmed: false }, NOW)), 'rule_not_confirmed');
  const id = rid();
  await addResult(db, 'memA1', { campaignId: t.A, id, seconds: 40, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  assert.deepEqual(await addResult(db, 'memA1', { campaignId: t.A, id, seconds: 40, localDate: '2026-12-02', ruleConfirmed: true }, NOW), { saved: true, already: true });
  await addResult(db, 'memA2', { campaignId: t.A, id: rid(), seconds: 70, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  const member = await campaignView(db, 'memA1', t.A);
  assert.equal(member.board, null, 'board is organiser-only by default');
  assert.equal(member.manage, null);
  assert.equal(member.selfReported, true);
  const org = await campaignView(db, 'orgA', t.A);
  assert.deepEqual(org.board.map((r) => r.display_name), ['A one'], 'A two did not opt in');
  assert.equal(org.manage.results.length, 2);
  assert.equal(JSON.stringify(org).includes('memA'), false, 'no account ids reach the organiser');
  const bMember = await campaignView(db, 'memB1', t.B);
  assert.equal(bMember.board.length, 0, 'members board shows only opted-in people with results');
});

test('organiser corrections, member removal and closing; removed people lose access at once', async () => {
  const t = await setup();
  const id = rid();
  await addResult(db, 'memA1', { campaignId: t.A, id, seconds: 400, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  await organiserAction(db, 'orgA', { campaignId: t.A, op: 'correct', resultId: id, seconds: 40, note: 'Typo, confirmed with member' }, NOW);
  assert.equal((await campaignView(db, 'orgA', t.A)).board[0].best, 40);
  const ref = (await campaignView(db, 'orgA', t.A)).manage.members.find((m) => m.display_name === 'A one').memberRef;
  assert.equal(await code(organiserAction(db, 'orgB', { campaignId: t.B, op: 'remove_member', memberRef: ref }, NOW)), 'not_found', 'a row number from another gym does nothing');
  await organiserAction(db, 'orgA', { campaignId: t.A, op: 'remove_member', memberRef: ref }, NOW);
  assert.equal(await code(campaignView(db, 'memA1', t.A)), 'not_found');
  assert.equal(await code(joinCampaign(db, 'memA1', { token: t.inviteA, displayName: 'Back', shareConsent: true }, NOW)), 'removed');
  const csv = (await exportCampaign(db, 'orgA', t.A)).csv;
  assert.equal(csv.includes('A one'), false, 'removed members leave the export');
  await organiserAction(db, 'orgA', { campaignId: t.A, op: 'close' }, NOW);
  assert.equal(await code(addResult(db, 'memA2', { campaignId: t.A, id: rid(), seconds: 10, localDate: '2026-12-03', ruleConfirmed: true }, NOW)), 'campaign_closed');
  assert.equal(await code(organiserAction(db, 'orgA', { campaignId: t.A, op: 'invite' }, NOW)), 'campaign_closed');
});

test('export is campaign-scoped, has no emails or ids, and neutralises spreadsheet formulas', async () => {
  const t = await setup();
  await db.prepare("UPDATE gym_members SET display_name = '=HYPERLINK(1)' WHERE user_id = 'memA2'").run();
  await addResult(db, 'memA2', { campaignId: t.A, id: rid(), seconds: 30, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  await addResult(db, 'memB1', { campaignId: t.B, id: rid(), seconds: 31, localDate: '2026-12-02', ruleConfirmed: true }, NOW);
  const { csv } = await exportCampaign(db, 'orgA', t.A);
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.equal(csv.includes('B one'), false);
  assert.equal(/@|memA|orgA/.test(csv), false);
  assert.equal(await code(exportCampaign(db, 'memA2', t.A)), 'organiser_only');
  await leaveCampaign(db, 'memA2', t.A, NOW);
  assert.equal(await code(campaignView(db, 'memA2', t.A)), 'not_found');
});
