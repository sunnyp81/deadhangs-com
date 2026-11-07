import { billingRequest, type BillingEnv } from '../../../src/server/billing-http';
import type { PagesContext } from '../../../src/server/env';
export const onRequest = (context: PagesContext<BillingEnv>) => billingRequest(context, 'checkout');
