import { PLAN_REASONS } from '../../../../src/lib/plan-offer.mjs';

interface Env { DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin) return json({ error: 'invalid_origin' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
  if (Number(request.headers.get('content-length')) > 1024) return json({ error: 'too_large' }, 413);
  let body: { session_id?: unknown; reason?: unknown };
  try { body = JSON.parse((await request.text()).slice(0, 1024)); } catch { return json({ error: 'invalid_json' }, 400); }
  const sessionId = typeof body.session_id === 'string' && /^cs_[A-Za-z0-9_]{8,200}$/.test(body.session_id) ? body.session_id : null;
  const reason = typeof body.reason === 'string' && PLAN_REASONS.some(([key]) => key === body.reason) ? body.reason : null;
  if (!sessionId || !reason) return json({ error: 'invalid_request' }, 400);
  if (!env.DB) return json({ error: 'unavailable' }, 503);
  try {
    await env.DB.prepare("UPDATE plan_purchases SET reason = ? WHERE checkout_session_id = ? AND status = 'paid' AND reason IS NULL").bind(reason, sessionId).run();
  } catch { return json({ error: 'unavailable' }, 503); }
  return json({ ok: true });
};
export const onRequest = () => json({ error: 'method_not_allowed' }, 405);
