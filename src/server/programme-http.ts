import { accountRoute, type AccountContext } from './account-route';
import { baseOrigin } from './env';
import { isPlainObject, json, methodNotAllowed, readJson } from './http';
import { BillingError, billingConfigured, createBillingService } from './billing.mjs';
import { ProgrammeError, applyOperation } from '../lib/programme-engine.mjs';
import { ProgrammeStoreError, readProgress, saveInterest, writeProgress } from './programme-store.mjs';
import { buildProgrammeView } from './programme-view.mjs';
import { PROGRAMMES } from '../data/programmes/hang4.public.mjs';
import type { BillingEnv } from './billing-http';

export interface ProgrammeEnv extends BillingEnv {
  PROGRAMME_LAUNCH_ENABLED?: string;
  PROGRAMME_ALLOW_DRAFT?: string;
  STRIPE_PROGRAMME_PRICE_ID?: string;
}
type Content = { rules: unknown; copy: Record<string, any> };
type Manifest = (typeof PROGRAMMES)[keyof typeof PROGRAMMES];

const manifestFor = (id: unknown): Manifest | null => (typeof id === 'string' && Object.hasOwn(PROGRAMMES, id) ? (PROGRAMMES as Record<string, Manifest>)[id] : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function handled(error: unknown, headers?: HeadersInit): Response {
  if (error instanceof ProgrammeError || error instanceof ProgrammeStoreError || error instanceof BillingError) return json({ error: (error as { code: string }).code }, (error as { status: number }).status, headers);
  throw error;
}

/** Public: whether new purchases are open. Reasons stay server-side; the page only needs open or closed. */
export async function programmeAvailability({ request, env }: { request: Request; env: ProgrammeEnv }): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const manifest = manifestFor(new URL(request.url).searchParams.get('programme') || 'hang4');
  if (!manifest) return json({ error: 'invalid_programme' }, 400);
  const origin = baseOrigin(env.AUTH_BASE_URL);
  let sales: { open: boolean; mode: string | null } = { open: false, mode: null };
  try { if (origin && new URL(request.url).origin === origin) sales = createBillingService(env).programmeSales(manifest); } catch { /* closed */ }
  return json({ programme: manifest.id, open: sales.open, test: sales.mode !== 'live' && sales.open, price: manifest.price });
}

