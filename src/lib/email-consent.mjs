// Shared by the signup form (browser) and the subscribe handler (server). No secrets here.
export const CONSENT_WORDING_VERSION = 'signup-2026-11-11';
export const CONSENT_WORDING = 'By subscribing, you ask to receive DeadHangs training emails. Unsubscribe in any received message.';
export const OFFER_WORDING = 'Optional training emails: a starter plan, a weekly test reminder and when to progress.';
// Pages that may carry a signup form. Anything else is recorded as "other", never as a free-text path.
export const CONSENT_SOURCES = Object.freeze([
  '/',
  '/dead-hang-world-record/',
  '/deadhang-benefits/',
  '/dead-hang-time-by-age/',
  '/training-log/',
]);

export function consentSource(value) {
  if (typeof value !== 'string') return 'other';
  const path = value.split(/[?#]/)[0];
  return CONSENT_SOURCES.includes(path) ? path : 'other';
}

/** Build-time and runtime flag reader: only the exact string "true" turns email on. Absent means off. */
export function emailFlagOn(value) {
  return value === 'true';
}
