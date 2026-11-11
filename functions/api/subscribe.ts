import { consentSource, CONSENT_WORDING_VERSION, emailFlagOn } from '../../src/lib/email-consent.mjs';
import { listId, sendCompliantEmail, sendReadiness, siteOrigin, welcomeEmail } from '../../src/server/email.mjs';

interface Env {
  BREVO_API_KEY?: string;
  EMAIL_CAPTURE_ENABLED?: string;
  EMAIL_LIST_ID?: string;
  UNSUB_SECRET?: string;
  EMAIL_POSTAL_ADDRESS?: string;
  EMAIL_SENDER?: string;
  EMAIL_SENDER_NAME?: string;
  AUTH_BASE_URL?: string;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control':'no-store' } });
export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error:'Invalid origin' },403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error:'Use JSON' },415);
  if (Number(request.headers.get('content-length')) > 4096) return json({ error:'Request too large' },413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error:'Invalid JSON' },400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ error:'Request too large' },413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder().decode(bytes);
    if (raw.length > 4096) return json({ error:'Request too large' },413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error:'Invalid JSON' },400); }
    const body = (input && typeof input === 'object' ? input : {}) as { email?: unknown; source?: unknown; website?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error:'Invalid email' },400);
    // Honeypot: people never fill the hidden field. Answer as success so bots learn nothing.
    if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok:true });
    if (!env.BREVO_API_KEY) return json({ error:'Signup is temporarily unavailable' },503);
    const list = listId(env);
    if (list === null) return json({ error:'Signup is temporarily unavailable' },503);
    const flagOn = emailFlagOn(env.EMAIL_CAPTURE_ENABLED);
    const attributes: Record<string, string> = { SIGNUP_DATE: new Date().toISOString().split('T')[0], DRIP_LAST_SENT: '-1' };
    // Consent record. Sent only with the flag on, because Brevo needs these attributes created first (NEEDS SUNNY).
    if (flagOn) Object.assign(attributes, { CONSENT_SOURCE: consentSource(body.source), CONSENT_AT: new Date().toISOString(), CONSENT_WORDING: CONSENT_WORDING_VERSION });
    const response = await fetch('https://api.brevo.com/v3/contacts', { method:'POST', headers:{'Content-Type':'application/json','api-key':env.BREVO_API_KEY}, body:JSON.stringify({email,listIds:[list],attributes,updateEnabled:false}), signal:AbortSignal.timeout(10000) });
    if (response.ok) {
      // Welcome email only when every gate passes; sendCompliantEmail re-checks readiness and suppression.
      if (flagOn && sendReadiness(env).length === 0) {
        const message = welcomeEmail(siteOrigin(env));
        await sendCompliantEmail(env, { email, ...message });
      }
      return json({ok:true});
    }
    const result = await response.json() as {code?:string};
    if (response.status === 400 && result.code === 'duplicate_parameter') return json({ok:true,existing:true});
    return json({error:'Subscription failed'},502);
  } catch { return json({error:'Subscription temporarily unavailable'},502); }
};
