import { handlePlanView } from '../../../src/server/plan-view.mjs';
import type { PagesContext, D1Database } from '../../../src/server/env';

interface PlanViewEnv { DB?: D1Database; ASSETS: { fetch(input: Request | URL | string): Promise<Response> } }

export const onRequest = (context: PagesContext<PlanViewEnv>) => handlePlanView(context.request, context.env);
