// Build-time flag for the private gym challenge pilot. Read only in .astro frontmatter (Node at build). Absent means off.
const raw = typeof process !== 'undefined' && process.env ? process.env.GYM_PILOT_ENABLED : undefined;
export const GYM_PILOT_ENABLED = raw === 'true';
