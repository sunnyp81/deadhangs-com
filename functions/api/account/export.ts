import { accountRoute } from '../../../src/server/account-route';
import { json } from '../../../src/server/http';
import { readLog } from '../../../src/server/log-store';
import { planFor } from '../../../src/server/plans';

export const onRequest = accountRoute({
  async GET({ env, session }) {
    const log = await readLog(env.DB, session.userId);
    const now = new Date();
    const createdAt = new Date(session.user.createdAt);
    return json(
      {
        format: 'deadhangs-account-export',
        version: 1,
        exportedAt: now.toISOString(),
        account: { name: session.user.name, email: session.user.email, createdAt: Number.isNaN(createdAt.getTime()) ? null : createdAt.toISOString(), plan: await planFor(env, session.userId), signIn: 'google' },
        trainingLog: { format: 'deadhangs-training-log', version: 2, entries: log.entries },
        cloudLogRevision: log.revision,
      },
      200,
      { 'Content-Disposition': `attachment; filename="deadhangs-account-export-${now.toISOString().slice(0, 10)}.json"` },
    );
  },
});
