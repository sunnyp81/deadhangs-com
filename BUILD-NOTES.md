# DeadHangs training workspace build

The site now connects personal hang comparisons, editable intervals, a local training log and disclosed equipment links. Existing routes are retained; /training-log/ is new.

## Existing design preserved

The homepage follows the existing live theme: original colours and fonts, oversized four-line headline, compact fixed navigation, alternating sections, circular timer and cyan signup section. The calculator and local log are added within that structure. The circular timer retains Simple, EMOM, Ladder and sound controls, with deadline-based timing, automatic background pause and keyboard-safe settings locks. EMOM caps work at 50 seconds so each minute retains at least 10 seconds of rest. Completed timer intervals are never recorded as actual holds.

## Running locally

Use Node 22.19.0 or newer. Run npm ci, npm run check, npm test and npm run build. npm run preview serves the generated site. Cloudflare Pages Functions need a Pages runtime; Astro preview alone serves only static files.

## Data and analytics

Training entries remain in localStorage under dh.training-log.v1. The log supports CSV export, portable JSON backups, validated CSV/JSON import, deletion, malformed-data recovery and conflict detection when another tab writes. Imports merge only after confirmation; invalid files, conflicting IDs, more than 200 entries or files over 128 KB are rejected without changing the log. JSON imports preserve IDs; CSV imports match field values and multiplicity. Selecting a file before another save cannot overwrite that newer save. It does not auto-save timer completions. GA4 and affiliate-click events require the visitor's analytics consent. No training values or email addresses are included in those events. Fonts are self-hosted; font licences are in public/fonts.

## Email configuration

The signup handler needs BREVO_API_KEY and an existing list 3 with SIGNUP_DATE and DRIP_LAST_SENT attributes. Existing contacts are not overwritten. Provider registration is not inbox delivery. Preview intentionally has no email key.

The email automation has separate read and send operations:

- Authenticated GET /api/drip-cron is always read-only on this build. It checks configuration, all twelve templates, and a bounded batch of contacts. It returns due counts by sequence step, skipped counts and a continuation offset; no email addresses are returned and no progress is written.
- POST /api/drip-cron requires DRIP_CRON_SECRET and DRIP_ENABLED=true. Configure DRIP_TEMPLATE_IDS as twelve distinct IDs in sequence order; no template mapping is assumed. All templates must be active, have a subject/sender and contain the Brevo unsubscribe token before any send is attempted. This is an automated preflight, not proof of sender authentication, rendered email quality or inbox delivery.
- The scheduler also requires DRIP_ENABLED=true, DRIP_CRON_SECRET and DRIP_ENDPOINT=https://deadhangs.com/api/drip-cron. Deploy the new API before updating/enabling the scheduler. The previous production GET handler is not a dry run; only use the GET check against this build or after promotion.
- Dry runs scan at most 200 contacts. Send batches stop after 15 accepted-and-recorded sends and return nextOffset when continuation may be needed. A truncated scheduler run fails visibly for investigation; it does not silently claim the whole list was processed.
- A provider-accepted send followed by failed progress persistence sets reviewRequired and reports accepted separately from sent. Do not retry blindly: this is not a durable exactly-once queue. Review all twelve email templates, sender identity, consent and unsubscribe behaviour before activation. No emails were sent during validation.

Preview has no email provider key. Live provider/template readiness and inbox delivery remain unverified. Validate edge abuse/rate controls before expanding signup promotion.

Provider references: [template details](https://developers.brevo.com/reference/get-smtp-template), [Brevo unsubscribe token](https://developers.brevo.com/docs/getting-started-with-external-feeds).

## Monetization

Current category links use the existing Amazon UK tag deadhangs-21. No US tag has been invented. Check the relevant store's approved tag and destinations before adding US links. Click events measure outbound clicks, not revenue. Reconcile purchases and commissions in the affiliate account.

## Release scope

Core pages now separate handgrip-force research from timed hangs and correct unsupported benchmark and product-testing claims. World-record categories were checked against Guinness on 11 September 2026. Older specialist health and product articles retain their existing content apart from shared navigation, table accessibility and encoding repairs; this build does not represent a new clinical or hands-on product review of that archive.

The review branch is a draft release. Promote only after the exact hosted preview and the remaining email/legacy-content checks are reviewed. Production deployment must be verified against the final commit, not inferred from a Git push.
