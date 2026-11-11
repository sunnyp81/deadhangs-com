import { blacklist, verifyUnsubToken } from '../../src/server/email.mjs';

interface Env { BREVO_API_KEY?: string; UNSUB_SECRET?: string; }
type State = 'confirm' | 'done' | 'invalid' | 'unavailable';
const CONTACT = 'hello@sunnypatel.co.uk';
const headers = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
const COPY: Record<State, [string, string]> = {
  confirm: ['Unsubscribe from DeadHangs emails?', 'Press the button to stop all DeadHangs training emails to this address.'],
  done: ['You are unsubscribed', 'This address will not get any more DeadHangs training emails. The timer and your log still work as before.'],
  invalid: ['This link did not work', 'The unsubscribe link is incomplete or has been changed.'],
  unavailable: ['Unsubscribe is not available right now', 'Nothing was changed.'],
};
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function page(state: State, action = '') {
  const [title, text] = COPY[state];
  const form = state === 'confirm' ? `<form method="post" action="${esc(action)}"><button type="submit">Unsubscribe</button></form>` : '';
  const fallback = state === 'done' || state === 'confirm' ? '' : `<p>Email <a href="mailto:${CONTACT}?subject=unsubscribe">${CONTACT}</a> with the subject "unsubscribe" and I will remove you by hand.</p>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | DeadHangs</title>
<style>body{margin:0;background:#f4f1ea;color:#1c1b19;font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:34rem;margin:12vh auto;padding:0 16px}h1{font-size:1.6rem;line-height:1.2;margin:.4rem 0 1rem}a{color:#1c1b19}.brand{font-weight:700;letter-spacing:.02em}button{min-height:44px;min-width:44px;padding:10px 22px;font:inherit;font-weight:700;background:#1c1b19;color:#f4f1ea;border:0;border-radius:6px;cursor:pointer}</style></head>
<body><main><p class="brand"><a href="/">DeadHangs</a></p><h1>${title}</h1><p>${text}</p>${form}${fallback}<p><a href="/">Back to deadhangs.com</a></p></main></body></html>`;
}
async function handle({ request, env }: { request: Request; env: Env }, isPost: boolean) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  const token = url.searchParams.get('t') || '';
  // A person pressing the confirm button gets a page back; a mail client's one-click POST gets plain text.
  const fromForm = isPost && (request.headers.get('accept') || '').includes('text/html');
  const reply = (state: State, status: number) => isPost
    ? (fromForm ? new Response(page(state), { status, headers: headers('text/html; charset=utf-8') }) : new Response(state, { status, headers: headers('text/plain; charset=utf-8') }))
    : new Response(page(state), { status, headers: headers('text/html; charset=utf-8') });
  if (!email || !token || email.length > 254) return reply('invalid', 400);
  if (!env.UNSUB_SECRET || !env.BREVO_API_KEY) return reply('unavailable', 503);
  if (!(await verifyUnsubToken(email, token, env.UNSUB_SECRET))) return reply('invalid', 403);
  // GET never changes anything: link scanners and prefetchers fetch this URL. It shows a confirm form that POSTs back.
  if (!isPost) return new Response(page('confirm', url.pathname + url.search), { status: 200, headers: headers('text/html; charset=utf-8') });
  try { await blacklist(env.BREVO_API_KEY, email); } catch { return reply('unavailable', 502); }
  return reply('done', 200);
}
// GET: footer link, confirm page only, no Brevo call. POST: RFC 8058 one-click (body List-Unsubscribe=One-Click) or the confirm form; both blacklist.
export const onRequestGet = (context: { request: Request; env: Env }) => handle(context, false);
export const onRequestPost = (context: { request: Request; env: Env }) => handle(context, true);
