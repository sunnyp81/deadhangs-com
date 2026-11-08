# Accounts and Pro operations

The free timer and local log require no account. Google accounts are free. Pro provides deliberate cloud log merge/restore and progress history at GBP 4.99 monthly or GBP 39 yearly. Signing in never uploads local data. The initial cloud limit is 200 entries; uploads reject overflow instead of truncating it.

## Environments

`wrangler.jsonc` is the Pages configuration source. Production is Cloudflare account `aba0a6722a4510842ca473315a8ba13e`, project `deadhangs-com`, origin `https://deadhangs.com`. Preview and local development use a separate database. Never bind a preview to the production database.

Apply both migrations, in filename order, before activating accounts:

```powershell
npx wrangler@4.158.0 d1 migrations apply deadhangs-accounts-preview --remote --env preview
npx wrangler@4.158.0 d1 migrations apply deadhangs-accounts --remote --env production
```

Required auth secrets: `BETTER_AUTH_SECRET` (at least 32 random characters), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Set them separately in the intended Pages environment; do not put secret values in Wrangler JSON or Git. A preview must have its own exact `AUTH_BASE_URL`, Google callback and credentials before sign-in works. An empty base URL deliberately disables it.

Google OAuth web client: DeadHangs; scopes `openid email profile`; production redirect `https://deadhangs.com/api/auth/callback/google`. Tokens and profile pictures are not retained. Auth uses secure HTTP-only cookies, D1 sessions, state and PKCE. The local Google stub verifies application behavior, not the configuration of a real Google client.

Identity is bound to the Google subject; email linking is disabled. The stored name and email refresh from Google at each sign-in, except that an email already held by another DeadHangs user is left unchanged rather than failing sign-in. D1 cannot wrap Better Auth's user and account inserts in one transaction, so an interrupted first sign-in can leave a user row with no Google account. Repair runs inside the Google profile mapping step, which Better Auth reaches only after it has checked the OAuth state and exchanged the code with Google. It deletes at most the one row holding that sign-in's Google-verified email, and only if the row is older than 60 seconds and has no Google account, session, training log or billing record. Missing, forged or failed callbacks never reach it, and no other user rows are touched. Fresh rows and rows owning data are kept, so that email gets `account_not_linked` until the row is cleared by hand.

## Billing activation

Required secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Required configuration: `STRIPE_ACCOUNT_ID`, `STRIPE_PRODUCT_ID`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `STRIPE_PORTAL_CONFIGURATION_ID`, `BILLING_ENABLED=true`, `BILLING_MODE=live`.

Create a dedicated DeadHangs product and prices in the selected merchant account. Use `metadata.app=deadhangs`. Never add `metadata.userId`: another application on the proposed shared account consumes that field. The application creates its own opaque `deadhangs_user_ref` and separate customers. Do not change shared merchant branding or portal defaults to configure DeadHangs.

Configure a dedicated portal with cancellation at period end and subscription plan changes disabled. Register the signed webhook at `/api/billing/webhook`; its accepted event list is in `src/server/billing.mjs`. Events trigger retrieval of current Stripe state, rather than trusting an old event snapshot. A checkout success URL never grants Pro.

Use `BILLING_MODE=test` only on a separate preview origin and database, with test credentials and test objects. Test mode is rejected on the production origin; cached test entitlements cannot unlock production.

Keep `BILLING_LAUNCH_ENABLED` unset until all of these have evidence:

- Real Google login, logout, account isolation and explicit sync on the deployed preview.
- Stripe sandbox checkout, signed webhook, renewal, cancellation, refund, expired session and duplicate-checkout handling.
- Correct seller identity, address, support contact, receipt descriptor, currency and tax display. Confirm that hosted Checkout shows DeadHangs terms and privacy links, rather than the other site's defaults.
- Final subscription terms, applicable cancellation rights, confirmation and renewal notices. The current terms are an implementation draft; the merchant information is not yet verified.
- Production build, tests, rendered desktop/mobile review, dependency and secret scans, and exact deployed commit readback.

Then set `BILLING_LAUNCH_ENABLED=true`. Turning new checkout off must not prevent an existing customer from using the billing portal, cancelling, exporting or deleting their data. Do not make a real charge merely to test the integration.

## Data and recovery

Every authenticated account operation uses the server session as owner. `X-DeadHangs-Account-Key` detects a stale tab after the browser changes Google accounts; it is not an authentication credential. Cloud writes use a monotonically increasing revision. A conflict returns 409 and requires a fresh read and explicit retry.

Export and deletion remain available without Pro. The account export can be imported into the free local log. Account deletion first expires open checkout and confirms subscription cancellation; provider failure refuses deletion rather than leaving an orphaned renewal. Device logs are not deleted by account deletion.

Private APIs return `Cache-Control: no-store`. The service worker ignores account, Pro and API paths. Analytics is omitted from account and Pro pages. Avoid logging request bodies, cookies, OAuth responses or payment-provider bodies. Configure edge rate limits for auth/account/billing routes before opening a public paid service.

The canonical dated activation status and handoff are in the shared harness directive for deadhangs.com, not this operational guide.
