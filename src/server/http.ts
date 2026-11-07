export const MAX_BODY_BYTES = 96 * 1024;

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const unavailable = () => json({ error: 'accounts_unavailable' }, 503);
export const signedOut = (headers?: HeadersInit) => json({ error: 'signed_out' }, 401, headers);
export const methodNotAllowed = (allow: string) => json({ error: 'method_not_allowed' }, 405, { Allow: allow });

/** Same-origin guard for state-changing requests. Origin must equal the configured origin exactly. */
export function checkWriteRequest(request: Request, origin: string): Response | null {
  if (request.headers.get('origin') !== origin) return json({ error: 'invalid_origin' }, 403);
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return json({ error: 'invalid_origin' }, 403);
  return null;
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads a JSON body with a hard byte cap enforced while streaming. */
export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('application/json')) return { ok: false, response: json({ error: 'unsupported_media_type' }, 415) };
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, response: json({ error: 'too_large', maxBytes: limit }, 413) };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: json({ error: 'invalid_json' }, 400) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, response: json({ error: 'too_large', maxBytes: limit }, 413) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; }
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function serverError(): Response {
  return json({ error: 'server_error' }, 500);
}
