interface Env {
  BREVO_API_KEY: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await fetch(env.DRIP_ENDPOINT, {
      headers: { 'x-cron-secret': env.BREVO_API_KEY },
    });
  },
} satisfies ExportedHandler<Env>;
