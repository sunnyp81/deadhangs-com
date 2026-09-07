interface Env {
  BREVO_API_KEY: string;
}

const TEMPLATE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DRIP_DAYS = [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77];

async function brevo(path: string, env: Env, opts: RequestInit = {}) {
  return fetch(`https://api.brevo.com/v3${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
      ...(opts.headers || {}),
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = context.request.headers.get('x-cron-secret');
  if (auth !== context.env.BREVO_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = Date.now();
  let sent = 0;
  let offset = 0;
  const limit = 50;

  while (true) {
    const res = await brevo(`/contacts/lists/3/contacts?limit=${limit}&offset=${offset}`, context.env);
    const data = await res.json<{ contacts: Array<{ email: string; attributes: Record<string, string> }> }>();
    if (!data.contacts?.length) break;

    for (const contact of data.contacts) {
      const signedUp = contact.attributes?.SIGNUP_DATE;
      if (!signedUp) continue;

      const daysSinceSignup = Math.floor((now - new Date(signedUp).getTime()) / 86400000);
      const lastSent = parseInt(contact.attributes?.DRIP_LAST_SENT || '-1', 10);

      for (let i = 0; i < DRIP_DAYS.length; i++) {
        if (daysSinceSignup >= DRIP_DAYS[i] && lastSent < i) {
          // Record progress BEFORE sending. Brevo's update-contact endpoint is
          // PUT /contacts/{identifier} (email in the URL path, not the body) -
          // calling PUT /contacts silently failed, so DRIP_LAST_SENT never
          // persisted and step 0 was re-sent every day. If the write fails,
          // skip the send rather than risk spamming the contact again.
          const update = await brevo(`/contacts/${encodeURIComponent(contact.email)}`, context.env, {
            method: 'PUT',
            body: JSON.stringify({
              attributes: { DRIP_LAST_SENT: String(i) },
            }),
          });

          if (!update.ok) break;

          await brevo('/smtp/email', context.env, {
            method: 'POST',
            body: JSON.stringify({
              templateId: TEMPLATE_IDS[i],
              to: [{ email: contact.email }],
            }),
          });

          sent++;
          break;
        }
      }
    }

    offset += limit;
    if (data.contacts.length < limit) break;
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
