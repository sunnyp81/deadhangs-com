import { useEffect, useRef, useState } from 'react';
import { accountRequest, AccountError, accountErrorMessage, mergeAccountEntries, cloudProgress, trustedRedirect, signInBody } from '../lib/account-client.mjs';
import { STORAGE_KEY, MAX_ENTRIES, parseStoredLog, serializeLog, formatLocalDate, setupSummary } from '../lib/training-log.mjs';
import { trackFeature } from '../scripts/training-events.js';

const OWNER_KEY = 'dh.cloud-log-owner.v1';
const json = (method: string, body: unknown = {}) => ({ method, body: JSON.stringify(body) });
export default function AccountWorkspace({ pricing = false }: { pricing?: boolean }) {
  const [account, setAccount] = useState<any>(null), [billing, setBilling] = useState<any>(null), [cloud, setCloud] = useState<any>(null);
  const [state, setState] = useState('loading'), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [confirm, setConfirm] = useState(''), [ownsDevice, setOwnsDevice] = useState(false), [deviceCount, setDeviceCount] = useState(0);
  const generation = useRef(0);
  // Pricing page only, and only through the consented allowlist. /account/ loads no gtag, so these are no-ops there.
  const track = (feature: string) => { if (pricing) trackFeature(feature, { source: 'pro_page' }); };
  const active = billing?.entitlement?.active === true;
  const authenticated = (path: string, options: any = {}) => accountRequest(path, { ...options, headers: { ...options.headers, 'X-DeadHangs-Account-Key': account?.accountKey || '' } });
  async function refresh() {
    const run = ++generation.current;
    setOwnsDevice(false); setConfirm(''); setCloud(null); setAccount(null); setBilling(null); setState('loading');
    try {
      const a = await accountRequest('/api/account');
      const b = await accountRequest('/api/billing/status', { headers: { 'X-DeadHangs-Account-Key': a.accountKey } }).catch((e: any) => { if (e.code === 'account_changed') throw e; return null; });
      if (run !== generation.current) return;
      setAccount(a); setBilling(b); setState('signedin');
      if (!pricing) {
        const log = await accountRequest('/api/account/log', { headers: { 'X-DeadHangs-Account-Key': a.accountKey } });
        if (run === generation.current) setCloud(log);
      }
    } catch (e: any) {
      if (run !== generation.current) return;
      if (e.status === 401) setState('signedout');
      else if (e.status === 503) setState('unavailable');
      else { setState('error'); setError(accountErrorMessage(e)); }
    }
  }
  useEffect(() => {
    refresh();
    if (['account_error', 'error'].some(key => new URLSearchParams(location.search).has(key))) setError('Google sign-in did not finish. Please try again.');
    try { setDeviceCount(parseStoredLog(localStorage.getItem(STORAGE_KEY)).entries.length); } catch {}
    return () => { generation.current++; };
  }, []);
  async function action(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (e: any) {
      setError(accountErrorMessage(e));
      if (e.code === 'account_changed') { generation.current++; setAccount(null); setCloud(null); setBilling(null); setState('error'); setOwnsDevice(false); }
      if (e.status === 401) { generation.current++; setAccount(null); setCloud(null); setBilling(null); setState('signedout'); setOwnsDevice(false); }
    } finally { setBusy(false); }
  }
  async function signIn() {
    const result = await accountRequest('/api/auth/sign-in/social', json('POST', signInBody(pricing)));
    location.assign(trustedRedirect(result.url, 'google'));
  }
  async function pay(plan: string) {
    const result = await authenticated('/api/billing/checkout', json('POST', { plan }));
    location.assign(trustedRedirect(result.url, 'stripe'));
  }
  function readDevice() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = parseStoredLog(raw);
    if (parsed.status === 'corrupt' || parsed.dropped > 0) throw new AccountError('invalid_entries');
    const owner = localStorage.getItem(OWNER_KEY);
    if (!account?.accountKey) throw new AccountError('accounts_unavailable');
    if (owner && owner !== account.accountKey && parsed.entries.length) throw new AccountError('different_account');
    return { raw, entries: parsed.entries };
  }
  async function mergeToCloud() {
    const device = readDevice();
    // Check the current account again immediately before sending any local data.
    const current = await accountRequest('/api/account');
    if (current.accountKey !== account.accountKey) throw new AccountError('different_account');
    const entries = mergeAccountEntries(cloud.entries, device.entries, cloud.maxEntries);
    // Bind before the request: if the response is lost, this log cannot migrate to another account.
    localStorage.setItem(OWNER_KEY, account.accountKey);
    await authenticated('/api/account/log', json('PUT', { baseRevision: cloud.revision, entries }));
    setCloud(await authenticated('/api/account/log'));
    setOwnsDevice(false); setMessage('Device entries merged into your cloud log. Come back and merge again after recording new holds.');
  }
  async function restore() {
    const before = readDevice();
    const current = await accountRequest('/api/account');
    if (current.accountKey !== account.accountKey) throw new AccountError('different_account');
    const latest = await authenticated('/api/account/log');
    const merged = mergeAccountEntries(latest.entries, before.entries, MAX_ENTRIES);
    if (localStorage.getItem(STORAGE_KEY) !== before.raw) throw new AccountError('revision_conflict');
    localStorage.setItem(OWNER_KEY, account.accountKey);
    localStorage.setItem(STORAGE_KEY, serializeLog(merged));
    window.dispatchEvent(new Event('deadhangs:training-log-updated'));
    setDeviceCount(merged.length); setCloud(latest); setOwnsDevice(false); setMessage('Cloud entries merged into this device log. Existing device entries were kept.');
  }
  async function exportAccount() {
    const data = await authenticated('/api/account/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'deadhangs-account-export.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Account export downloaded. Keep it somewhere private.');
  }
  const prices = <div className="account-plans">
    <div><h3>Monthly</h3><p className="account-price">£4.99<span> / month</span></p><p>Billed monthly until cancelled.</p><button disabled={busy || !billing?.paidAvailable || active} onClick={() => { track('pro_plan_monthly_click'); action(() => pay('monthly')); }}>Choose monthly</button></div>
    <div><h3>Yearly</h3><p className="account-price">£39<span> / year</span></p><p>Billed yearly until cancelled.</p><button disabled={busy || !billing?.paidAvailable || active} onClick={() => { track('pro_plan_yearly_click'); action(() => pay('yearly')); }}>Choose yearly</button></div>
  </div>;
  return <div className="account-workspace" aria-busy={busy || state === 'loading'}>
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p className="account-notice" role="status">{message}</p>}
    {state === 'loading' && !pricing && <p role="status">Checking your account…</p>}
    {pricing && (state === 'loading' || state === 'signedout') && <section className="account-panel pro-action" aria-labelledby="pro-action-title"><h2 id="pro-action-title">Start with a free sign-in</h2><p>Sign in with Google and then choose monthly or yearly. Signing in is free and does not upload your device log.</p><button className="google-continue" disabled={busy || state === 'loading'} onClick={() => { track('pro_signin_click'); action(signIn); }}>Continue with Google</button>{state === 'loading' && <span className="account-visually-hidden" role="status">Checking your account…</span>}<p className="account-small">By continuing, you agree to the <a href="/terms/">terms</a> and acknowledge the <a href="/privacy/">privacy policy</a>. No marketing emails.</p></section>}
    {(state === 'unavailable' || state === 'error') && <section className="account-panel"><h2>{state === 'unavailable' ? 'Accounts are not available yet' : 'Could not load your account'}</h2><p>Your free timer and device log are still available.</p><button disabled={busy} onClick={() => action(refresh)}>Try again</button> <a href="/training-log/">Open the free timer</a></section>}
    {state === 'signedout' && !pricing && <section className="account-panel"><h2>One account. Your saved holds.</h2><p>Creating a Google account connection is free. Pro adds cloud sync and progress history. Signing in does not upload your device log.</p><button className="google-continue" disabled={busy} onClick={() => { track('pro_signin_click'); action(signIn); }}>Continue with Google</button><p className="account-small">By continuing, you agree to the <a href="/terms/">terms</a> and acknowledge the <a href="/privacy/">privacy policy</a>. No marketing subscription.</p></section>}
    {state === 'signedin' && <>
      <header className="account-identity"><div><h2>{active ? 'Your Pro account' : 'Your free account'}</h2><p>{account.user.email}</p></div><button disabled={busy} onClick={() => action(async () => { await accountRequest('/api/auth/sign-out', json('POST')); await refresh(); })}>Sign out</button></header>
      {active ? <section className="account-panel"><h3>Pro is active</h3><p>{billing.entitlement.cancelAtPeriodEnd ? 'Your subscription is cancelled. Pro access continues' : 'Your paid access runs'}{billing.entitlement.paidThrough ? ` until ${new Date(billing.entitlement.paidThrough).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. {billing.entitlement.cancelAtPeriodEnd ? 'You can restart renewal in billing.' : 'Manage renewal or cancel in billing.'}</p><button disabled={busy} onClick={() => action(async () => { const r = await authenticated('/api/billing/portal', json('POST')); location.assign(trustedRedirect(r.url, 'stripe')); })}>Manage billing</button>{pricing && <p><a href="/account/" data-dh-source="pro_page">Open your cloud log</a></p>}</section> : <section className={pricing ? 'account-panel pro-action' : 'account-panel'}><h3>{pricing ? 'Choose your plan' : 'Unlock cloud sync and progress history'}</h3>{pricing ? <p>Signed in. Pick monthly or yearly to continue to secure checkout.</p> : <p>The timer and on-device log stay free. Pro lets you merge your saved holds into your account and open them on another device. Includes up to {account?.limits?.maxEntries ?? 200} cloud entries.</p>}{prices}{!billing?.paidAvailable && <p role="status">Checkout is not available yet. No payment can be taken here.</p>}<p className="account-small">Cancel renewal in your account. Access continues until the end of the paid period. Export and delete remain available after Pro ends.</p></section>}
      {!active && (billing?.hasBillingAccount || !billing) && <section className="account-panel"><h3>Manage an existing subscription</h3><p>You can manage billing even when Pro access is inactive.</p><button disabled={busy} onClick={() => action(async () => { const r = await authenticated('/api/billing/portal', json('POST')); location.assign(trustedRedirect(r.url, 'stripe')); })}>Manage billing</button></section>}
      {!pricing && <>
        <section className="account-panel"><h2>Your cloud log</h2><p>{cloud ? `${cloud.entries.length} entries saved in your account (limit ${cloud.maxEntries}). ${deviceCount} entries on this device.` : 'Your cloud log could not be loaded.'}</p><button disabled={busy} onClick={() => action(refresh)}>Refresh cloud log</button>
          {active && cloud && <><p>Sync is manual. Record holds in the free timer, then merge them here. On another device, sign in to the same Google account and choose “Copy cloud entries to this device”.</p><label className="account-check"><input type="checkbox" checked={ownsDevice} onChange={e => setOwnsDevice(e.target.checked)} /> I confirm this device log belongs to this signed-in account.</label><div className="account-actions"><button disabled={busy || !ownsDevice || !deviceCount} onClick={() => action(mergeToCloud)}>Merge device entries into cloud</button><button disabled={busy || !ownsDevice || !cloud.entries.length} onClick={() => action(restore)}>Copy cloud entries to this device</button></div><p className="account-small">Matching entries are kept once. Conflicting entries stop the merge. Neither action replaces a whole log.</p></>}
          {!active && <p>Cloud sync and progress comparisons are locked on the free plan. Your existing cloud data remains exportable and deletable below.</p>}
        </section>
        {active && cloud && <section className="account-history"><h2>Progress from your cloud entries</h2><p>Daily best holds compared within the same recorded setup and entry type. Missing setup details stay grouped separately. These are your records, not health ratings.</p>{!cloud.entries.length ? <p>Merge your first device entries to start your history.</p> : <>{cloudProgress(cloud.entries).map((g: any) => <div className="account-progress" key={g.key}><h3>{g.kind}</h3><p>{g.label}{g.load ? ` · Exact added load: ${g.load} ${g.loadUnit}` : ''}</p><dl><div><dt>Best recorded</dt><dd>{g.best} s</dd></div><div><dt>Latest daily best</dt><dd>{g.latest[1]} s</dd></div><div><dt>Change from first day</dt><dd>{g.change === null ? 'Needs 2 days' : `${g.change > 0 ? '+' : ''}${g.change} s`}</dd></div></dl><p className="account-small">{formatLocalDate(g.first[0])} to {formatLocalDate(g.latest[0])} · {g.entries.length} entries</p></div>)}<p className="account-small">On small screens, scroll the history table sideways.</p><div className="account-table" tabIndex={0} role="region" aria-label="Cloud training history"><table><caption>All cloud entries, newest first</caption><thead><tr><th>Date</th><th>Hold</th><th>Sets</th><th>Setup</th></tr></thead><tbody>{[...cloud.entries].sort((a,b) => b.date.localeCompare(a.date)).map((e: any) => <tr key={e.id}><td>{formatLocalDate(e.date)}</td><td>{e.seconds} s</td><td>{e.sets}</td><td>{e.assistance === 'unassisted' ? 'Unassisted' : 'Feet supported'} · {setupSummary(e)}{e.kind === 'test' ? ' · Max test' : ''}</td></tr>)}</tbody></table></div></>}</section>}
        <section className="account-panel"><h2>Your data and access</h2><p>Export and delete are available on every plan. Cloud deletion does not erase copies already saved on devices. <a href="/training-log/">Manage the log on this device</a>.</p><div className="account-actions"><button disabled={busy} onClick={() => action(exportAccount)}>Download account export</button><button disabled={busy} onClick={() => setConfirm('sessions')}>Sign out every device</button><button disabled={busy || !cloud} onClick={() => setConfirm('cloud')}>Delete cloud log</button><button disabled={busy} onClick={() => setConfirm('account')}>Delete account</button></div>
          {confirm && <div className="account-confirm"><h3>{confirm === 'account' ? 'Delete your account and cloud data?' : confirm === 'cloud' ? 'Delete all cloud training entries?' : 'Sign out all devices?'}</h3><p>{confirm === 'account' ? 'This permanently removes your account and cloud log. Download an export first. Your local device log is kept. Deleting your account cancels your subscription immediately and ends paid access now. To keep access through your paid period, cancel renewal in Manage billing instead.' : confirm === 'cloud' ? 'This cannot be undone. Download an export first. Your account and local device log are kept.' : 'You will need to sign in again on each device.'}</p><button className="account-danger" disabled={busy} onClick={() => action(async () => {
            if (confirm === 'cloud') { await authenticated('/api/account/log', json('DELETE', { confirm: 'delete-cloud-log', baseRevision: cloud.revision })); await refresh(); setMessage('Cloud log deleted. Device copies are unchanged.'); }
            else if (confirm === 'account') { await authenticated('/api/account', json('DELETE', { confirm: 'delete-account' })); await refresh(); setMessage('Account deleted. Device copies are unchanged.'); }
            else { await authenticated('/api/account/sessions/revoke', json('POST')); await refresh(); }
          })}>Confirm {confirm === 'sessions' ? 'sign out' : 'deletion'}</button> <button disabled={busy} onClick={() => setConfirm('')}>Keep it</button></div>}
        </section>
      </>}
    </>}
  </div>;
}
