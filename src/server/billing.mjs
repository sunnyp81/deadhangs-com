/** Stripe snapshot API 2026-10-28.endive. Never log provider bodies or credentials. */
export const STRIPE_API_VERSION = '2026-10-28.endive';
export const BILLING_PRICES = Object.freeze({ monthly: 499, yearly: 3900, currency: 'GBP' });
const APP = 'deadhangs';
const MAX_BODY = 262144;
const LOCK_SECONDS = 120;
const CACHE_SECONDS = 300;
const TERMINAL = new Set(['canceled', 'incomplete_expired']);
const EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.voided',
  'invoice.marked_uncollectible', 'charge.refunded', 'charge.dispute.created',
  'charge.dispute.updated', 'charge.dispute.closed']);
const idOf = (value) => typeof value === 'string' ? value : value?.id;
const paidAmount = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
const cleanId = (id, prefix) => typeof id === 'string' && new RegExp(`^${prefix}_${prefix === 'cs' ? '(?:live_|test_)?' : ''}[A-Za-z0-9]+$`).test(id);
const FREE = Object.freeze({ active: false, plan: 'free', paidThrough: null, cancelAtPeriodEnd: false, status: 'none' });

export class BillingError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

export async function readBoundedBody(request, limit = MAX_BODY) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new BillingError('payload_too_large', 413);
  if (!request.body) return '';
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new BillingError('payload_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new BillingError('invalid_json', 400); }
}

export async function verifyStripeSignature(raw, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof header !== 'string' || header.length > 2048 || typeof secret !== 'string') return false;
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0][1] || '')) return false;
  const timestamp = Number(timestamps[0][1]);
  if (now - timestamp > 300 || timestamp - now > 60) return false;
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value || ''));
  if (!signatures.length || signatures.length > 8) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const input = encoder.encode(`${timestamp}.${raw}`);
  for (const [, hex] of signatures) {
    const signature = Uint8Array.from(hex.match(/../g), (byte) => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, input)) return true;
  }
  return false;
}

export function billingConfigured(env) {
  let origin;
  try { origin = new URL(env.AUTH_BASE_URL); } catch { return false; }
  const test = env.BILLING_MODE === 'test';
  if (env.BILLING_MODE && !['live', 'test'].includes(env.BILLING_MODE)) return false;
  if (test && (origin.hostname === 'deadhangs.com' || origin.hostname === 'www.deadhangs.com')) return false;
  return env.BILLING_ENABLED === 'true' && Boolean(env.DB) &&
    origin.protocol === 'https:' && origin.origin === env.AUTH_BASE_URL &&
    new RegExp(`^(sk|rk)_${test ? 'test' : 'live'}_[A-Za-z0-9]+$`).test(env.STRIPE_SECRET_KEY || '') &&
    /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET || '') &&
    cleanId(env.STRIPE_ACCOUNT_ID, 'acct') && cleanId(env.STRIPE_PRODUCT_ID, 'prod') &&
    cleanId(env.STRIPE_MONTHLY_PRICE_ID, 'price') && cleanId(env.STRIPE_YEARLY_PRICE_ID, 'price') &&
    env.STRIPE_MONTHLY_PRICE_ID !== env.STRIPE_YEARLY_PRICE_ID && cleanId(env.STRIPE_PORTAL_CONFIGURATION_ID, 'bpc');
}

