const SITE = "https://deadhangs.com";

/** ISO 8601 duration from whole seconds, e.g. 12 -> PT12S, 75 -> PT1M15S. */
export function isoDuration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return null;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `PT${m ? `${m}M` : ""}${s || !m ? `${s}S` : ""}`;
}

function absolute(url) {
  return new URL(url, SITE).href;
}

export function videoTypeFor(src) {
  return /\.webm(\?|#|$)/i.test(src) ? "video/webm" : "video/mp4";
}

/**
 * VideoObject JSON-LD for a page's `schema` prop, so it lands in the head.
 * Returns an empty string unless a real video file and a valid upload date exist.
 */
export function videoObjectSchema({ src, poster, name, description, uploadDate, duration } = {}) {
  const first = Array.isArray(src) ? src[0] : src;
  if (!first || !poster || !name || !/^\d{4}-\d{2}-\d{2}/.test(uploadDate ?? "")) return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name,
    description: description || name,
    thumbnailUrl: [absolute(poster)],
    uploadDate,
    contentUrl: absolute(first),
  };
  const iso = isoDuration(duration);
  if (iso) data.duration = iso;
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\u003c")}</script>`;
}
