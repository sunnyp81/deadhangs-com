interface Env {
  BUTTONDOWN_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { email } = await context.request.json<{ email: string }>();

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.buttondown.email/v1/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${context.env.BUTTONDOWN_API_KEY}`,
    },
    body: JSON.stringify({
      email_address: email,
      tags: ['drip-protocol'],
    }),
  });

  if (res.ok || res.status === 409) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Subscription failed' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
};