/** Request-scoped service. options supplies only test doubles, never client input. */
export function createBillingService(env, options = {}) {
  const db = env.DB;
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  const fetcher = options.fetch || globalThis.fetch;
  const mode = env.BILLING_MODE === 'test' ? 'test' : 'live';
  const live = mode === 'live';
  const q = (sql, ...values) => db.prepare(sql).bind(...values);
  const ready = () => { if (!billingConfigured(env)) throw new BillingError('billing_unavailable'); };
  const owned = (object, row) => object?.metadata?.app === APP && object?.metadata?.deadhangs_user_ref === row.app_user_ref;
  const pricePlan = (id) => id === env.STRIPE_MONTHLY_PRICE_ID ? 'monthly' : id === env.STRIPE_YEARLY_PRICE_ID ? 'yearly' : null;

  async function stripe(path, method = 'GET', fields = null, idempotencyKey) {
    ready();
    if (!path.startsWith('/v1/') || path.includes('..')) throw new BillingError('billing_configuration_error');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_API_VERSION };
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      let body;
      if (fields) { body = new URLSearchParams(fields); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
      const response = await fetcher(`https://api.stripe.com${path}`, { method, headers, body, signal: controller.signal });
      const text = await readBoundedBody(response);
      if (!response.ok) throw new BillingError(response.status === 404 ? 'billing_object_missing' : 'billing_provider_unavailable');
      try { return JSON.parse(text); } catch { throw new BillingError('billing_provider_unavailable'); }
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError('billing_provider_unavailable');
    } finally { clearTimeout(timer); }
  }

  async function verifyAccount(requireCharges = false) {
    const account = await stripe('/v1/account');
    if (account.id !== env.STRIPE_ACCOUNT_ID || (requireCharges && live && account.charges_enabled !== true)) throw new BillingError('billing_configuration_error');
  }

  async function account(userId, create = false) {
    if (!db) throw new BillingError('billing_unavailable');
    if (create) await q('INSERT OR IGNORE INTO billing_accounts (user_id, app_user_ref, created_at) VALUES (?, ?, ?)', userId, crypto.randomUUID(), now()).run();
    return q('SELECT * FROM billing_accounts WHERE user_id = ?', userId).first();
  }

  async function locked(row, fn) {
    const token = crypto.randomUUID();
    const acquired = await q('UPDATE billing_accounts SET lock_token = ?, lock_until = ? WHERE user_id = ? AND lock_until < ?', token, now() + LOCK_SECONDS, row.user_id, now()).run();
    if (acquired.meta.changes !== 1) throw new BillingError('billing_busy', 409);
    try {
      const fresh = await account(row.user_id);
      return await fn(fresh, token);
    } finally {
      await q('UPDATE billing_accounts SET lock_token = NULL, lock_until = 0 WHERE user_id = ? AND lock_token = ?', row.user_id, token).run();
    }
  }

  async function guardLock(row, token) {
    const current = await q('SELECT lock_token, lock_until FROM billing_accounts WHERE user_id = ?', row.user_id).first();
    if (!current || current.lock_token !== token || current.lock_until <= now()) throw new BillingError('billing_busy', 409);
  }

  async function customer(row, token) {
    if (row.stripe_customer_id) {
      if (row.provider_mode !== mode) throw new BillingError('billing_ownership_mismatch');
      const found = await stripe(`/v1/customers/${row.stripe_customer_id}`);
      if (found.deleted || found.livemode !== live || !owned(found, row)) throw new BillingError('billing_ownership_mismatch');
      return found.id;
    }
    // Stripe only promises idempotency-key retention for 24h. An unresolved old
    // create must be reconciled by an operator; never silently create a duplicate.
    if (row.customer_started_at && row.provider_mode !== mode) throw new BillingError('billing_ownership_mismatch');
    if (row.customer_started_at && now() - row.customer_started_at >= 23 * 3600) throw new BillingError('billing_recovery_required');
    if (!row.customer_started_at) {
      const result = await q('UPDATE billing_accounts SET customer_started_at=?,provider_mode=? WHERE user_id=? AND lock_token=? AND lock_until>?', now(), mode, row.user_id, token, now()).run();
      if (result.meta.changes !== 1) throw new BillingError('billing_busy', 409);
      row.provider_mode = mode;
    }
    await guardLock(row, token);
    const created = await stripe('/v1/customers', 'POST', {
      'metadata[app]': APP, 'metadata[deadhangs_user_ref]': row.app_user_ref,
    }, `deadhangs:customer:${row.app_user_ref}`);
    if (!cleanId(created.id, 'cus') || created.livemode !== live || !owned(created, row)) throw new BillingError('billing_ownership_mismatch');
    await guardLock(row, token);
    const result = await q('UPDATE billing_accounts SET stripe_customer_id = ?,provider_mode = ? WHERE user_id = ? AND lock_token = ? AND lock_until > ?', created.id, mode, row.user_id, token, now()).run();
    if (result.meta.changes !== 1) throw new BillingError('billing_busy', 409);
    row.stripe_customer_id = created.id;
    row.provider_mode = mode;
    return created.id;
  }

  function validPrice(price) {
    const plan = pricePlan(price?.id);
    return plan && price.livemode === live && idOf(price.product) === env.STRIPE_PRODUCT_ID &&
      price.currency === 'gbp' && price.unit_amount === BILLING_PRICES[plan] &&
      price.type === 'recurring' && price.recurring?.interval === (plan === 'monthly' ? 'month' : 'year') &&
      price.recurring?.interval_count === 1 && !price.recurring?.trial_period_days;
  }

  async function listSubscriptions(row, allowMultiple = false) {
    const list = await stripe(`/v1/subscriptions?customer=${row.stripe_customer_id}&status=all&limit=100`);
    if (!Array.isArray(list.data) || list.has_more) throw new BillingError('billing_recovery_required');
    const relevant = list.data.filter((sub) => owned(sub, row));
    if (list.data.some((sub) => !owned(sub, row) && !TERMINAL.has(sub.status))) throw new BillingError('billing_ownership_mismatch');
    for (const sub of relevant) {
      if (idOf(sub.customer) !== row.stripe_customer_id || sub.livemode !== live || !cleanId(sub.id, 'sub')) throw new BillingError('billing_ownership_mismatch');
      if (!TERMINAL.has(sub.status) && (!Array.isArray(sub.items?.data) || sub.items.data.length !== 1 || !validPrice(sub.items.data[0].price))) throw new BillingError('billing_ownership_mismatch');
    }
    if (!allowMultiple && relevant.filter((sub) => !TERMINAL.has(sub.status)).length > 1) throw new BillingError('billing_recovery_required');
    return relevant;
  }

  async function invoiceFunded(invoice, row, expectedAmount) {
    if (invoice?.livemode !== live || idOf(invoice.customer) !== row.stripe_customer_id || invoice.status !== 'paid' ||
        !paidAmount(invoice.amount_paid, expectedAmount) || invoice.amount_remaining !== 0 || invoice.currency !== 'gbp' || invoice.paid_out_of_band) return false;
    const payments = await stripe(`/v1/invoice_payments?invoice=${invoice.id}&status=paid&limit=100`);
    // This product takes one card payment per invoice. Unsupported multi-payment,
    // credit-only or externally-paid invoices require review rather than free Pro.
    if (payments.has_more || payments.data?.length !== 1) return false;
    const paid = payments.data[0];
    if (paid.livemode !== live || paid.status !== 'paid' || !paidAmount(paid.amount_paid, expectedAmount) ||
        idOf(paid.invoice) !== invoice.id || paid.payment?.type !== 'payment_intent' || !cleanId(idOf(paid.payment.payment_intent), 'pi')) return false;
    const intent = await stripe(`/v1/payment_intents/${idOf(paid.payment.payment_intent)}?expand[]=latest_charge`);
    const charge = intent.latest_charge;
    if (intent.livemode !== live || intent.status !== 'succeeded' || idOf(intent.customer) !== row.stripe_customer_id ||
        !paidAmount(intent.amount_received, expectedAmount) || intent.currency !== 'gbp' || !charge || typeof charge !== 'object' ||
        charge.livemode !== live || charge.paid !== true || charge.captured !== true || idOf(charge.customer) !== row.stripe_customer_id ||
        !paidAmount(charge.amount, expectedAmount) || !paidAmount(charge.amount_refunded, 0) || charge.currency !== 'gbp' ||
        charge.amount_refunded >= charge.amount || charge.refunded === true) return false;
    if (charge.disputed) {
      const disputes = await stripe(`/v1/disputes?charge=${charge.id}&limit=100`);
      if (disputes.has_more || !disputes.data?.length || disputes.data.some((d) => d.livemode !== live || idOf(d.charge) !== charge.id || !['won', 'warning_closed'].includes(d.status))) return false;
    }
    // A partial goodwill refund retains the paid term; full refund/dispute revokes.
    return true;
  }

  async function subscriptionState(sub, row) {
    const items = sub.items?.data;
    const base = { id: sub.id, price: '', status: sub.status, paidThrough: 0, cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || (Number.isSafeInteger(sub.cancel_at) && sub.cancel_at > 0)), eligible: false };
    if (!Array.isArray(items) || items.length !== 1 || sub.items.has_more || !validPrice(items[0].price) || items[0].quantity !== 1) return base;
    base.price = items[0].price.id;
    if (sub.status !== 'active' || sub.pause_collection || sub.trial_end || !cleanId(idOf(sub.latest_invoice), 'in')) return base;
    const end = items[0].current_period_end;
    const start = items[0].current_period_start;
    if (!Number.isSafeInteger(end) || !Number.isSafeInteger(start) || end <= now() || start > now()) return base;
    const invoice = await stripe(`/v1/invoices/${idOf(sub.latest_invoice)}`);
    const invoiceSub = idOf(invoice.parent?.subscription_details?.subscription);
    if (invoiceSub !== sub.id || invoice.lines?.has_more || !Array.isArray(invoice.lines?.data)) return base;
    const fundedLine = invoice.lines.data.find((line) => idOf(line.pricing?.price_details?.price) === base.price &&
      line.period?.start <= start && line.period?.end >= end);
    if (!fundedLine || !(await invoiceFunded(invoice, row, BILLING_PRICES[pricePlan(base.price)]))) return base;
    base.paidThrough = Math.min(end, sub.cancel_at || end);
    base.eligible = base.paidThrough > now();
    return base;
  }

  async function reconcile(row, token) {
    if (!row.stripe_customer_id || row.deleting) return { ...FREE, status: row.deleting ? 'deleting' : 'none' };
    await customer(row, token);
    const subscriptions = await listSubscriptions(row);
    const states = [];
    for (const sub of subscriptions) states.push(await subscriptionState(sub, row));
    await guardLock(row, token);
    // Every write in the atomic batch is fenced. A stalled request must never
    // overwrite a new lease holder's state, even after its final guard returned.
    const fence = 'EXISTS (SELECT 1 FROM billing_accounts WHERE user_id=? AND lock_token=? AND lock_until>? AND deleting=0)';
    const stamp = now();
    const statements = [q(`DELETE FROM billing_subscriptions WHERE user_id=? AND ${fence}`, row.user_id, row.user_id, token, stamp)];
    for (const state of states) statements.push(q(`INSERT INTO billing_subscriptions (stripe_subscription_id,user_id,stripe_customer_id,stripe_price_id,status,paid_through,cancel_at_period_end,verified_at,eligible) SELECT ?,?,?,?,?,?,?,?,? WHERE ${fence}`,
      state.id, row.user_id, row.stripe_customer_id, state.price, state.status, state.paidThrough, Number(state.cancelAtPeriodEnd), stamp, Number(state.eligible), row.user_id, token, stamp));
    statements.push(q('UPDATE billing_accounts SET verified_at=? WHERE user_id=? AND lock_token=? AND lock_until>? AND deleting=0', stamp, row.user_id, token, stamp));
    const results = await db.batch(statements);
    if (results.at(-1).meta.changes !== 1) throw new BillingError('billing_busy', 409);
    return entitlementFromStates(states, now());
  }

  async function getEntitlement(userId, { refresh = false } = {}) {
    const row = await account(userId);
    if (!row || !row.stripe_customer_id) return { ...FREE };
    // Even cached entitlements are mode-bound; a preview database copied by
    // mistake can never turn test payments into production Pro access.
    if (row.provider_mode !== mode || (mode === 'test' && !billingConfigured(env))) return { ...FREE, status: 'unverified' };
    if (row.deleting) return { ...FREE, status: 'deleting' };
    const entries = await q('SELECT * FROM billing_subscriptions WHERE user_id = ?', userId).all();
    if (!refresh && row.verified_at > now() - CACHE_SECONDS) return entitlementFromStates(entries.results.map((s) => ({
      eligible: Boolean(s.eligible), status: s.status, paidThrough: s.paid_through, cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    })), now());
    ready();
    return locked(row, async (fresh, token) => { await verifyAccount(); return reconcile(fresh, token); });
  }

  async function checkout(user, plan) {
    ready();
    if (env.BILLING_LAUNCH_ENABLED !== 'true') throw new BillingError('billing_not_launched');
    if (!['monthly', 'yearly'].includes(plan)) throw new BillingError('invalid_plan', 400);
    const row = await account(user.id, true);
    return locked(row, async (fresh, token) => {
      if (fresh.deleting) throw new BillingError('account_deleting', 409);
      await verifyAccount(true);
      const priceId = plan === 'monthly' ? env.STRIPE_MONTHLY_PRICE_ID : env.STRIPE_YEARLY_PRICE_ID;
      const price = await stripe(`/v1/prices/${priceId}`);
      const product = await stripe(`/v1/products/${env.STRIPE_PRODUCT_ID}`);
      if (!validPrice(price) || !price.active || !product.active || product.livemode !== live || product.metadata?.app !== APP) throw new BillingError('billing_configuration_error');
      await customer(fresh, token);
      const existing = await listSubscriptions(fresh);
      if (existing.some((sub) => !TERMINAL.has(sub.status))) throw new BillingError('subscription_exists', 409);
      if (fresh.checkout_session_id) {
        const session = await stripe(`/v1/checkout/sessions/${fresh.checkout_session_id}`);
        if (!owned(session, fresh) || session.livemode !== live || session.mode !== 'subscription' || idOf(session.customer) !== fresh.stripe_customer_id) throw new BillingError('billing_ownership_mismatch');
        if (session.status === 'open') {
          if (fresh.checkout_plan !== plan) throw new BillingError('checkout_in_progress', 409);
          return { url: checkedUrl(session.url, 'checkout.stripe.com') };
        }
        if (session.status === 'complete') {
          // Do not create a second subscription while Stripe is still finalising.
          if (!TERMINAL.has((await stripe(`/v1/subscriptions/${idOf(session.subscription)}`)).status)) throw new BillingError('subscription_exists', 409);
        }
      }
      let generation = fresh.checkout_generation;
      let started = fresh.checkout_started_at;
      let expires = fresh.checkout_expires_at;
      if (!started || fresh.checkout_session_id) {
        generation += 1; started = now(); expires = started + 3600;
        await q('UPDATE billing_accounts SET checkout_generation=?,checkout_started_at=?,checkout_expires_at=?,checkout_plan=?,checkout_session_id=NULL WHERE user_id=? AND lock_token=?', generation, started, expires, plan, fresh.user_id, token).run();
      } else if (fresh.checkout_plan !== plan || now() - started >= 23 * 3600) {
        throw new BillingError('billing_recovery_required');
      }
      await guardLock(fresh, token);
      const session = await stripe('/v1/checkout/sessions', 'POST', {
        mode: 'subscription', customer: fresh.stripe_customer_id,
        'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        allow_promotion_codes: 'false',
        'adaptive_pricing[enabled]': 'false',
        success_url: `${env.AUTH_BASE_URL}/account/?billing=success`, cancel_url: `${env.AUTH_BASE_URL}/account/?billing=cancelled`,
        expires_at: String(expires),
        'metadata[app]': APP, 'metadata[deadhangs_user_ref]': fresh.app_user_ref,
        'subscription_data[metadata][app]': APP, 'subscription_data[metadata][deadhangs_user_ref]': fresh.app_user_ref,
        'branding_settings[display_name]': 'DeadHangs',
        'consent_collection[terms_of_service]': 'required',
        'custom_text[terms_of_service_acceptance][message]': `I agree to the [DeadHangs terms](${env.AUTH_BASE_URL}/terms/) and acknowledge the [privacy policy](${env.AUTH_BASE_URL}/privacy/).`,
        'custom_text[submit][message]': `DeadHangs Pro renews at GBP ${plan === 'monthly' ? '4.99 per month' : '39 per year'} until cancelled. Cancel through your account before renewal. Access continues to the end of your paid term.`,
      }, `deadhangs:checkout:${fresh.app_user_ref}:${generation}`);
      if (!cleanId(session.id, 'cs') || session.livemode !== live || !owned(session, fresh) ||
          idOf(session.customer) !== fresh.stripe_customer_id || session.mode !== 'subscription') throw new BillingError('billing_ownership_mismatch');
      await guardLock(fresh, token);
      await q('UPDATE billing_accounts SET checkout_session_id=? WHERE user_id=? AND lock_token=?', session.id, fresh.user_id, token).run();
      return { url: checkedUrl(session.url, 'checkout.stripe.com') };
    });
  }

  async function portal(userId) {
    ready();
    const row = await account(userId);
    if (!row?.stripe_customer_id) throw new BillingError('no_billing_account', 409);
    await verifyAccount();
    await customer(row);
    const config = await stripe(`/v1/billing_portal/configurations/${env.STRIPE_PORTAL_CONFIGURATION_ID}`);
    if (!config.active || config.livemode !== live || config.metadata?.app !== APP ||
        config.features?.subscription_update?.enabled || !config.features?.subscription_cancel?.enabled ||
        config.features.subscription_cancel.mode !== 'at_period_end') throw new BillingError('billing_configuration_error');
    const session = await stripe('/v1/billing_portal/sessions', 'POST', {
      customer: row.stripe_customer_id, configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
      return_url: `${env.AUTH_BASE_URL}/account/`,
    });
    if (session.customer !== row.stripe_customer_id || session.livemode !== live) throw new BillingError('billing_ownership_mismatch');
    return { url: checkedUrl(session.url, 'billing.stripe.com') };
  }

  async function status(userId) {
    let entitlement;
    const hasBillingAccount = Boolean((await account(userId))?.stripe_customer_id);
    try { entitlement = await getEntitlement(userId, { refresh: true }); }
    catch (error) {
      if (!(error instanceof BillingError)) throw error;
      return { plan: 'free', entitlement: { ...FREE, status: 'unverified' }, hasBillingAccount, paidAvailable: false, prices: BILLING_PRICES, billingUnavailableReason: error.code };
    }
    return { plan: entitlement.plan, entitlement, hasBillingAccount, paidAvailable: billingConfigured(env) && env.BILLING_LAUNCH_ENABLED === 'true', prices: BILLING_PRICES };
  }

  async function webhook(request) {
    ready();
    const raw = await readBoundedBody(request);
    if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, now()))) throw new BillingError('invalid_signature', 400);
    let event;
    try { event = JSON.parse(raw); } catch { throw new BillingError('invalid_json', 400); }
    if (!cleanId(event.id, 'evt') || !event.data?.object) throw new BillingError('invalid_event', 400);
    if (event.livemode !== live || !EVENTS.has(event.type) || (event.account && event.account !== env.STRIPE_ACCOUNT_ID)) return { received: true, ignored: true };
    if (await q('SELECT stripe_event_id FROM billing_events WHERE stripe_event_id=?', event.id).first()) return { received: true, duplicate: true };
    let object = event.data.object;
    if (event.type.startsWith('charge.dispute.')) {
      if (!cleanId(idOf(object.charge), 'ch')) return { received: true, ignored: true };
      object = await stripe(`/v1/charges/${idOf(object.charge)}`);
    }
    const customerId = idOf(object.customer);
    if (!cleanId(customerId, 'cus')) return { received: true, ignored: true };
    const row = await q('SELECT * FROM billing_accounts WHERE stripe_customer_id=?', customerId).first();
    if (!row) return { received: true, ignored: true };
    return locked(row, async (fresh, token) => {
      if (await q('SELECT stripe_event_id FROM billing_events WHERE stripe_event_id=?', event.id).first()) return { received: true, duplicate: true };
      await verifyAccount();
      // Snapshot contents and event creation times are never entitlement inputs.
      // Serialised reconciliation always fetches current provider state instead.
      await reconcile(fresh, token);
      await q('INSERT OR IGNORE INTO billing_events (stripe_event_id,handled_at) VALUES (?,?)', event.id, now()).run();
      return { received: true };
    });
  }

  async function prepareDeletion(userId) {
    // Create a tombstone even for never-paying users: deletion and the first
    // checkout must contend on the same lock before the auth row is removed.
    const row = await account(userId, true);
    return locked(row, async (fresh, token) => {
      await q('UPDATE billing_accounts SET deleting=1 WHERE user_id=? AND lock_token=?', userId, token).run();
      // A failed preparation keeps the account, so lift the tombstone; otherwise checkout and retries stay blocked.
      try { await cancelForDeletion(fresh, token); }
      catch (error) { await q('UPDATE billing_accounts SET deleting=0 WHERE user_id=? AND lock_token=?', userId, token).run(); throw error; }
    });
  }

  async function cancelForDeletion(fresh, token) {
    const userId = fresh.user_id;
    if (!fresh.stripe_customer_id && !fresh.customer_started_at) return;
    ready();
    if (!fresh.stripe_customer_id) throw new BillingError('billing_recovery_required');
    await verifyAccount();
    await customer(fresh, token);
    if (fresh.checkout_started_at && !fresh.checkout_session_id) {
      // The session id was never stored (creation failed or its response was lost): expire any owned open session.
      const list = await stripe(`/v1/checkout/sessions?customer=${encodeURIComponent(fresh.stripe_customer_id)}&status=open&limit=100`);
      if (!Array.isArray(list.data) || list.has_more) throw new BillingError('billing_recovery_required');
      for (const open of list.data) {
        if (!owned(open, fresh) || open.livemode !== live || open.status !== 'open') continue;
        await guardLock(fresh, token);
        const expired = await stripe(`/v1/checkout/sessions/${open.id}/expire`, 'POST', {}, `deadhangs:expire:${open.id}`);
        if (expired.id !== open.id || expired.status !== 'expired') throw new BillingError('billing_cancellation_unconfirmed');
      }
    }
    if (fresh.checkout_session_id) {
      const session = await stripe(`/v1/checkout/sessions/${fresh.checkout_session_id}`);
      if (!owned(session, fresh) || session.livemode !== live || idOf(session.customer) !== fresh.stripe_customer_id) throw new BillingError('billing_ownership_mismatch');
      if (session.status === 'open') {
        await guardLock(fresh, token);
        const expired = await stripe(`/v1/checkout/sessions/${session.id}/expire`, 'POST', {}, `deadhangs:expire:${session.id}`);
        if (expired.id !== session.id || expired.status !== 'expired' || expired.livemode !== live || !owned(expired, fresh)) throw new BillingError('billing_cancellation_unconfirmed');
      }
    }
    const subscriptions = await listSubscriptions(fresh, true);
    for (const sub of subscriptions) if (!TERMINAL.has(sub.status)) {
      await guardLock(fresh, token);
      await stripe(`/v1/subscriptions/${sub.id}`, 'DELETE', { invoice_now: 'false', prorate: 'false' });
    }
    if ((await listSubscriptions(fresh, true)).some((sub) => !TERMINAL.has(sub.status))) throw new BillingError('billing_cancellation_unconfirmed');
    await guardLock(fresh, token);
    await q('UPDATE billing_subscriptions SET eligible=0,paid_through=0,status=? WHERE user_id=? AND EXISTS (SELECT 1 FROM billing_accounts WHERE user_id=? AND lock_token=? AND lock_until>?)', 'canceled', userId, userId, token, now()).run();
  }

  return { getEntitlement, checkout, portal, status, webhook, prepareDeletion };
}

function checkedUrl(value, hostname) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password) return value;
  } catch { /* fail closed */ }
  throw new BillingError('billing_provider_unavailable');
}

export function entitlementFromStates(states, now = Math.floor(Date.now() / 1000)) {
  const paid = states.filter((state) => state.eligible && state.status === 'active' && state.paidThrough > now)
    .sort((a, b) => b.paidThrough - a.paidThrough)[0];
  return paid ? { active: true, plan: 'pro', paidThrough: new Date(paid.paidThrough * 1000).toISOString(), cancelAtPeriodEnd: paid.cancelAtPeriodEnd, status: 'active' }
    : { ...FREE, status: states[0]?.status || 'none' };
}

export const getEntitlement = (env, userId, options) => createBillingService(env).getEntitlement(userId, options);
export async function requireProEntitlement(env, userId) {
  const entitlement = await getEntitlement(env, userId);
  if (!entitlement.active) throw new BillingError('pro_required', 402);
  return entitlement;
}
export const prepareBillingAccountDeletion = (env, userId) => createBillingService(env).prepareDeletion(userId);
