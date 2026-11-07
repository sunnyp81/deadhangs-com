// Runtime and D1 binding types are generated from wrangler.jsonc.
export type D1Database = CloudflareBindings['DB'];

export interface AccountEnv extends Partial<CloudflareBindings> {
  DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_BASE_URL?: string;
}

export interface ConfiguredEnv extends AccountEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_BASE_URL: string;
}

export interface PagesContext<E = AccountEnv> {
  request: Request;
  env: E;
}

/** Exact origin from AUTH_BASE_URL, or null unless it is a bare https origin (http allowed only for localhost). */
export function baseOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  if (value.replace(/\/$/, '') !== url.origin) return null;
  return url.origin;
}

/** Returns the env only when every binding and secret is present and the request host is the configured origin. */
export function configuredEnv(env: AccountEnv | undefined, request: Request): ConfiguredEnv | null {
  if (!env) return null;
  const origin = baseOrigin(env.AUTH_BASE_URL);
  if (!origin) return null;
  const db = env.DB;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') return null;
  const secret = env.BETTER_AUTH_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) return null;
  if (typeof env.GOOGLE_CLIENT_ID !== 'string' || !env.GOOGLE_CLIENT_ID.trim()) return null;
  if (typeof env.GOOGLE_CLIENT_SECRET !== 'string' || !env.GOOGLE_CLIENT_SECRET.trim()) return null;
  if (new URL(request.url).origin !== origin) return null;
  return { ...env, DB: db, BETTER_AUTH_SECRET: secret, GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID.trim(), GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET.trim(), AUTH_BASE_URL: origin };
}
