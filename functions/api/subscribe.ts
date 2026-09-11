interface Env { BREVO_API_KEY: string; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control':'no-store' } });
export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error:'Invalid origin' },403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error:'Use JSON' },415);
  if (Number(request.headers.get('content-length')) > 4096) return json({ error:'Request too large' },413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error:'Invalid JSON' },400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ error:'Request too large' },413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder().decode(bytes);
    if (raw.length > 4096) return json({ error:'Request too large' },413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error:'Invalid JSON' },400); }
    const value = input && typeof input === 'object' ? (input as {email?:unknown}).email : null;
    const email = typeof value === 'string' ? value.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error:'Invalid email' },400);
    if (!env.BREVO_API_KEY) return json({ error:'Signup is temporarily unavailable' },503);
    const response = await fetch('https://api.brevo.com/v3/contacts', { method:'POST', headers:{'Content-Type':'application/json','api-key':env.BREVO_API_KEY}, body:JSON.stringify({email,listIds:[3],attributes:{SIGNUP_DATE:new Date().toISOString().split('T')[0],DRIP_LAST_SENT:'-1'},updateEnabled:false}), signal:AbortSignal.timeout(10000) });
    if (response.ok) return json({ok:true});
    const result = await response.json() as {code?:string};
    if (response.status === 400 && result.code === 'duplicate_parameter') return json({ok:true,existing:true});
    return json({error:'Subscription failed'},502);
  } catch { return json({error:'Subscription temporarily unavailable'},502); }
};
