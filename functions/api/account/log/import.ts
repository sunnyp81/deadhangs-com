import { accountRoute } from '../../../../src/server/account-route';
import { isPlainObject, json, readJson } from '../../../../src/server/http';
import { importLog } from '../../../../src/server/log-store';
import { limitsFor, planFor } from '../../../../src/server/plans';
import { validateEntries } from '../../../../src/server/training-log-validate';
import { requireProEntitlement } from '../../../../src/server/billing.mjs';

export const onRequest = accountRoute({
  async POST({ request, env, session }) {
    await requireProEntitlement(env, session.userId);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || Object.keys(body.value).some((key) => key !== 'entries')) return json({ error: 'invalid_request', message: 'Send only entries.' }, 400);
    const checked = validateEntries(body.value.entries, limitsFor(await planFor(env, session.userId)).maxEntries);
    if (!checked.ok) return json(checked.body, checked.status);
    const result = await importLog(env.DB, session.userId, checked.entries);
    if (!result.ok) return json({ error: 'cloud_log_exists', revision: result.revision }, 409);
    return json({ revision: result.revision, updatedAt: result.updatedAt, count: result.count });
  },
});
