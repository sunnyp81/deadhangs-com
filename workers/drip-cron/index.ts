interface Env { DRIP_CRON_SECRET: string; DRIP_ENABLED?: string; DRIP_ENDPOINT: string; }
export default {
  async scheduled(_event: unknown, env: Env) {
    if (env.DRIP_ENABLED !== 'true') return;
    if (!env.DRIP_CRON_SECRET || !env.DRIP_ENDPOINT) throw new Error('Drip configuration missing');
    const url = new URL(env.DRIP_ENDPOINT);
    if (url.protocol !== 'https:' || url.hostname !== 'deadhangs.com' || url.pathname !== '/api/drip-cron') throw new Error('Unexpected drip endpoint');
    const response = await fetch(url, { method: 'POST', headers: { 'x-cron-secret': env.DRIP_CRON_SECRET }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('Drip run failed: ' + response.status);
    const result = await response.json() as { ok?: boolean; enabled?: boolean; truncated?: boolean };
    if (!result.ok || !result.enabled || result.truncated) throw new Error('Drip run disabled, incomplete or requires continuation');
  },
};
