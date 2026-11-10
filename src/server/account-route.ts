import { configuredEnv, type AccountEnv, type ConfiguredEnv, type PagesContext } from './env';
import { getAuth, getSessionInfo, type SessionInfo } from './auth';
import { checkWriteRequest, json, methodNotAllowed, serverError, signedOut, unavailable } from './http';
import { BillingError } from './billing.mjs';

export type AccountContext = { request: Request; env: ConfiguredEnv; auth: ReturnType<typeof getAuth>; session: SessionInfo };
type Handler = (ctx: AccountContext) => Promise<Response>;

/** Wraps an /api/account route: config gate, same-origin writes, session lookup, Set-Cookie forwarding. */
export function accountRoute(handlers: Partial<Record<'GET' | 'PUT' | 'POST' | 'DELETE', Handler>>) {
  const allow = Object.keys(handlers).join(', ');
  return async ({ request, env: rawEnv }: PagesContext<AccountEnv>): Promise<Response> => {
    const handler = handlers[request.method as keyof typeof handlers];
    if (!handler) return methodNotAllowed(allow);
    const env = configuredEnv(rawEnv, request);
    if (!env) return unavailable();
    if (request.method !== 'GET') {
      const blocked = checkWriteRequest(request, env.AUTH_BASE_URL);
      if (blocked) return blocked;
    }
    let sessionHeaders = new Headers();
    try {
      const auth = getAuth(env, rawEnv as object);
      const { session, headers } = await getSessionInfo(auth, request);
      sessionHeaders = headers;
      if (!session) return signedOut(headers);
      const accountKey = request.headers.get('X-DeadHangs-Account-Key');
      if ((request.method !== 'GET' || accountKey !== null) && accountKey !== session.userId) return json({ error: 'account_changed' }, 403, headers);
      const response = await handler({ request, env, auth, session });
      const out = new Response(response.body, response);
      if (!out.headers.has('set-cookie')) for (const cookie of headers.getSetCookie()) out.headers.append('set-cookie', cookie);
      return out;
    } catch (error) {
      if (error instanceof BillingError) return json({ error: error.code }, error.status, sessionHeaders);
      console.error('account route failed', error instanceof Error ? error.name : 'unknown');
      return serverError();
    }
  };
}
