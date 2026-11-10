import { configuredEnv, type AccountEnv, type PagesContext } from '../../../src/server/env';
import { ALLOWED_CALLBACK_PATHS, AUTH_BASE_PATH, DEFAULT_CALLBACK_PATH, getAuth } from '../../../src/server/auth';
import { checkWriteRequest, isPlainObject, json, readJson, serverError, unavailable } from '../../../src/server/http';

const SIGN_IN_KEYS = new Set(['provider', 'callbackURL', 'errorCallbackURL', 'newUserCallbackURL']);
const CALLBACK_KEYS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;
const ROUTES: Record<string, string> = {
  'POST /sign-in/social': 'sign-in',
  'GET /callback/google': 'pass',
  'POST /sign-out': 'write',
};

const notFound = () => json({ error: 'not_found' }, 404);

/** Rebuilds the sign-in request from validated values so no extra Better Auth options reach it. */
async function signInRequest(request: Request, origin: string): Promise<Request | Response> {
  const body = await readJson(request, 2048);
  if (!body.ok) return body.response;
  const input = body.value;
  if (!isPlainObject(input) || Object.keys(input).some((key) => !SIGN_IN_KEYS.has(key)) || input.provider !== 'google') return json({ error: 'invalid_request' }, 400);
  const clean: Record<string, string> = { provider: 'google' };
  for (const key of CALLBACK_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !(ALLOWED_CALLBACK_PATHS as readonly string[]).includes(value)) return json({ error: 'invalid_callback' }, 400);
    clean[key] = value;
  }
  clean.callbackURL ??= DEFAULT_CALLBACK_PATH;
  const headers = new Headers({ 'content-type': 'application/json', origin });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  for (const name of ['cf-connecting-ip', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(request.url, { method: 'POST', headers, body: JSON.stringify(clean) });
}

export const onRequest = async ({ request, env: rawEnv }: PagesContext<AccountEnv>): Promise<Response> => {
  const env = configuredEnv(rawEnv, request);
  if (!env) return unavailable();
  const url = new URL(request.url);
  if (!url.pathname.startsWith(AUTH_BASE_PATH + '/')) return notFound();
  const route = ROUTES[`${request.method} ${url.pathname.slice(AUTH_BASE_PATH.length)}`];
  if (!route) return notFound();
  let forwarded = request;
  if (route !== 'pass') {
    const blocked = checkWriteRequest(request, env.AUTH_BASE_URL);
    if (blocked) return blocked;
  }
  if (route === 'sign-in') {
    const rebuilt = await signInRequest(request, env.AUTH_BASE_URL);
    if (rebuilt instanceof Response) return rebuilt;
    forwarded = rebuilt;
  }
  try {
    const response = await getAuth(env, rawEnv as object).handler(forwarded);
    const out = new Response(response.body, response);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('Referrer-Policy', 'no-referrer');
    out.headers.set('X-Content-Type-Options', 'nosniff');
    return out;
  } catch (error) {
    console.error('auth route failed', error instanceof Error ? error.name : 'unknown');
    return serverError();
  }
};
