// Test-only worker entry mirroring Cloudflare Pages file routing for auth, account, billing webhook, programme and gym functions.
import { onRequest as auth } from '../../functions/api/auth/[[path]]';
import { onRequest as account } from '../../functions/api/account/index';
import { onRequest as accountExport } from '../../functions/api/account/export';
import { onRequest as webhook } from '../../functions/api/billing/webhook';
import { onRequest as availability } from '../../functions/api/programme/availability';
import { onRequest as interest } from '../../functions/api/programme/interest';
import { onRequest as state } from '../../functions/api/programme/state';
import { onRequest as progress } from '../../functions/api/programme/progress';
import { onRequest as checkout } from '../../functions/api/programme/checkout';
import { onRequest as settle } from '../../functions/api/programme/settle';
import { onRequest as gymEnquiry } from '../../functions/api/gym/enquiry';
import { onRequest as gymJoin } from '../../functions/api/gym/join';
import { onRequest as gymCampaign } from '../../functions/api/gym/campaign';
import { onRequest as gymResult } from '../../functions/api/gym/result';
import { onRequest as gymOrganiser } from '../../functions/api/gym/organiser';
import { onRequest as gymExport } from '../../functions/api/gym/export';

const exact: Record<string, (ctx: { request: Request; env: any }) => Promise<Response>> = {
  '/api/account': account as any,
  '/api/account/export': accountExport as any,
  '/api/billing/webhook': webhook as any,
  '/api/programme/availability': availability as any,
  '/api/programme/interest': interest as any,
  '/api/programme/state': state as any,
  '/api/programme/progress': progress as any,
  '/api/programme/checkout': checkout as any,
  '/api/programme/settle': settle as any,
  '/api/gym/enquiry': gymEnquiry as any,
  '/api/gym/join': gymJoin as any,
  '/api/gym/campaign': gymCampaign as any,
  '/api/gym/result': gymResult as any,
  '/api/gym/organiser': gymOrganiser as any,
  '/api/gym/export': gymExport as any,
};

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/auth/')) return auth({ request, env: env as any });
    const handler = exact[path];
    return handler ? handler({ request, env }) : new Response('not found', { status: 404 });
  },
};
