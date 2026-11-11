import { blacklist, verifyUnsubToken } from '../../src/server/email.mjs';

interface Env { BREVO_API_KEY?: string; UNSUB_SECRET?: string; }
type State = 'done' | 'invalid' | 'unavailable';
const CONTACT = 'hello@sunnypatel.co.uk';
const headers = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
const COPY: Record<State, [string, string]> = {
  done: ['You are unsubscribed', 'This address will not get any more DeadHangs training emails. The timer and your log still work as before.'],
  invalid: ['This link did not work', 'The unsubscribe link is incomplete or has been changed.'],
  unavailable: ['Unsubscribe is not available right now', 'Nothing was changed.'],
};
export function page(state: State) {
  const [title, text] = COPY[state];
  const fallback = state === 'done' ? '' : `<p>Email <a href="mailto:${CONTACT}?subject=unsubscribe">${CONTACT}</a> with the subject "unsubscribe" and I will remove you by hand.</p>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | DeadHangs</title>
<style>body{margin:0;background:#f4f1ea;color:#1c1b19;font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:34rem;margin:12vh auto;padding:0 16px}h1{font-size:1.6rem;line-height:1.2;margin:.4rem 0 1rem}a{color:#1c1b19}.brand{font-weight:700;letter-spacing:.02em}</style></head>
<body><main><p class="brand"><a href="/">DeadHangs</a></p><h1>${title}</h1><p>${text}</p>${fallback}<p><a href="/">Back to deadhangs.com</a></p></main></body></html>`;
}
async function handle({ request, env }: { request: Request; env: Env }, isPost: boolean) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  const token = url.searchParams.get('t') || '';
  const reply = (state: State, status: number) => isPost
    ? new Response(state, { status, headers: headers('text/plain; charset=utf-8') })
    : new Response(page(state), { status, headers: headers('text/html; charset=utf-8') });
  if (!email || !token || email.length > 254) return reply('invalid', 400);
  if (!env.UNSUB_SECRET || !env.BREVO_API_KEY) return reply('unavailable', 503);
  if (!(await verifyUnsubToken(email, token, env.UNSUB_SECRET))) return reply('invalid', 403);
  try { await blacklist(env.BREVO_API_KEY, email); } catch { return reply('unavailable', 502); }
  return reply('done', 200);
}
// GET: the footer link. POST: RFC 8058 one-click from the mail client (body List-Unsubscribe=One-Click).
export const onRequestGet = (context: { request: Request; env: Env }) => handle(context, false);
export const onRequestPost = (context: { request: Request; env: Env }) => handle(context, true);
