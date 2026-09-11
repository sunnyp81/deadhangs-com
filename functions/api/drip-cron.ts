interface Env { BREVO_API_KEY: string; DRIP_ENABLED?: string; }
interface Contact { email: string; emailBlacklisted?: boolean; attributes?: Record<string, string | number>; }
const TEMPLATE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DRIP_DAYS = [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function brevo(path: string, env: Env, opts: RequestInit = {}) {
  return fetch('https://api.brevo.com/v3' + path, { ...opts, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY } });
}
// Enable only after the live list, consent/unsubscribe behaviour and all templates are reviewed.
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.BREVO_API_KEY || request.headers.get('x-cron-secret') !== env.BREVO_API_KEY) return json({ error: 'Unauthorized' }, 401);
  if (env.DRIP_ENABLED !== 'true') return json({ ok: true, enabled: false, sent: 0 });
  const now = Date.now();
  let sent = 0;
  let offset = 0;
  const limit = 50;
  try {
    while (true) {
      const res = await brevo('/contacts/lists/3/contacts?limit=' + limit + '&offset=' + offset, env);
      if (!res.ok) return json({ error: 'Contact lookup failed', sent }, 502);
      const data = await res.json() as { contacts?: Contact[] };
      if (!Array.isArray(data.contacts)) return json({ error: 'Invalid contact response', sent }, 502);
      if (!data.contacts.length) break;
      for (const contact of data.contacts) {
        if (contact.emailBlacklisted || !contact.email || !contact.attributes?.SIGNUP_DATE) continue;
        const signup = new Date(String(contact.attributes.SIGNUP_DATE)).getTime();
        const days = Math.floor((now - signup) / 86400000);
        const last = Number(contact.attributes.DRIP_LAST_SENT ?? -1);
        if (!Number.isFinite(signup) || !Number.isInteger(last) || last < -1 || last >= TEMPLATE_IDS.length || days < 0) continue;
        const i = DRIP_DAYS.findIndex((day, index) => days >= day && last < index);
        if (i < 0) continue;
        const delivery = await brevo('/smtp/email', env, { method: 'POST', body: JSON.stringify({ templateId: TEMPLATE_IDS[i], to: [{ email: contact.email }] }) });
        if (!delivery.ok) return json({ error: 'Email provider rejected send', sent }, 502);
        const update = await brevo('/contacts/' + encodeURIComponent(contact.email), env, { method: 'PUT', body: JSON.stringify({ attributes: { DRIP_LAST_SENT: String(i) } }) });
        if (!update.ok) return json({ error: 'Send accepted but progress update failed; investigate before retrying', sent, reviewRequired: true }, 502);
        sent++;
      }
      offset += limit;
      if (data.contacts.length < limit) break;
    }
    return json({ ok: true, enabled: true, sent });
  } catch { return json({ error: 'Email service unavailable', sent }, 502); }
};
