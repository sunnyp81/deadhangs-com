// Gym challenge pilot: tenant and role checks live here, on the server. A campaign id from the browser is only a
// lookup key; authority always comes from the caller's own membership row. Results are self-reported and labelled so.

export class GymError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
/** @returns {never} */
function fail(code, status = 400) { throw new GymError(code, status); }
const missingTable = (error) => /no such table/i.test(String(error?.message || error));
async function guarded(fn) {
  try { return await fn(); } catch (error) { if (missingTable(error)) fail('gym_unavailable', 503); throw error; }
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ENQUIRY_CONSENT_VERSION = 'gym-enquiry-v1';
export const INVITE_DAYS = Object.freeze({ organiser: 14, participant: 60 });

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const newId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

function cleanText(value, max, required = true) {
  if (value == null || value === '') { if (required) fail('missing_field'); return null; }
  if (typeof value !== 'string') fail('invalid_field');
  const text = value.trim().replace(/\s+/g, ' ');
  if ((required && !text) || text.length > max || /[<>]/.test(text)) fail('invalid_field');
  return text || null;
}

/** Public enquiry form. Saved before success is reported. */
export async function saveEnquiry(db, input, now = Math.floor(Date.now() / 1000)) {
  if (input?.consent !== true) fail('consent_required');
  const email = cleanText(input.email, 254).toLowerCase();
  if (!EMAIL.test(email)) fail('invalid_email');
  const row = {
    id: newId(), gym: cleanText(input.gymName, 120), contact: cleanText(input.contactName, 120), email,
    location: cleanText(input.location, 120, false), members: cleanText(input.members, 40, false), message: cleanText(input.message, 1000, false),
  };
  return guarded(async () => {
    await db.prepare('INSERT INTO gym_enquiries (id, gym_name, contact_name, email, location, members, message, consent_version, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.gym, row.contact, row.email, row.location, row.members, row.message, ENQUIRY_CONSENT_VERSION, now).run();
    return { saved: true };
  });
}

/** Owner-only, run from a script with production access: creates a campaign and its first organiser invite. */
export async function createCampaign(db, input, now = Math.floor(Date.now() / 1000)) {
  const id = newId();
  const gymName = cleanText(input.gymName, 120);
  const title = cleanText(input.title, 120);
  if (!DATE.test(input.startsOn || '') || !DATE.test(input.endsOn || '') || input.endsOn < input.startsOn) fail('invalid_dates');
  const rule = { bar: cleanText(input.rule?.bar, 60), grip: cleanText(input.rule?.grip, 60), chalk: cleanText(input.rule?.chalk, 60), assistance: 'unassisted', note: cleanText(input.rule?.note, 200, false) };
  const board = input.boardVisibility === 'members' ? 'members' : 'organiser';
  return guarded(async () => {
    await db.prepare('INSERT INTO gym_campaigns (id, gym_name, title, starts_on, ends_on, rule_json, brand_json, board_visibility, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, gymName, title, input.startsOn, input.endsOn, JSON.stringify(rule), JSON.stringify(input.brand || {}), board, now).run();
    const invite = await createInvite(db, id, 'organiser', now, 1);
    return { campaignId: id, organiserToken: invite.token };
  });
}

async function createInvite(db, campaignId, role, now, maxUses) {
  const token = newToken();
  await db.prepare('INSERT INTO gym_invites (token_hash, campaign_id, role, expires_at, max_uses, created_at) VALUES (?,?,?,?,?,?)')
    .bind(await hashToken(token), campaignId, role, now + INVITE_DAYS[role] * 86400, maxUses, now).run();
  return { token, expiresAt: now + INVITE_DAYS[role] * 86400 };
}

async function campaign(db, campaignId) {
  if (typeof campaignId !== 'string' || !ID.test(campaignId)) fail('not_found', 404);
  const row = await db.prepare('SELECT * FROM gym_campaigns WHERE id = ?').bind(campaignId).first();
  if (!row) fail('not_found', 404);
  return row;
}

/** The caller's live membership, or a 404 that does not reveal whether the campaign exists. */
async function membership(db, campaignId, userId) {
  const c = await campaign(db, campaignId);
  const member = await db.prepare('SELECT * FROM gym_members WHERE campaign_id = ? AND user_id = ? AND removed_at IS NULL').bind(campaignId, userId).first();
  if (!member) fail('not_found', 404);
  return { campaign: c, member };
}
async function organiser(db, campaignId, userId) {
  const found = await membership(db, campaignId, userId);
  if (found.member.role !== 'organiser') fail('organiser_only', 403);
  return found;
}

/** Joins with an invite. The display name and board choice are the person's own; nothing else from their history is shared. */
export async function joinCampaign(db, userId, { token, displayName, showOnBoard, shareConsent }, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || !TOKEN.test(token)) fail('invite_invalid', 404);
  if (shareConsent !== true) fail('consent_required');
  const name = cleanText(displayName, 40);
  return guarded(async () => {
    const hash = await hashToken(token);
    const invite = await db.prepare('SELECT * FROM gym_invites WHERE token_hash = ?').bind(hash).first();
    if (!invite || invite.revoked_at || invite.expires_at <= now || invite.uses >= invite.max_uses) fail('invite_invalid', 404);
    const c = await campaign(db, invite.campaign_id);
    if (c.status !== 'active') fail('campaign_closed', 409);
    const existing = await db.prepare('SELECT role, removed_at FROM gym_members WHERE campaign_id = ? AND user_id = ?').bind(c.id, userId).first();
    if (existing?.removed_at) fail('removed', 403);
    if (existing) return { campaignId: c.id, role: existing.role, already: true };
    const used = await db.prepare('UPDATE gym_invites SET uses = uses + 1 WHERE token_hash = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?').bind(hash, now).run();
    if (used.meta.changes !== 1) fail('invite_invalid', 404);
    await db.prepare('INSERT INTO gym_members (campaign_id, user_id, role, display_name, show_on_board, joined_at) VALUES (?,?,?,?,?,?)')
      .bind(c.id, userId, invite.role, name, showOnBoard === true ? 1 : 0, now).run();
    return { campaignId: c.id, role: invite.role, already: false };
  });
}

/** A member's own result under the campaign's single rule. Idempotent by client id. */
export async function addResult(db, userId, { campaignId, id, seconds, localDate, ruleConfirmed }, now = Math.floor(Date.now() / 1000)) {
  return guarded(async () => {
    const { campaign: c } = await membership(db, campaignId, userId);
    if (c.status !== 'active') fail('campaign_closed', 409);
    if (typeof id !== 'string' || !ID.test(id)) fail('invalid_id');
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) fail('invalid_seconds');
    if (!DATE.test(localDate || '') || localDate < c.starts_on || localDate > c.ends_on) fail('outside_campaign_dates');
    if (ruleConfirmed !== true) fail('rule_not_confirmed');
    const existing = await db.prepare('SELECT campaign_id, user_id, seconds, local_date FROM gym_results WHERE id = ?').bind(id).first();
    if (existing) {
      if (existing.campaign_id === campaignId && existing.user_id === userId && existing.seconds === seconds && existing.local_date === localDate) return { saved: true, already: true };
      fail('id_conflict', 409);
    }
    await db.prepare('INSERT INTO gym_results (id, campaign_id, user_id, seconds, local_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, campaignId, userId, seconds, localDate, now, now).run();
    return { saved: true, already: false };
  });
}

const effective = 'COALESCE(r.corrected_seconds, r.seconds)';

/** What a member may see. Organisers see every member's campaign results; members see the board only when the organiser allows it, and only people who opted in. */
export async function campaignView(db, userId, campaignId) {
  return guarded(async () => {
    const { campaign: c, member } = await membership(db, campaignId, userId);
    const mine = (await db.prepare(`SELECT r.id, r.seconds, r.corrected_seconds, r.correction_note, r.local_date, r.status FROM gym_results r WHERE r.campaign_id = ? AND r.user_id = ? ORDER BY r.local_date DESC, r.created_at DESC`).bind(c.id, userId).all()).results;
    const isOrganiser = member.role === 'organiser';
    let board = null;
    if (isOrganiser || c.board_visibility === 'members') {
      board = (await db.prepare(`SELECT m.display_name, MAX(${effective}) best, COUNT(r.id) entries FROM gym_members m JOIN gym_results r ON r.campaign_id = m.campaign_id AND r.user_id = m.user_id AND r.status = 'active'
        WHERE m.campaign_id = ? AND m.removed_at IS NULL AND m.show_on_board = 1 GROUP BY m.user_id ORDER BY best DESC, m.display_name`).bind(c.id).all()).results;
    }
    const manage = isOrganiser ? {
      members: (await db.prepare('SELECT CAST(rowid AS TEXT) memberRef, display_name, role, show_on_board, joined_at FROM gym_members WHERE campaign_id = ? AND removed_at IS NULL ORDER BY joined_at').bind(c.id).all()).results,
      results: (await db.prepare(`SELECT r.id, m.display_name, r.seconds, r.corrected_seconds, r.correction_note, r.local_date, r.status FROM gym_results r JOIN gym_members m ON m.campaign_id = r.campaign_id AND m.user_id = r.user_id WHERE r.campaign_id = ? ORDER BY r.local_date DESC`).bind(c.id).all()).results,
    } : null;
    return {
      campaign: { id: c.id, gymName: c.gym_name, title: c.title, startsOn: c.starts_on, endsOn: c.ends_on, rule: JSON.parse(c.rule_json), brand: JSON.parse(c.brand_json), status: c.status, boardVisibility: c.board_visibility },
      me: { role: member.role, displayName: member.display_name, showOnBoard: Boolean(member.show_on_board) },
      mine, board, manage, selfReported: true,
    };
  });
}

/** Organiser actions. Every target is re-checked to belong to the same campaign. */
export async function organiserAction(db, userId, { campaignId, op, resultId, seconds, note, memberRef, boardVisibility }, now = Math.floor(Date.now() / 1000)) {
  return guarded(async () => {
    const { campaign: c } = await organiser(db, campaignId, userId);
    if (op === 'correct' || op === 'remove_result') {
      if (typeof resultId !== 'string' || !ID.test(resultId)) fail('invalid_id');
      const owned = await db.prepare('SELECT id FROM gym_results WHERE id = ? AND campaign_id = ?').bind(resultId, c.id).first();
      if (!owned) fail('not_found', 404);
      if (op === 'correct') {
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) fail('invalid_seconds');
        await db.prepare('UPDATE gym_results SET corrected_seconds = ?, correction_note = ?, updated_at = ? WHERE id = ? AND campaign_id = ?').bind(seconds, cleanText(note, 200), now, resultId, c.id).run();
      } else await db.prepare("UPDATE gym_results SET status = 'removed', updated_at = ? WHERE id = ? AND campaign_id = ?").bind(now, resultId, c.id).run();
      return { ok: true };
    }
    if (op === 'remove_member') {
      if (typeof memberRef !== 'string' || !/^\d{1,12}$/.test(memberRef)) fail('invalid_member');
      // memberRef is the row number within this campaign, never an account id; an organiser cannot remove themselves here.
      const changed = await db.prepare('UPDATE gym_members SET removed_at = ? WHERE campaign_id = ? AND rowid = ? AND removed_at IS NULL AND user_id <> ?').bind(now, c.id, Number(memberRef), userId).run();
      if (changed.meta.changes !== 1) fail('not_found', 404);
      return { ok: true };
    }
    if (op === 'invite') {
      if (c.status !== 'active') fail('campaign_closed', 409);
      const invite = await createInvite(db, c.id, 'participant', now, 500);
      return { ok: true, token: invite.token, expiresAt: invite.expiresAt };
    }
    if (op === 'revoke_invites') {
      const changed = await db.prepare("UPDATE gym_invites SET revoked_at = ? WHERE campaign_id = ? AND role = 'participant' AND revoked_at IS NULL").bind(now, c.id).run();
      return { ok: true, revoked: changed.meta.changes };
    }
    if (op === 'board') {
      if (!['organiser', 'members'].includes(boardVisibility)) fail('invalid_board');
      await db.prepare('UPDATE gym_campaigns SET board_visibility = ? WHERE id = ?').bind(boardVisibility, c.id).run();
      return { ok: true };
    }
    if (op === 'close') {
      await db.prepare("UPDATE gym_campaigns SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE id = ?").bind(now, c.id).run();
      await db.prepare('UPDATE gym_invites SET revoked_at = COALESCE(revoked_at, ?) WHERE campaign_id = ?').bind(now, c.id).run();
      return { ok: true };
    }
    return fail('invalid_operation');
  });
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Organiser export: this campaign's active results only, display names, no emails or account ids. */
export async function exportCampaign(db, userId, campaignId) {
  return guarded(async () => {
    const { campaign: c } = await organiser(db, campaignId, userId);
    const rows = (await db.prepare(`SELECT m.display_name, r.local_date, r.seconds, r.corrected_seconds, r.correction_note FROM gym_results r JOIN gym_members m ON m.campaign_id = r.campaign_id AND m.user_id = r.user_id
      WHERE r.campaign_id = ? AND r.status = 'active' AND m.removed_at IS NULL ORDER BY m.display_name, r.local_date`).bind(c.id).all()).results;
    const lines = [['display_name', 'date', 'seconds_reported', 'seconds_after_correction', 'correction_note', 'self_reported'].join(',')];
    for (const r of rows) lines.push([r.display_name, r.local_date, r.seconds, r.corrected_seconds ?? r.seconds, r.correction_note, 'yes'].map(csvCell).join(','));
    return { filename: `${c.gym_name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-campaign.csv`, csv: lines.join('\n') + '\n' };
  });
}

/** A member may leave; their campaign results stop being shared but their own training log is untouched. */
export async function leaveCampaign(db, userId, campaignId, now = Math.floor(Date.now() / 1000)) {
  return guarded(async () => {
    await membership(db, campaignId, userId);
    await db.prepare('UPDATE gym_members SET removed_at = ? WHERE campaign_id = ? AND user_id = ?').bind(now, campaignId, userId).run();
    return { ok: true };
  });
}
