// Build-time flag for the one-off plan surfaces. Read only in .astro frontmatter (Node at build). Absent means off.
const raw = typeof process !== 'undefined' && process.env ? process.env.PLAN_LAUNCH_ENABLED : undefined;
export const PLAN_LAUNCH_ENABLED = raw === 'true';
