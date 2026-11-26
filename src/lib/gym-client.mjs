// Browser-side helpers for the private gym challenge pages. Pure functions, tested without a browser.
// Campaign data is never kept in browser storage; the server is the only store.
export const GYM_PRICE_LABEL = '£99';
export const DISPLAY_NAME_MAX = 40;
export const MAX_SECONDS = 3600;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const param = (search, name) => {
  const values = new URLSearchParams(String(search || '')).getAll(name);
  return values.length === 1 ? values[0] : null;
};
/** Invite token from a query string, or null when it is missing, repeated or the wrong shape. */
export const inviteTokenFrom = (search) => { const v = param(search, 't'); return v && TOKEN.test(v) ? v : null; };
/** Campaign id from a query string, or null. */
export const campaignIdFrom = (search) => { const v = param(search, 'id'); return v && CAMPAIGN_ID.test(v) ? v : null; };
export const joinPath = (token) => `/gym/join/?t=${token}`;
export const campaignPath = (id) => `/gym/campaign/?id=${id}`;
export const joinUrl = (origin, token) => `${origin}${joinPath(token)}`;

export const isDate = (value) => {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** Whole seconds from 1 to 3600, or null. */
export function parseSeconds(text) {
  const t = String(text ?? '').trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_SECONDS ? n : null;
}

/** Date limits for the add-result form: the campaign window, capped at today so the future is not selectable. */
export function resultDateBounds(campaign, today) {
  const min = campaign.startsOn;
  if (today < min) return { min, max: min, value: min, open: false };
  const max = today < campaign.endsOn ? today : campaign.endsOn;
  return { min, max, value: max, open: true };
}

/** Plain lines for the hold rule. Assistance is always unassisted. */
export function ruleLines(rule) {
  const r = rule || {};
  const lines = [['Bar', r.bar], ['Grip', r.grip], ['Chalk', r.chalk], ['Assistance', r.assistance || 'unassisted']]
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '').map(([label, value]) => ({ label, value }));
  return { lines, note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : '' };
}

/** Adds 1-based ranks. Equal best times share a rank. The server already sorts best first. */
export function rankBoard(board) {
  let last = null; let rank = 0;
  return (board || []).map((row, i) => {
    if (row.best !== last) { rank = i + 1; last = row.best; }
    return { ...row, rank };
  });
}

/** The time that counts for a result: the organiser's correction when there is one. */
export const effectiveSeconds = (row) => (row.corrected_seconds ?? row.seconds);

export function validateJoin({ displayName, shareConsent }) {
  const name = String(displayName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Enter a display name.' };
  if (name.length > DISPLAY_NAME_MAX) return { error: `Use ${DISPLAY_NAME_MAX} characters or fewer.` };
  if (/[<>]/.test(name)) return { error: 'Leave out the characters < and >.' };
  if (shareConsent !== true) return { error: 'Tick the box to share your results with the organiser.' };
  return { error: null, name };
}

const EMAIL = /^\S+@\S+\.\S+$/;
const trimmed = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
/** Enquiry form values to the exact body the server accepts. Optional fields are left out when empty. */
export function enquiryBody(form) {
  const gymName = trimmed(form.gymName); const contactName = trimmed(form.contactName); const email = trimmed(form.email).toLowerCase();
  const location = trimmed(form.location); const members = trimmed(form.members);
  const message = String(form.message ?? '').trim().replace(/\s+/g, ' ');
  if (!gymName) return { error: 'Enter the gym name.' };
  if (!contactName) return { error: 'Enter your name.' };
  if (!EMAIL.test(email)) return { error: 'Enter a valid email address.' };
  if (form.consent !== true) return { error: 'Tick the box to agree to be contacted about a gym challenge pilot.' };
  if (gymName.length > 120 || contactName.length > 120 || email.length > 254 || location.length > 120 || members.length > 40) return { error: 'One of the answers is too long. Shorten it and try again.' };
  if (message.length > 1000) return { error: 'The message is too long. Keep it under 1,000 characters.' };
  if ([gymName, contactName, email, location, members, message].some((v) => /[<>]/.test(v))) return { error: 'Leave out the characters < and >.' };
  const body = { gymName, contactName, email, consent: true, website: String(form.website ?? '') };
  if (location) body.location = location;
  if (members) body.members = members;
  if (message) body.message = message;
  return { error: null, body };
}

/** The correction form's values, or an error sentence. */
export function correctionInput(secondsText, note) {
  const seconds = parseSeconds(secondsText);
  if (seconds === null) return { error: 'Enter whole seconds from 1 to 3600.' };
  const text = trimmed(note);
  if (!text) return { error: 'Add a short note saying why.' };
  if (text.length > 200) return { error: 'Keep the note to 200 characters.' };
  if (/[<>]/.test(text)) return { error: 'Leave out the characters < and >.' };
  return { error: null, seconds, note: text };
}

const MESSAGES = {
  signed_out: 'Your session has ended. Sign in again to continue.',
  account_changed: 'The signed-in account changed in another tab. Refresh this page. Nothing was changed.',
  invite_invalid: 'This invite has expired, was revoked or has been used.',
  campaign_closed: 'This challenge is closed, so nothing more can be added.',
  removed: 'You were removed from this challenge, so you cannot join it again.',
  consent_required: 'Tick the consent box to continue.',
  missing_field: 'Fill in the required fields.',
  invalid_field: 'One of the answers could not be used. Check it and try again.',
  invalid_email: 'That email address does not look right. Check it and try again.',
  invalid_seconds: 'Enter whole seconds from 1 to 3600.',
  outside_campaign_dates: 'That date is outside the challenge dates.',
  rule_not_confirmed: 'Tick the box to say you followed the rule.',
  id_conflict: 'That result was already saved with different values. The latest version is showing now.',
  organiser_only: 'Only the organiser can do that.',
  not_found: 'That challenge was not found, or you are not part of it.',
  gym_unavailable: 'The gym challenge is not available right now. Nothing was changed.',
  network: 'Could not reach the server. Nothing was changed. Check your connection and try again.',
  request_failed: 'That could not be done. Nothing was changed.',
};
/** Plain sentence for an API error. 503 always reads "not available", never a raw code. */
export function gymErrorMessage(error) {
  if (error?.status === 503) return MESSAGES.gym_unavailable;
  return MESSAGES[error?.code] || MESSAGES.request_failed;
}

/** Whether the page should reload the server version after this error. */
export const gymShouldRefetch = (error) => ['id_conflict', 'campaign_closed', 'not_found'].includes(error?.code);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Date for display, for example 3 Dec 2026. Input is YYYY-MM-DD. */
export function formatDay(value) {
  if (!isDate(value)) return value || '';
  const [y, m, d] = value.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
