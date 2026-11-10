import { accountRoute } from '../../../../src/server/account-route';
import { expiredAuthCookies } from '../../../../src/server/auth';
import { json } from '../../../../src/server/http';
import { deleteSessions } from '../../../../src/server/log-store';

export const onRequest = accountRoute({
  async POST({ env, auth, session }) {
    await deleteSessions(env.DB, session.userId);
    const headers = new Headers();
    for (const cookie of await expiredAuthCookies(auth)) headers.append('set-cookie', cookie);
    return json({ revoked: true }, 200, headers);
  },
});
