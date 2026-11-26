import { accountRoute } from './account-route';
import { baseOrigin } from './env';
import { isPlainObject, json, methodNotAllowed, readJson } from './http';
import { GymError, addResult, campaignView, exportCampaign, joinCampaign, leaveCampaign, organiserAction, saveEnquiry } from './gym-store.mjs';
import type { AccountEnv } from './env';

// Gym pilot is a separate milestone: every route answers 404 unless GYM_PILOT_ENABLED is exactly "true".
export interface GymEnv extends AccountEnv { GYM_PILOT_ENABLED?: string }
const enabled = (env: GymEnv | undefined) => env?.GYM_PILOT_ENABLED === 'true';
const off = () => json({ error: 'not_found' }, 404);

function handled(error: unknown, headers?: HeadersInit): Response {
  if (error instanceof GymError) return json({ error: error.code }, error.status, headers);
  throw error;
}
const keysOnly = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((k) => allowed.includes(k));

/** Public enquiry form: same-origin JSON, honeypot, D1 write before success. */
export async function gymEnquiry({ request, env }: { request: Request; env: GymEnv }): Promise<Response> {
  if (!enabled(env)) return off();
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const origin = baseOrigin(env.AUTH_BASE_URL);
  if (!origin || new URL(request.url).origin !== origin || request.headers.get('origin') !== origin) return json({ error: 'invalid_origin' }, 403);
  const body = await readJson(request, 4096);
  if (!body.ok) return body.response;
  const value = body.value;
  if (!isPlainObject(value) || !keysOnly(value, ['gymName', 'contactName', 'email', 'location', 'members', 'message', 'consent', 'website'])) return json({ error: 'invalid_request' }, 400);
  if (typeof value.website === 'string' && value.website.trim() !== '') return json({ saved: true });
  if (!env.DB) return json({ error: 'gym_unavailable' }, 503);
  try { return json(await saveEnquiry(env.DB, value)); }
  catch (error) { try { return handled(error); } catch { return json({ error: 'gym_unavailable' }, 503); } }
}

/** Signed-in campaign routes. Authority comes from the caller's membership row, never from the request body. */
export const gymRoutes = {
  join: accountRoute({
    async POST(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const body = await readJson(ctx.request, 2048);
      if (!body.ok) return body.response;
      const v = body.value;
      if (!isPlainObject(v) || !keysOnly(v, ['token', 'displayName', 'showOnBoard', 'shareConsent'])) return json({ error: 'invalid_request' }, 400);
      try { return json(await joinCampaign(ctx.env.DB, ctx.session.userId, v as never)); } catch (error) { return handled(error); }
    },
  }),
  campaign: accountRoute({
    async GET(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const id = new URL(ctx.request.url).searchParams.get('id') || '';
      try { return json({ accountKey: ctx.session.userId, ...(await campaignView(ctx.env.DB, ctx.session.userId, id)) }); } catch (error) { return handled(error); }
    },
  }),
  result: accountRoute({
    async POST(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const body = await readJson(ctx.request, 1024);
      if (!body.ok) return body.response;
      const v = body.value;
      if (!isPlainObject(v) || !keysOnly(v, ['campaignId', 'id', 'seconds', 'localDate', 'ruleConfirmed'])) return json({ error: 'invalid_request' }, 400);
      try { return json(await addResult(ctx.env.DB, ctx.session.userId, v as never)); } catch (error) { return handled(error); }
    },
  }),
  organiser: accountRoute({
    async POST(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const body = await readJson(ctx.request, 1024);
      if (!body.ok) return body.response;
      const v = body.value;
      if (!isPlainObject(v) || !keysOnly(v, ['campaignId', 'op', 'resultId', 'seconds', 'note', 'memberRef', 'boardVisibility'])) return json({ error: 'invalid_request' }, 400);
      try { return json(await organiserAction(ctx.env.DB, ctx.session.userId, v as never)); } catch (error) { return handled(error); }
    },
  }),
  leave: accountRoute({
    async POST(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const body = await readJson(ctx.request, 512);
      if (!body.ok) return body.response;
      const v = body.value;
      if (!isPlainObject(v) || !keysOnly(v, ['campaignId'])) return json({ error: 'invalid_request' }, 400);
      try { return json(await leaveCampaign(ctx.env.DB, ctx.session.userId, String(v.campaignId))); } catch (error) { return handled(error); }
    },
  }),
  export: accountRoute({
    async GET(ctx) {
      if (!enabled(ctx.env as GymEnv)) return off();
      const id = new URL(ctx.request.url).searchParams.get('id') || '';
      try {
        const { filename, csv } = await exportCampaign(ctx.env.DB, ctx.session.userId, id);
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch (error) { return handled(error); }
    },
  }),
};
