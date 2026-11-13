import rules from '../data/plan-rules.json' with { type: 'json' };
import { buildPlan } from '../lib/plan8.mjs';
import { renderPlanHtml, renderGoneHtml, renderUnavailableHtml } from '../lib/plan8-render.mjs';
import { lookupPlan } from './plan-access.mjs';

const MARKER = '<!--PLAN8-->';
const SHELL_PATH = '/plan/view-shell/';

function headers(extra) {
  const h = new Headers(extra);
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Content-Type-Options', 'nosniff');
  return h;
}

async function page(request, env, body, status) {
  let shell = '';
  try {
    const res = await env.ASSETS.fetch(new URL(SHELL_PATH, request.url));
    if (res.ok) shell = await res.text();
  } catch { /* fall through to the bare page */ }
  const html = shell.includes(MARKER)
    ? shell.replace(MARKER, () => body)
    : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Your 8-week hang plan | DeadHangs</title></head><body><main>${body}</main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { status, headers: headers() });
}

/** GET /plan/view/?t=<token>. 200 with the plan, 410 for unknown or refunded, 503 if the database is down. */
export async function handlePlanView(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: headers({ Allow: 'GET, HEAD' }) });
  }
  const token = new URL(request.url).searchParams.get('t');
  const found = await lookupPlan(env.DB, token);
  if (found.status === 'unavailable') return page(request, env, renderUnavailableHtml(), 503);
  if (found.status === 'gone') return page(request, env, renderGoneHtml(), 410);
  if (found.status === 'invalid') return page(request, env, renderUnavailableHtml(), 500);
  const plan = buildPlan(found.inputs, rules);
  if (!plan.ok) return page(request, env, renderUnavailableHtml(), 500);
  return page(request, env, renderPlanHtml(plan, rules), 200);
}
