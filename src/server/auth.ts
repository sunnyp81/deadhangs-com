import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { ConfiguredEnv } from './env';

export const AUTH_BASE_PATH = '/api/auth';
export const ALLOWED_CALLBACK_PATHS = ['/training-log/', '/account/'] as const;
export const DEFAULT_CALLBACK_PATH = '/training-log/';
export const ERROR_PATH = '/account/';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const TOKEN_FIELDS = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, password: null };

export function authOptions(env: ConfiguredEnv): BetterAuthOptions {
  return {
    appName: 'DeadHangs',
    baseURL: env.AUTH_BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.AUTH_BASE_URL],
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
        // Minimal profile: the Google picture URL is never stored.
        mapProfileToUser: () => ({ image: undefined }),
      },
    },
    account: {
      accountLinking: { enabled: false, disableImplicitLinking: true },
      storeStateStrategy: 'database',
      encryptOAuthTokens: true,
      storeAccountCookie: false,
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 30 },
    onAPIError: { errorURL: `${env.AUTH_BASE_URL}${ERROR_PATH}` },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: 'deadhangs',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    },
    databaseHooks: {
      account: {
        create: { before: async (data) => ({ data: { ...data, ...TOKEN_FIELDS } }) },
        update: { before: async (data) => ({ data: { ...data, ...TOKEN_FIELDS } }) },
      },
      session: {
        create: { before: async (data) => ({ data: { ...data, ipAddress: null, userAgent: null } }) },
        update: { before: async (data) => ({ data: { ...data, ipAddress: null, userAgent: null } }) },
      },
    },
  };
}

type Auth = ReturnType<typeof betterAuth>;
const cache = new WeakMap<object, { key: string; auth: Auth }>();

export function getAuth(env: ConfiguredEnv, cacheKey: object): Auth {
  const key = JSON.stringify([env.AUTH_BASE_URL, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.BETTER_AUTH_SECRET]);
  const hit = cache.get(cacheKey);
  if (hit && hit.key === key) return hit.auth;
  const auth = betterAuth(authOptions(env));
  cache.set(cacheKey, { key, auth });
  return auth;
}

export type SessionInfo = { userId: string; sessionId: string; user: { name: string | null; email: string; createdAt: Date | string }; headers: Headers };

/** Resolves the session from the cookie, returning refresh Set-Cookie headers to forward. */
export async function getSessionInfo(auth: Auth, request: Request): Promise<{ session: SessionInfo | null; headers: Headers }> {
  const result = await auth.api.getSession({ headers: request.headers, returnHeaders: true, query: { disableCookieCache: true } });
  const headers = result.headers ?? new Headers();
  const data = result.response;
  if (!data?.session || !data.user) return { session: null, headers };
  return {
    session: { userId: data.user.id, sessionId: data.session.id, user: { name: data.user.name ?? null, email: data.user.email, createdAt: data.user.createdAt }, headers },
    headers,
  };
}

/** Set-Cookie values that expire every Better Auth cookie this site uses. */
export async function expiredAuthCookies(auth: Auth): Promise<string[]> {
  const ctx = await auth.$context;
  const names = [ctx.authCookies.sessionToken.name, ctx.authCookies.sessionData.name, ctx.authCookies.accountData.name, ctx.authCookies.dontRememberToken.name];
  return names.map((name) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}
