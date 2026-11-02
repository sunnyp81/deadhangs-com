/** Limits match the on-screen timer steppers (src/components/HangTimer.tsx). */
export const EMBED_LIMITS = Object.freeze({
  work: { min: 5, max: 120, step: 5, def: 30 },
  rest: { min: 10, max: 300, step: 10, def: 60 },
  rounds: { min: 1, max: 10, step: 1, def: 3 },
});
export const EMBED_THEMES = ["dark", "light"];

function whole(value, { min, max, def }) {
  if (value === null || value === undefined || !/^\d{1,4}$/.test(String(value))) return def;
  return Math.min(max, Math.max(min, Number(value)));
}

/** Reads work, rest, rounds and theme from a query string. Anything unreadable falls back to the default. */
export function parseEmbedParams(search) {
  const p = new URLSearchParams(String(search ?? ""));
  const theme = (p.get("theme") ?? "").toLowerCase();
  return {
    work: whole(p.get("work"), EMBED_LIMITS.work),
    rest: whole(p.get("rest"), EMBED_LIMITS.rest),
    rounds: whole(p.get("rounds"), EMBED_LIMITS.rounds),
    theme: EMBED_THEMES.includes(theme) ? theme : "dark",
  };
}

export const EMBED_CREDIT_HTML =
  '<p>Dead hang timer by <a href="https://deadhangs.com/training-log/">DeadHangs.com</a></p>';

/** Builds the iframe URL. Values are clamped, defaults are left out to keep the URL short. */
export function buildEmbedUrl(origin, input) {
  const v = parseEmbedParams(new URLSearchParams(Object.entries(input).map(([k, x]) => [k, String(x)])).toString());
  const q = new URLSearchParams();
  for (const k of ["work", "rest", "rounds"]) if (v[k] !== EMBED_LIMITS[k].def) q.set(k, String(v[k]));
  if (v.theme !== "dark") q.set("theme", v.theme);
  const qs = q.toString();
  return `${origin}/embed/timer/${qs ? `?${qs}` : ""}`;
}

/** Iframe plus the optional visible credit line. width is a CSS length ("100%", "420px"). */
export function buildEmbedCode(origin, input, { width = "100%", height = 600, credit = true } = {}) {
  const w = /^\d{3,4}px$|^100%$/.test(width) ? width : "100%";
  const h = Math.min(1200, Math.max(300, Math.round(Number(height)) || 600));
  const iframe = `<iframe src="${buildEmbedUrl(origin, input)}" title="Dead hang timer" width="${w.replace("px", "")}" height="${h}" style="border:0;max-width:100%;" loading="lazy"></iframe>`;
  return credit ? `${iframe}\n${EMBED_CREDIT_HTML}` : iframe;
}
