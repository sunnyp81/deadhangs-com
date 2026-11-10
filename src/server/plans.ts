import { BillingError, getEntitlement } from './billing.mjs';
import type { ConfiguredEnv } from './env';

export type Plan = 'free' | 'pro';
export const PLAN_LIMITS: Record<Plan, { maxEntries: number }> = { free: { maxEntries: 200 }, pro: { maxEntries: 200 } };

// Account access/export must remain usable if the payment provider is unavailable.
export async function planFor(env: ConfiguredEnv, userId: string): Promise<Plan> {
  try { return (await getEntitlement(env, userId)).active ? 'pro' : 'free'; }
  catch (error) { if (error instanceof BillingError) return 'free'; throw error; }
}
export function limitsFor(plan: Plan) { return PLAN_LIMITS[plan]; }
