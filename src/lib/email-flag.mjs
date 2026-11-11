// Build-time flag for the new signup placements. Read only in .astro frontmatter (Node at build).
import { emailFlagOn } from './email-consent.mjs';
const raw = typeof process !== 'undefined' && process.env ? process.env.EMAIL_CAPTURE_ENABLED : undefined;
export const EMAIL_CAPTURE_ENABLED = emailFlagOn(raw);
