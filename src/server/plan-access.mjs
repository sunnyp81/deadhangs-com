// Looks up a plan purchase by access token. The raw token is never stored: only its SHA-256 hex digest.
// token_hash = lowercase hex SHA-256 of the raw token string, minted by billing.mjs.

export const PLAN_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export const isPlausibleToken = (t) => typeof t === 'string' && PLAN_TOKEN_REGEX.test(t);

export async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns { status: 'ok', inputs } for a paid purchase, { status: 'gone' } for an unknown token or a
 * refunded purchase, { status: 'unavailable' } when the database cannot be read, { status: 'invalid' }
 * when a paid row holds unreadable inputs.
 */
export async function lookupPlan(db, token) {
  if (!db || typeof db.prepare !== 'function') return { status: 'unavailable' };
  if (!isPlausibleToken(token)) return { status: 'gone' };
  let row;
  try {
    const hash = await hashToken(token);
    row = await db.prepare('SELECT status, inputs FROM plan_purchases WHERE token_hash = ?1').bind(hash).first();
  } catch {
    return { status: 'unavailable' };
  }
  if (!row || row.status !== 'paid') return { status: 'gone' };
  try {
    const inputs = typeof row.inputs === 'string' ? JSON.parse(row.inputs) : row.inputs;
    if (!inputs || typeof inputs !== 'object') return { status: 'invalid' };
    return { status: 'ok', inputs };
  } catch {
    return { status: 'invalid' };
  }
}
