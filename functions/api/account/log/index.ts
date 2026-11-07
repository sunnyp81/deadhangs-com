import { accountRoute } from '../../../../src/server/account-route';
import { isPlainObject, json, readJson } from '../../../../src/server/http';
import { clearLog, readLog, writeLog } from '../../../../src/server/log-store';
import { limitsFor, planFor } from '../../../../src/server/plans';
import { CLOUD_SCHEMA_VERSION, validateEntries } from '../../../../src/server/training-log-validate';
import { requireProEntitlement } from '../../../../src/server/billing.mjs';

const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const onRequest = accountRoute({
  async GET({ env, session }) {
    const log = await readLog(env.DB, session.userId);
    return json({ schemaVersion: CLOUD_SCHEMA_VERSION, exists: log.exists, revision: log.revision, updatedAt: log.updatedAt, maxEntries: limitsFor(await planFor(env, session.userId)).maxEntries, entries: log.entries });
  },
  async PUT({ request, env, session }) {
    await requireProEntitlement(env, session.userId);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || Object.keys(body.value).some((key) => key !== 'baseRevision' && key !== 'entries') || !isRevision(body.value.baseRevision)) return json({ error: 'invalid_request', message: 'Send baseRevision and entries only.' }, 400);
    const checked = validateEntries(body.value.entries, limitsFor(await planFor(env, session.userId)).maxEntries);
    if (!checked.ok) return json(checked.body, checked.status);
    const result = await writeLog(env.DB, session.userId, body.value.baseRevision, checked.entries);
    if (!result.ok) return json({ error: 'revision_conflict', revision: result.revision }, 409);
    return json({ revision: result.revision, updatedAt: result.updatedAt, count: result.count });
  },
  async DELETE({ request, env, session }) {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value) || body.value.confirm !== 'delete-cloud-log') return json({ error: 'confirmation_required', confirm: 'delete-cloud-log' }, 400);
    if (!isRevision(body.value.baseRevision)) return json({ error: 'invalid_request', message: 'baseRevision is required.' }, 400);
    const result = await clearLog(env.DB, session.userId, body.value.baseRevision);
    if (!result.ok) return json({ error: 'revision_conflict', revision: result.revision }, 409);
    return json({ deleted: true, revision: result.revision });
  },
});
