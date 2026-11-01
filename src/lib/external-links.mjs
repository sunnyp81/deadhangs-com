// Adds target="_blank" and rel="noopener noreferrer" to every <a> whose href points off-site, keeping existing rel tokens.
export function isExternal(href, siteHost) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(href || "");
  if (!m) return false;
  const host = m[1].toLowerCase().replace(/^www\./, "");
  return host !== siteHost.toLowerCase().replace(/^www\./, "");
}

export function openExternalLinksInNewTab(html, siteHost) {
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = /\shref\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\shref\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    if (!isExternal(href, siteHost)) return tag;
    let out = tag;
    if (/\starget\s*=/i.test(out)) out = out.replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ' target="_blank"');
    else out = out.replace(/^<a\b/i, '<a target="_blank"');
    const relMatch = /\srel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(out);
    const tokens = new Set((relMatch ? (relMatch[2] ?? relMatch[3]) : "").split(/\s+/).filter(Boolean));
    tokens.add("noopener");
    tokens.add("noreferrer");
    const rel = ` rel="${[...tokens].join(" ")}"`;
    out = relMatch ? out.replace(relMatch[0], rel) : out.replace(/^<a\b/i, `<a${rel}`);
    return out;
  });
}
