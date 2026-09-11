# DeadHangs training workspace build

The site now connects personal hang comparisons, editable intervals, a local training log and disclosed equipment links. Existing routes are retained; /training-log/ is new.

## Existing design preserved

The homepage follows the existing live theme: original colours and fonts, oversized four-line headline, compact fixed navigation, alternating sections, circular timer and cyan signup section. The calculator and local log are added within that structure. The circular timer retains Simple, EMOM, Ladder and sound controls, with deadline-based timing, automatic background pause and keyboard-safe settings locks. EMOM caps work at 50 seconds so each minute retains at least 10 seconds of rest. Completed timer intervals are never recorded as actual holds.

## Running locally

Use Node 22.19.0 or newer. Run npm ci, npm run check, npm test and npm run build. npm run preview serves the generated site. Cloudflare Pages Functions need a Pages runtime; Astro preview alone serves only static files.

## Data and analytics

Training entries remain in localStorage under dh.training-log.v1. The log supports CSV export, deletion, malformed-data recovery and conflict detection when another tab writes. It does not auto-save timer completions. GA4 and affiliate-click events require the visitor's analytics consent. No training values or email addresses are included in those events. Fonts are self-hosted; font licences are in public/fonts.

## Email configuration

The signup handler needs BREVO_API_KEY and an existing list 3 with SIGNUP_DATE and DRIP_LAST_SENT attributes. Existing contacts are not overwritten. Provider registration is not inbox delivery. Preview intentionally has no email key.

The scheduled sequence is disabled unless DRIP_ENABLED=true. Before enabling, review all twelve templates, sender identity, consent and unsubscribe behaviour, and test delivery with an approved test address. Do not enable it just to validate a build. The worker needs BREVO_API_KEY and DRIP_ENDPOINT=https://deadhangs.com/api/drip-cron. A provider-accepted send followed by a failed progress write requires investigation before retrying; this route is not an exactly-once queue. Validate edge abuse/rate controls before expanding public signup promotion.

## Monetization

Current category links use the existing Amazon UK tag deadhangs-21. No US tag has been invented. Check the relevant store's approved tag and destinations before adding US links. Click events measure outbound clicks, not revenue. Reconcile purchases and commissions in the affiliate account.

## Release scope

Core pages now separate handgrip-force research from timed hangs and correct unsupported benchmark and product-testing claims. World-record categories were checked against Guinness on 11 September 2026. Older specialist health and product articles retain their existing content apart from shared navigation, table accessibility and encoding repairs; this build does not represent a new clinical or hands-on product review of that archive.

The review branch is a draft release. Promote only after the exact hosted preview and the remaining email/legacy-content checks are reviewed. Production deployment must be verified against the final commit, not inferred from a Git push.
