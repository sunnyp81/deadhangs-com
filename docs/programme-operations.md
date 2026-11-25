# Guided programme operations (hang4)

Plans, decisions and evidence live in the shared harness: `harness/memory/site-directives/deadhangs.com/programme-2026-11-25/README.md`. This file is the operational runbook only.

## What exists

- Product: "Four-week guided hang programme", programme id `hang4`, GBP 29 one-off (2900 pence), no subscription. Public metadata `src/data/programmes/hang4.public.mjs`; paid session copy `src/server/programmes/hang4.copy.json` (server-only); engine `src/lib/programme-engine.mjs`; sales gate `src/server/programme-gate.mjs`.
- Pages: `/programme/` (sales page, noindex, interest signup while closed) and `/programme/app/` (private workspace, noindex, no analytics, never cached by the service worker).
- API: `/api/programme/availability` (public), `/api/programme/interest` (public), `/api/programme/state|progress|checkout|settle` (signed in, same-origin, account key header), `/api/programme/reminders-off` (signed link).
- Data (migration `0005_programme.sql`): `programme_purchases`, `programme_progress`, `programme_interest`, `programme_reminder_deliveries`.

## Access rules

| Person | Gets |
|---|---|
| Free visitor | Timer, local log, free guides, `/programme/` sales page and fit check. |
| Pro member | Existing Pro rights only (cloud log merge and history). No programme. |
| Programme buyer | The programme: sessions, recorded results, reviews, final comparison, on every device they sign in on. No Pro. |
| Pro member who also bought | Both, independently. Cancelling Pro never touches the programme. |
| Refunded or disputed buyer | Programme access ends; their own records stay readable and exportable. Repurchase is allowed after a refund. |

Entitlement is read from `programme_purchases` rows written only after the Stripe session and charge are re-fetched and verified. A checkout success URL never grants access. Rows are bound to the provider mode (`live` or `test`).

## Sales gate (two keys)

New purchases open only when BOTH:

1. Content key, in the committed manifest: `status` is `approved` or `published`; `review` has a real reviewer name, role, qualification, how the qualification was verified, scope, the exact `version` reviewed, an approval date and where the signed review is kept; `terms.access`, `terms.support` and `terms.refund` are set; every `promised: true` inclusion's asset is available; no promised feature is unverified. An AI or owner sign-off of sales copy is not a review. `tests/programme-engine.test.mjs` fails if the committed manifest is not `draft`; update that test in the same commit as a real approval.
2. Environment key: `PROGRAMME_LAUNCH_ENABLED=true` and `STRIPE_PROGRAMME_PRICE_ID` set to a one-time GBP 29 price whose product has metadata `app=deadhangs`, `product=programme_hang4`.

Test mode on an isolated preview may sell the draft with `BILLING_MODE=test`, `PROGRAMME_ALLOW_DRAFT=true`, `PROGRAMME_LAUNCH_ENABLED=true` and a test price. Both are refused on `deadhangs.com`.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `PROGRAMME_LAUNCH_ENABLED` | Pages vars | `true` opens checkout when the content key also passes. Absent means closed. |
| `STRIPE_PROGRAMME_PRICE_ID` | Pages vars | `price_...`, one-time, GBP 2900. Separate ids for test and live. |
| `PROGRAMME_ALLOW_DRAFT` | Preview only | Never set in production. |
| `PROGRAMME_REMINDERS_ENABLED` | Pages vars | Reminder sending. Off. Also needs every email readiness gate in `docs/email-operations.md`. |

Existing billing variables and secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, etc.) are reused. The Stripe webhook endpoint must also receive `checkout.session.expired` and `checkout.session.async_payment_failed`; the existing completed, refund and dispute events are already subscribed.

## Launch steps (owner authorisation needed for each production step)

1. Real qualified review recorded in the manifest (see the harness review pack), terms decided, `/terms/#programme` and the privacy page updated and approved.
2. Back up production D1: `npx wrangler@4.158.0 d1 export deadhangs-accounts --remote --env production --output backup-YYYYMMDD.sql` (from an account that can reach the production Cloudflare account).
3. Apply migration 0005 to preview, rehearse, then production: `npx wrangler@4.158.0 d1 migrations apply deadhangs-accounts --remote --env production`. It only creates tables.
4. Create the live product and one-time price in Stripe (metadata above); set `STRIPE_PROGRAMME_PRICE_ID` and `PROGRAMME_LAUNCH_ENABLED=true` in production; add the two webhook event types.
5. Deploy, then verify `/api/programme/availability` returns `open: true` and a real-card purchase is NOT used to test; use the preview test-mode journey as the purchase evidence.
6. Send the one launch email to `programme_interest` rows (draft in the harness pack) and set `notified_at`.

## Rollback

- Close sales: set `PROGRAMME_LAUNCH_ENABLED` to anything but `true` and redeploy. Existing buyers keep access; settlement, refunds and the webhook keep working.
- Code rollback: revert the merge. Data written after release (purchases, progress, interest) stays in its tables; the previous code ignores them. Do not drop tables while any paid purchase exists: they are the payment and access record. Refunds then go through the Stripe dashboard and are mirrored by the webhook only while the programme code is deployed; after a code rollback, mark refunded rows by hand.

## Reminders

Built, not live: `src/server/programme-reminders.mjs` (timezone and daylight-saving aware, one per person per local day, preference, pause and access re-read at send time, signed one-click off link that also works for addresses that are not newsletter contacts). Not wired to a cron and no settings UI is shown; the offer does not promise reminders. To go live: add an hourly cron caller (the existing drip Worker runs daily at 09:00 UTC, which is not enough), show the settings UI, set `promised: true` on the reminders inclusion, and pass the email gates.

## Owner readout

`node scripts/programme-readout.mjs --from YYYY-MM-DD --to YYYY-MM-DD --exclude-users <owner test user ids>` (needs wrangler access to the production account; from the desktop that account is reachable only through the VPS route in the harness reference). Aggregates only. Definitions are in the script header. Purchases come from D1, never from analytics.

## Support

- Lost access: the buyer signs in with the same Google account. Programme access is account-bound; there is no access link to lose.
- Refund: issue it in Stripe; the `charge.refunded` webhook ends access and keeps the records.
- Account deletion: open programme checkouts are expired first; progress is deleted; the payment row is kept without the user id. Deleting an account does not refund a purchase; say so before deleting.