/** Signed-in routes: state (GET), progress operations, checkout and return-from-checkout settlement. */
export function programmeRoutes(content: Content) {
  const access = async (ctx: AccountContext, manifest: Manifest) => createBillingService(ctx.env as ProgrammeEnv).programmeAccess(ctx.session.userId, manifest.id);
  return {
    state: accountRoute({
      async GET(ctx) {
        const url = new URL(ctx.request.url);
        const manifest = manifestFor(url.searchParams.get('programme') || 'hang4');
        if (!manifest) return json({ error: 'invalid_programme' }, 400);
        const today = url.searchParams.get('today');
        try {
          const billing = createBillingService(ctx.env as ProgrammeEnv);
          const entitlement = await billing.programmeAccess(ctx.session.userId, manifest.id);
          const sales = billing.programmeSales(manifest);
          const base = { programme: manifest.id, name: manifest.name, access: entitlement, sales: { open: sales.open, test: sales.open && sales.mode !== 'live' } };
          const stored = await readProgress(ctx.env.DB, ctx.session.userId, manifest.id);
          // Content only for current buyers. Former buyers keep their own records (read-only) and the export.
          if (!entitlement.active) return json({ ...base, progress: stored.state ? { readOnly: true, revision: stored.revision, results: stored.state.results, baseline: stored.state.baseline, route: stored.state.route, status: stored.state.status } : null });
          return json({ ...base, progress: buildProgrammeView({ state: stored.state, revision: stored.revision, copy: content.copy, rules: content.rules, today: today && DATE.test(today) ? today : null }) });
        } catch (error) { return handled(error); }
      },
    }),
    progress: accountRoute({
      async POST(ctx) {
        const body = await readJson(ctx.request, 8192);
        if (!body.ok) return body.response;
        const value = body.value;
        if (!isPlainObject(value) || Object.keys(value).some((k) => !['programme', 'baseRevision', 'op', 'today'].includes(k))) return json({ error: 'invalid_request' }, 400);
        const manifest = manifestFor(value.programme);
        if (!manifest) return json({ error: 'invalid_programme' }, 400);
        if (!Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0) return json({ error: 'invalid_revision' }, 400);
        try {
          const entitlement = await access(ctx, manifest);
          if (!entitlement.active) return json({ error: 'programme_access_required', status: entitlement.status }, 402);
          const stored = await readProgress(ctx.env.DB, ctx.session.userId, manifest.id);
          if (stored.revision !== value.baseRevision) return json({ error: 'revision_conflict', revision: stored.revision }, 409);
          const result = applyOperation(stored.state, value.op, content.rules, new Date().toISOString());
          let revision = stored.revision;
          if (result.changed) {
            const written = await writeProgress(ctx.env.DB, ctx.session.userId, manifest.id, stored.revision, result.state);
            if (!written.ok) return json({ error: 'revision_conflict', revision: written.revision }, 409);
            revision = written.revision;
          }
          const today = typeof value.today === 'string' && DATE.test(value.today) ? value.today : null;
          return json({ changed: result.changed, progress: buildProgrammeView({ state: result.state, revision, copy: content.copy, rules: content.rules, today }) });
        } catch (error) { return handled(error); }
      },
    }),
    checkout: accountRoute({
      async POST(ctx) {
        const body = await readJson(ctx.request, 1024);
        if (!body.ok) return body.response;
        const value = body.value;
        if (!isPlainObject(value) || Object.keys(value).some((k) => !['programme', 'source'].includes(k))) return json({ error: 'invalid_request' }, 400);
        const manifest = manifestFor(value.programme);
        if (!manifest) return json({ error: 'invalid_programme' }, 400);
        try {
          return json(await createBillingService(ctx.env as ProgrammeEnv).checkoutProgramme({ id: ctx.session.userId }, manifest.id, typeof value.source === 'string' ? value.source : 'other'));
        } catch (error) { return handled(error); }
      },
    }),
    settle: accountRoute({
      async POST(ctx) {
        const body = await readJson(ctx.request, 1024);
        if (!body.ok) return body.response;
        const value = body.value;
        if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.sessionId !== 'string') return json({ error: 'invalid_request' }, 400);
        try {
          if (!billingConfigured(ctx.env as ProgrammeEnv)) return json({ error: 'billing_unavailable' }, 503);
          return json(await createBillingService(ctx.env as ProgrammeEnv).settleProgrammeForUser(ctx.session.userId, value.sessionId));
        } catch (error) { return handled(error); }
      },
    }),
  };
}

/** Public: "email me once when it opens". Same-origin JSON, honeypot, D1 write before reporting success. Never touches the newsletter. */
export async function programmeInterest({ request, env }: { request: Request; env: ProgrammeEnv }): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const origin = baseOrigin(env.AUTH_BASE_URL);
  if (!origin || new URL(request.url).origin !== origin || request.headers.get('origin') !== origin) return json({ error: 'invalid_origin' }, 403);
  const body = await readJson(request, 2048);
  if (!body.ok) return body.response;
  const value = body.value;
  if (!isPlainObject(value) || Object.keys(value).some((k) => !['email', 'programme', 'consent', 'website', 'source'].includes(k))) return json({ error: 'invalid_request' }, 400);
  if (typeof value.website === 'string' && value.website.trim() !== '') return json({ saved: true });
  if (value.consent !== true) return json({ error: 'consent_required' }, 400);
  const manifest = manifestFor(value.programme);
  if (!manifest) return json({ error: 'invalid_programme' }, 400);
  if (!env.DB) return json({ error: 'programme_unavailable' }, 503);
  const source = typeof value.source === 'string' && /^[a-z_]{1,32}$/.test(value.source) ? value.source : 'programme_page';
  try {
    return json(await saveInterest(env.DB, { email: value.email, programmeId: manifest.id, source }));
  } catch (error) {
    try { return handled(error); } catch { return json({ error: 'programme_unavailable' }, 503); }
  }
}
