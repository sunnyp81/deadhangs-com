interface Env {
  BREVO_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { email } = await context.request.json<{ email: string }>();

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': context.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      email,
      listIds: [3],
      attributes: {
        SIGNUP_DATE: new Date().toISOString().split('T')[0],
        DRIP_LAST_SENT: '-1',
      },
      updateEnabled: false,
    }),
  });

  if (res.ok) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await res.json<{ message?: string; code?: string }>();
  if (body.code === 'duplicate_parameter') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Subscription failed' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
};
