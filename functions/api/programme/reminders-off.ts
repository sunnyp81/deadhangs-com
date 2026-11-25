import { readReminderOff, turnRemindersOff } from '../../../src/server/programme-reminders.mjs';
import type { D1Database } from '../../../src/server/env';

interface Env { DB?: D1Database; UNSUB_SECRET?: string }
type State = 'confirm' | 'done' | 'invalid' | 'unavailable';
const COPY: Record<State, [string, string]> = {
  confirm: ['Turn off programme reminders?', 'Press the button to stop DeadHangs programme reminder emails. Your programme and records stay as they are.'],
  done: ['Reminders are off', 'You will not get any more programme reminder emails. You can turn them back on in your programme.'],
  invalid: ['This link did not work', 'The link is incomplete or has been changed. Nothing was changed.'],
  unavailable: ['This is not available right now', 'Nothing was changed. Try again later, or email hello@sunnypatel.co.uk with the subject "reminders off".'],
};
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const headers = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
function page(state: State, action = '') {
  const [title, text] = COPY[state];
  const form = state === 'confirm' ? `<form method="post" action="${esc(action)}"><button type="submit">Turn reminders off</button></form>` : '';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | DeadHangs</title>
<style>body{margin:0;background:#f4f1ea;color:#1c1b19;font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:34rem;margin:12vh auto;padding:0 16px}h1{font-size:1.6rem;line-height:1.2}a{color:#1c1b19}button{min-height:44px;padding:10px 22px;font:inherit;font-weight:700;background:#1c1b19;color:#f4f1ea;border:0;border-radius:6px;cursor:pointer}</style></head>
<body><main><p><a href="/">DeadHangs</a></p><h1>${title}</h1><p>${text}</p>${form}</main></body></html>`;
}
async function handle({ request, env }: { request: Request; env: Env }, isPost: boolean) {
  const url = new URL(request.url);
  const fromForm = isPost && (request.headers.get('accept') || '').includes('text/html');
  const reply = (state: State, status: number) => (isPost && !fromForm
    ? new Response(state, { status, headers: headers('text/plain; charset=utf-8') })
    : new Response(page(state), { status, headers: headers('text/html; charset=utf-8') }));
  if (!env.DB || !env.UNSUB_SECRET) return reply('unavailable', 503);
  const userId = await readReminderOff(env, url.searchParams.get('u') || '', url.searchParams.get('s') || '');
  if (!userId) return reply('invalid', 403);
  // GET never changes anything, so link scanners cannot turn reminders off.
  if (!isPost) return new Response(page('confirm', url.pathname + url.search), { status: 200, headers: headers('text/html; charset=utf-8') });
  try { await turnRemindersOff(env.DB, userId); } catch { return reply('unavailable', 503); }
  return reply('done', 200);
}
export const onRequestGet = (context: { request: Request; env: Env }) => handle(context, false);
export const onRequestPost = (context: { request: Request; env: Env }) => handle(context, true);
