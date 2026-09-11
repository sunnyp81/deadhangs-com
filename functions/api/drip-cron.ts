interface Env {
  BREVO_API_KEY?: string;
  DRIP_CRON_SECRET?: string;
  DRIP_ENABLED?: string;
  DRIP_TEMPLATE_IDS?: string;
}
interface Contact { email: string; emailBlacklisted?: boolean; attributes?: Record<string, string | number>; }
interface Context { request: Request; env: Env; }
const DRIP_DAYS = [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function brevo(path: string, env: Env, opts: RequestInit = {}) {
  return fetch('https://api.brevo.com/v3' + path, { ...opts, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY! } });
}
function templateIds(raw?: string) {
  if (!raw) return null;
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length !== 12 || parts.some(s => !/^[1-9]\d*$/.test(s))) return null;
  const ids = parts.map(Number);
  return ids.every(Number.isSafeInteger) && new Set(ids).size === 12 ? ids : null;
}
export function nextEmail(contact: Contact, now = Date.now()) {
  if (contact.emailBlacklisted || !contact.email || !contact.attributes?.SIGNUP_DATE) return -1;
  const value = String(contact.attributes.SIGNUP_DATE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return -1;
  const signup = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(signup) || new Date(signup).toISOString().slice(0, 10) !== value) return -1;
  const days = Math.floor((now - signup) / 86400000);
  const rawLast = contact.attributes.DRIP_LAST_SENT;
  if (rawLast === undefined || rawLast === null || String(rawLast).trim() === '') return -1;
  const last = Number(rawLast);
  if (!Number.isInteger(last) || last < -1 || last >= 12 || days < 0) return -1;
  return DRIP_DAYS.findIndex((day, index) => days >= day && last < index);
}

async function run({ request, env }: Context, dryRun: boolean) {
  // Legacy credential is accepted for read-only checks during migration only.
  const secret = env.DRIP_CRON_SECRET || (dryRun ? env.BREVO_API_KEY : undefined);
  if (!secret || request.headers.get('x-cron-secret') !== secret) return json({ error: 'Unauthorized' }, 401);
  if (!dryRun && env.DRIP_ENABLED !== 'true') return json({ ok: true, enabled: false, dryRun: false, sent: 0 });
  const ids = templateIds(env.DRIP_TEMPLATE_IDS);
  const blockers: string[] = [];
  if (!env.BREVO_API_KEY) blockers.push('BREVO_API_KEY is missing');
  if (!ids) blockers.push('DRIP_TEMPLATE_IDS must contain twelve distinct positive template IDs in sequence order');
  if (!env.DRIP_CRON_SECRET) blockers.push('A dedicated DRIP_CRON_SECRET is required before enabling sends');
  if (blockers.length) return json({ ok: false, dryRun, ready: false, sent: 0, blockers }, 503);
  let scanned = 0, due = 0, sent = 0, accepted = 0, skipped = 0;
  const dueByStep = Array.from({ length: 12 }, () => 0);
  const now = Date.now();
  try {
    // Validate all templates before any contact can be sent an email.
    for (const id of ids!) {
      const response = await brevo('/smtp/templates/' + id, env);
      if (!response.ok) { blockers.push('Template ' + id + ' is unavailable'); continue; }
      const template = await response.json() as { isActive?: boolean; subject?: string; sender?: { email?: string }; htmlContent?: string };
      if (!template.isActive || !template.subject?.trim() || !template.sender?.email) blockers.push('Template ' + id + ' needs an active status, subject and sender');
      if (!/{{\s*unsubscribe\s*}}/.test(template.htmlContent || '')) blockers.push('Template ' + id + ' is missing the Brevo unsubscribe token');
    }
    if (blockers.length) return json({ ok: false, dryRun, ready: false, sent: 0, blockers }, 503);
    const limit = 50;
    let offset = Number(new URL(request.url).searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: 'Invalid offset' }, 400);
    // Keep requests bounded. Counts describe this batch, never an invented list total.
    while (scanned < 200) {
      const res = await brevo('/contacts/lists/3/contacts?limit=' + limit + '&offset=' + offset, env);
      if (!res.ok) return json({ error: 'Contact lookup failed', dryRun, sent, accepted }, 502);
      const data = await res.json() as { contacts?: Contact[] };
      if (!Array.isArray(data.contacts) || data.contacts.length > limit) return json({ error: 'Invalid contact response', dryRun, sent, accepted }, 502);
      if (!data.contacts.length) break;
      for (let n = 0; n < data.contacts.length; n++) {
        const contact = data.contacts[n]; scanned++;
        const i = nextEmail(contact, now);
        if (i < 0) { skipped++; continue; }
        due++; dueByStep[i]++;
        if (dryRun) continue;
        const delivery = await brevo('/smtp/email', env, { method: 'POST', body: JSON.stringify({ templateId: ids![i], to: [{ email: contact.email }] }) });
        if (!delivery.ok) return json({ error: 'Email provider rejected send', dryRun, sent, accepted }, 502);
        accepted++;
        const update = await brevo('/contacts/' + encodeURIComponent(contact.email), env, { method: 'PUT', body: JSON.stringify({ attributes: { DRIP_LAST_SENT: String(i) } }) });
        if (!update.ok) return json({ error: 'Send accepted but progress update failed; investigate before retrying', dryRun, sent, accepted, reviewRequired: true }, 502);
        sent++;
        if (sent >= 15) return json({ ok: true, enabled: true, dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: true, nextOffset: offset + n + 1 });
      }
      offset += data.contacts.length;
      if (data.contacts.length < limit) return json({ ok: true, enabled: env.DRIP_ENABLED === 'true', dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: false, nextOffset: null });
    }
    return json({ ok: true, enabled: env.DRIP_ENABLED === 'true', dryRun, ready: true, sent, accepted, scanned, due, skipped, dueByStep, truncated: scanned >= 200, nextOffset: scanned >= 200 ? offset : null });
  } catch { return json({ error: 'Email service unavailable', dryRun, sent, accepted, reviewRequired: accepted > sent }, 502); }
}

// GET is always read-only. Sending requires POST, a dedicated secret and explicit enablement.
export const onRequestGet = (context: Context) => run(context, true);
export const onRequestPost = (context: Context) => run(context, false);
