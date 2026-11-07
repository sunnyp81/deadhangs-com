import { getAuth, getSessionInfo } from './auth';
import { configuredEnv, type AccountEnv, type PagesContext } from './env';
import { checkWriteRequest, isPlainObject, json, methodNotAllowed, readJson, signedOut } from './http';
import { BillingError, billingConfigured, createBillingService, BILLING_PRICES } from './billing.mjs';

export interface BillingEnv extends AccountEnv {
  BILLING_ENABLED?: string;
  BILLING_LAUNCH_ENABLED?: string;
  BILLING_MODE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ACCOUNT_ID?: string;
  STRIPE_PRODUCT_ID?: string;
  STRIPE_MONTHLY_PRICE_ID?: string;
  STRIPE_YEARLY_PRICE_ID?: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
}

type Action = 'checkout' | 'portal' | 'status' | 'webhook' | 'availability';

export async function billingRequest(context: PagesContext<BillingEnv>, action: Action): Promise<Response> {
  const { request, env } = context;
  const method = action === 'status' || action === 'availability' ? 'GET' : 'POST';
  if (request.method !== method) return methodNotAllowed(method);
  let headers = new Headers();
  try {
    if (action === 'availability') {
      return json({ paidAvailable: Boolean(configuredEnv(env, request)) && billingConfigured(env) && env.BILLING_LAUNCH_ENABLED === 'true', prices: BILLING_PRICES });
    }
    if (action === 'webhook') {
      if (new URL(request.url).origin !== env.AUTH_BASE_URL) return json({ error: 'billing_unavailable' }, 503);
      return json(await createBillingService(env).webhook(request));
    }
    const configured = configuredEnv(env, request);
    if (!configured) return json({ error: 'accounts_unavailable' }, 503);
    if (method === 'POST') {
      const rejected = checkWriteRequest(request, configured.AUTH_BASE_URL);
      if (rejected) return rejected;
    }
    const resolved = await getSessionInfo(getAuth(configured, env), request);
    headers = resolved.headers;
    if (!resolved.session) return signedOut(headers);
    const session = resolved.session;
    const accountKey = request.headers.get('X-DeadHangs-Account-Key');
    if ((method === 'POST' || accountKey !== null) && accountKey !== session.userId) return json({ error: 'account_changed' }, 403, headers);
    const billing = createBillingService({ ...env, ...configured });
    if (action === 'status') return json(await billing.status(session.userId), 200, headers);
    const body = await readJson(request, 1024);
    if (!body.ok) {
      const response = body.response;
      headers.forEach((value, key) => { if (key.toLowerCase() !== 'set-cookie' && !response.headers.has(key)) response.headers.set(key, value); });
      for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie);
      return response;
    }
    if (!isPlainObject(body.value)) return json({ error: 'invalid_request' }, 400, headers);
    if (action === 'checkout') {
      if (Object.keys(body.value).length !== 1 || typeof body.value.plan !== 'string' || !['monthly', 'yearly'].includes(body.value.plan)) return json({ error: 'invalid_plan' }, 400, headers);
      return json(await billing.checkout({ id: session.userId, email: session.user.email }, body.value.plan), 200, headers);
    }
    if (Object.keys(body.value).length !== 0) return json({ error: 'invalid_request' }, 400, headers);
    return json(await billing.portal(session.userId), 200, headers);
  } catch (error) {
    if (error instanceof BillingError) return json({ error: error.code }, error.status, headers);
    // Authentication/storage errors are intentionally not exposed to the client.
    return json({ error: 'billing_unavailable' }, 503, headers);
  }
}
