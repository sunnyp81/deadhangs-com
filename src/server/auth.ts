import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { ConfiguredEnv, D1Database } from './env';

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
        // Keep the stored email and name current with Google; identity stays bound to the Google subject.
        overrideUserInfoOnSignIn: true,
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
      user: {
        update: {
          before: async (data) => {
            // Never let a Google email refresh collide with another user's stored email.
            if (typeof data.email !== 'string') return { data };
            const taken = await env.DB.prepare('SELECT 1 FROM "user" WHERE "email" = ? LIMIT 1').bind(data.email.toLowerCase()).first();
            if (!taken) return { data };
            // Hook results are merged, so undefined is how the email change is dropped.
            return { data: { ...data, email: undefined, emailVerified: undefined } };
          },
        },
      },
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

export const ORPHAN_MIN_AGE_MS = 60_000;

/**
 * D1 has no multi-statement transaction for Better Auth sign-up, so an interrupted first sign-in can leave a
 * user row with no Google account. With linking disabled that email would be locked out, so remove such rows
 * once they are old enough not to be an in-flight sign-up and still own no account, session or data.
 */
export async function repairInterruptedSignups(db: D1Database, now = Date.now()): Promise<number> {
  const { results } = await db.prepare('SELECT "id", "createdAt" FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u."id") LIMIT 25').all<{ id: string; createdAt: string | number }>();
  let removed = 0;
  for (const row of results ?? []) {
    const created = new Date(typeof row.createdAt === 'string' && /^\d+$/.test(row.createdAt) ? Number(row.createdAt) : row.createdAt).getTime();
    if (!Number.isFinite(created) || now - created < ORPHAN_MIN_AGE_MS) continue;
    const out = await db.prepare(`DELETE FROM "user" WHERE "id" = ?1
      AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = ?1)
      AND NOT EXISTS (SELECT 1 FROM "session" WHERE "userId" = ?1)
      AND NOT EXISTS (SELECT 1 FROM "training_log" WHERE "user_id" = ?1)
      AND NOT EXISTS (SELECT 1 FROM "billing_accounts" WHERE "user_id" = ?1)
      AND NOT EXISTS (SELECT 1 FROM "billing_subscriptions" WHERE "user_id" = ?1)`).bind(row.id).run();
    removed += out.meta?.changes ?? 0;
  }
  return removed;
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
