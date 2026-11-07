import { accountRoute } from '../../../src/server/account-route';
import { expiredAuthCookies } from '../../../src/server/auth';
import { isPlainObject, json, readJson } from '../../../src/server/http';
import { deleteAccountData, readLog } from '../../../src/server/log-store';
import { limitsFor, planFor } from '../../../src/server/plans';
import { prepareBillingAccountDeletion } from '../../../src/server/billing.mjs';

export const onRequest = accountRoute({
  async GET({ env, session }) {
    const log = await readLog(env.DB, session.userId);
    const plan = await planFor(env, session.userId);
    return json({
      accountKey: session.userId,
      user: { name: session.user.name, email: session.user.email },
      plan,
      limits: limitsFor(plan),
      log: { exists: log.exists, revision: log.revision, count: log.entries.length, updatedAt: log.updatedAt },
    });
  },
  async DELETE({ request, env, auth, session }) {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || body.value.confirm !== 'delete-account') return json({ error: 'confirmation_required', confirm: 'delete-account' }, 400);
    await prepareBillingAccountDeletion(env, session.userId);
    await deleteAccountData(env.DB, session.userId);
    const headers = new Headers();
    for (const cookie of await expiredAuthCookies(auth)) headers.append('set-cookie', cookie);
    return json({ deleted: true }, 200, headers);
  },
});
