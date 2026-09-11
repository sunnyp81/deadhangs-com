interface Env { BREVO_API_KEY: string; DRIP_ENDPOINT: string; }
export default {
  async scheduled(_event: unknown, env: Env) {
    if (!env.BREVO_API_KEY || !env.DRIP_ENDPOINT) throw new Error('Drip configuration missing');
    const url = new URL(env.DRIP_ENDPOINT);
    if (url.protocol !== 'https:' || url.hostname !== 'deadhangs.com' || url.pathname !== '/api/drip-cron') throw new Error('Unexpected drip endpoint');
    const response = await fetch(url, { headers: { 'x-cron-secret': env.BREVO_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('Drip run failed: ' + response.status);
  },
};
