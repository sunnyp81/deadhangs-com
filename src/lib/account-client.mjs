import { compactEntry, normalizeStoredEntry, setupLabel } from './training-log.mjs';

export class AccountError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

export async function accountRequest(path, options = {}, fetcher = fetch) {
  const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AccountError(data?.error || 'request_failed', response.status);
  if (!data) throw new AccountError('invalid_response');
  return data;
}

/** A merge never chooses one version of a conflicting entry silently. */
export function mergeAccountEntries(cloud, device, maxEntries = 200) {
  const merged = new Map();
  for (const raw of [...cloud, ...device]) {
    const entry = normalizeStoredEntry(raw);
    if (!entry) throw new AccountError('invalid_entries');
    const old = merged.get(entry.id);
    if (old && JSON.stringify(compactEntry(old)) !== JSON.stringify(compactEntry(entry))) throw new AccountError('entry_conflict');
    merged.set(entry.id, entry);
  }
  if (merged.size > maxEntries) throw new AccountError('too_many_entries');
  return [...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Exact recorded setup and entry kind, rather than health ratings or population norms. */
export function cloudProgress(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = JSON.stringify([e.assistance, e.bar ?? null, e.grip ?? null, e.chalk ?? null, e.load ?? null, e.loadUnit ?? null, e.kind ?? 'session']);
    if (!groups.has(key)) groups.set(key, { key, label: setupLabel(e), kind: e.kind === 'test' ? 'Max tests' : 'Training sessions', entries: [] });
    groups.get(key).entries.push(e);
  }
  return [...groups.values()].map(group => {
    const daily = new Map();
    for (const e of group.entries) daily.set(e.date, Math.max(daily.get(e.date) || 0, e.seconds));
    const days = [...daily].sort(([a], [b]) => a.localeCompare(b));
    return { ...group, load: group.entries[0].load, loadUnit: group.entries[0].loadUnit,
      best: Math.max(...days.map(d => d[1])), first: days[0], latest: days.at(-1),
      change: days.length > 1 ? days.at(-1)[1] - days[0][1] : null };
  });
}

export function trustedRedirect(url, kind) {
  const parsed = new URL(url);
  const hosts = kind === 'google' ? ['accounts.google.com'] : ['checkout.stripe.com', 'billing.stripe.com'];
  if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname) || parsed.username || parsed.password) throw new AccountError('invalid_redirect');
  return parsed.href;
}

export const accountErrorMessage = (error) => ({
  account_changed: 'The signed-in account changed in another tab. Refresh this page before continuing. Nothing was transferred.',
  active_subscription: 'Cancel your subscription in Manage billing before deleting your account.',
  accounts_unavailable: 'Accounts are not available yet. Your free timer and device log still work.',
  signed_out: 'Your session has ended. Sign in again to continue.',
  revision_conflict: 'The cloud log changed on another device. Refresh the cloud log, review it, then merge again. Nothing was overwritten.',
  cloud_log_exists: 'A cloud log already exists. Refresh it before merging your device entries.',
  entry_conflict: 'An entry has different values on this device and in the cloud. Export both logs and resolve the difference before merging. Nothing was overwritten.',
  too_many_entries: 'The combined log exceeds the storage limit. Export a backup and remove unwanted entries before merging.',
  invalid_entries: 'Some saved entries could not be read. Open your device log to recover them before importing.',
  different_account: 'This device log is linked to another account. Sign in to that account, or export and clear the device log before using a different account.',
  pro_required: 'Cloud sync requires an active Pro subscription. Export and delete remain available.',
  billing_unavailable: 'Billing is unavailable. Refresh your account to check its status, or contact support. Use Manage billing to check an existing subscription.',
  billing_provider_unavailable: 'The payment provider could not be reached. Refresh your account before trying again; do not make another payment to resolve this message.',
  billing_not_launched: 'Checkout is not available yet. Your free tools remain available.',
  subscription_exists: 'This account already has a subscription. Use Manage billing to view it.',
  billing_busy: 'Your billing details are being updated. Wait a moment, then refresh your account.',
  billing_recovery_required: 'A previous billing request needs checking. Contact support before trying to pay or delete the account again.',
  billing_cancellation_unconfirmed: 'Cancellation could not be confirmed, so the account was kept. Use Manage billing or contact support before retrying deletion.',
}[error?.code] || 'That action could not finish here. Refresh your account to check its status before trying again.');
