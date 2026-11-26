// Server-side sales gate for paid programmes. Pure: callers pass the manifest and env.
// Live sales need BOTH an approved manifest (real reviewer recorded for this version, terms set,
// promised assets available) AND the production launch flag with a valid price id.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;
const APPROVED = new Set(['approved', 'published']);
export const CONTENT_STATUSES = Object.freeze(['draft', 'ready_for_review', 'approved', 'published']);
const PRODUCTION_HOSTS = new Set(['deadhangs.com', 'www.deadhangs.com']);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

/** Problems that stop the manifest itself being sold, whatever the env says. Empty array means content is releasable. */
export function contentProblems(manifest, today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest_missing'];
  if (!CONTENT_STATUSES.includes(manifest.status)) problems.push('status_invalid');
  if (!APPROVED.has(manifest.status)) problems.push('content_not_approved');
  const review = manifest.review || {};
  for (const field of ['reviewerName', 'reviewerRole', 'qualification', 'qualificationVerifiedBy', 'scope', 'evidence']) {
    if (!text(review[field])) problems.push(`review_${field}_missing`);
  }
  if (review.reviewedVersion !== manifest.version) problems.push('review_version_mismatch');
  if (!DATE.test(review.approvedAt || '') || review.approvedAt > today) problems.push('review_date_invalid');
  const terms = manifest.terms || {};
  for (const field of ['access', 'support', 'refund']) if (!text(terms[field])) problems.push(`terms_${field}_missing`);
  const assets = new Map((manifest.assets || []).map((asset) => [asset.id, asset]));
  for (const item of manifest.inclusions || []) {
    if (!item.promised) continue;
    if (item.asset && assets.get(item.asset)?.available !== true) problems.push(`asset_${item.asset}_unavailable`);
    if (item.feature) problems.push(`feature_${item.feature}_unverified`);
  }
  if (!Number.isSafeInteger(manifest.price?.amount) || manifest.price.amount <= 0 || manifest.price.currency !== 'gbp') problems.push('price_invalid');
  return problems;
}

function productionOrigin(env) {
  try { return PRODUCTION_HOSTS.has(new URL(env.AUTH_BASE_URL).hostname); } catch { return true; }
}

/**
 * Whether new purchases may start. Returns { open, mode: 'live' | 'test-draft' | null, reasons }.
 * `billingReady` is billingConfigured(env) from billing.mjs, passed in to keep this module pure.
 */
export function programmeSalesState(manifest, env, billingReady, today) {
  const reasons = [];
  if (!billingReady) reasons.push('billing_unavailable');
  if (env?.PROGRAMME_LAUNCH_ENABLED !== 'true') reasons.push('launch_flag_off');
  const priceEnv = manifest?.billing?.priceEnv;
  if (!priceEnv || !PRICE_ID.test(env?.[priceEnv] || '')) reasons.push('price_missing');
  const testDraft = env?.BILLING_MODE === 'test' && env?.PROGRAMME_ALLOW_DRAFT === 'true' && !productionOrigin(env);
  const content = contentProblems(manifest, today);
  if (!testDraft) reasons.push(...content);
  if (reasons.length) return { open: false, mode: null, reasons };
  return { open: true, mode: testDraft ? (content.length ? 'test-draft' : 'test') : 'live', reasons: [] };
}

/** Inclusions that may be shown publicly: promised ones only. */
export const publicInclusions = (manifest) => (manifest?.inclusions || []).filter((item) => item.promised);
