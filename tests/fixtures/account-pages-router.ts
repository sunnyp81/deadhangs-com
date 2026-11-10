// Test-only worker entry that mirrors Cloudflare Pages file routing for the account functions.
import { onRequest as auth } from '../../functions/api/auth/[[path]]';
import { onRequest as account } from '../../functions/api/account/index';
import { onRequest as accountLog } from '../../functions/api/account/log/index';
import { onRequest as accountImport } from '../../functions/api/account/log/import';
import { onRequest as accountExport } from '../../functions/api/account/export';
import { onRequest as revoke } from '../../functions/api/account/sessions/revoke';

const exact: Record<string, (ctx: { request: Request; env: any }) => Promise<Response>> = {
  '/api/account': account,
  '/api/account/log': accountLog,
  '/api/account/log/import': accountImport,
  '/api/account/export': accountExport,
  '/api/account/sessions/revoke': revoke,
};

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/auth/')) return auth({ request, env: env as any });
    const handler = exact[path];
    return handler ? handler({ request, env }) : new Response('not found', { status: 404 });
  },
};
