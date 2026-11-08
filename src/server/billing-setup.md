# DeadHangs billing integration — local implementation, activation pending

Implemented 7 November 2026. No merchant object, webhook endpoint, checkout,
charge or production binding was created by this implementation.

## Runtime contract

- `POST /api/billing/checkout` accepts exactly `{ "plan": "monthly" }` or
  `{ "plan": "yearly" }`. Returns `{ "url": "https://checkout.stripe.com/..." }`.
- `POST /api/billing/portal` accepts exactly `{}` and returns a hosted portal URL.
- `GET /api/billing/status` returns `plan`, `entitlement`, `hasBillingAccount`,
  `paidAvailable`, `prices`, and `billingUnavailableReason` if verification fails.
  `entitlement.status = "unverified"` means the payment state could not be checked;
  it is not evidence that a payment failed. Keep Manage billing available when
  `hasBillingAccount` is true, even if Pro is inactive.
- `GET /api/billing/availability` exposes only the readiness flag and fixed prices.
- `POST /api/billing/webhook` accepts Stripe's signed raw body, without a browser
  session. Maximum body 256 KiB; signature tolerance 300 seconds old / 60 seconds
  future. Never JSON-parse or transform the body before signature verification.

Authenticated operations use the existing Better Auth cookie. POST requires the
exact configured Origin and `X-DeadHangs-Account-Key` matching the current trusted
session user ID. GET status validates the key when supplied. All responses are
`no-store`; refreshed session cookies are forwarded even on body validation errors.
No request-supplied customer, user, price ID or amount is accepted.

Account backend integration:

```ts
import { getEntitlement, requireProEntitlement, prepareBillingAccountDeletion }
  from './billing.mjs';
```

Pass trusted runtime billing bindings, not only a stripped auth-config object.
Use `requireProEntitlement(env, session.userId)` for paid cloud writes, and
`getEntitlement` for account presentation. Keep cloud export and deletion available
after downgrade. Before deleting the auth user call
`prepareBillingAccountDeletion(env, session.userId)` and stop deletion on any error.
It expires the pending checkout and immediately cancels every owned nonterminal
subscription without invoicing or proration. It leaves a deletion tombstone if
cancellation cannot be verified; retry deletion or use the portal and resolve the
reported access/recovery issue. Never delete the user first.

## Required server-only bindings

| Binding | Value / purpose |
| --- | --- |
| `DB` | Migrated D1; apply `0001_accounts.sql`, then `0002_billing.sql` |
| `AUTH_BASE_URL` | Exact bare HTTPS origin; production `https://deadhangs.com` |
| `BILLING_ENABLED` | Literal `true` enables configured existing-customer operations |
| `BILLING_LAUNCH_ENABLED` | Literal `true` enables new sales; leave unset until launch checks pass |
| `BILLING_MODE` | `live` (default), or `test` only on a non-production preview origin |
| `STRIPE_SECRET_KEY` | Matching mode's private `sk_` / `rk_` credential |
| `STRIPE_WEBHOOK_SECRET` | This endpoint's private `whsec_` signing secret |
| `STRIPE_ACCOUNT_ID` | Explicit verified owner merchant account ID |
| `STRIPE_PRODUCT_ID` | Dedicated DeadHangs Pro product |
| `STRIPE_MONTHLY_PRICE_ID` | GBP 499 minor units, recurring month, interval count 1 |
| `STRIPE_YEARLY_PRICE_ID` | GBP 3900 minor units, recurring year, interval count 1 |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated app-tagged configuration described below |

Auth endpoints additionally require their existing Google/auth secrets. None of
these values belongs in client JavaScript or committed environment files.
The account ID is checked with Stripe on provider operations. New live checkout
requires `charges_enabled`; existing customers can still cancel if the merchant
temporarily cannot accept new payments. Keys, prices, products, customers, subscriptions and payment
objects must match the configured mode. `test` is rejected on `deadhangs.com` and
`www.deadhangs.com`; stored mode prevents cached test entitlements crossing into
production even if a database is copied accidentally. Use a separate preview D1.

## Merchant setup draft (operator action, not executed)

DeadHangs is operated by ND Media Ltd and is not part of OwnedWork. Use a merchant
account verified as owned by ND Media Ltd, with DeadHangs-specific business name,
support details, receipts and statement descriptor. Do not present OwnedWork as the
seller or provider, reuse OwnedWork customers, products or credentials, or change
another application's account-wide defaults. Create the dedicated product named DeadHangs Pro with
`metadata.app=deadhangs`; create the two recurring GBP prices above with no trial,
coupon or other currency. Confirm tax treatment and exact customer-facing totals
against the published prices before opening sales. Do not use a client account.

Create a dedicated Billing Portal configuration with `metadata.app=deadhangs`,
DeadHangs business profile / legal URLs, invoice history and payment-method update,
subscription cancellation enabled in `at_period_end` mode, and subscription updates
disabled. The backend always supplies this configuration ID and checks those
cancellation/update settings; it never changes the shared default configuration.

Checkout creates only one fixed subscription item and accepts card payments.
Adaptive pricing and promotion codes are disabled. Per-session branding uses
`DeadHangs`, and custom text links `/terms/` and `/privacy/`, describes recurring
pricing and requires terms acceptance. Stripe also requires a valid account-level
Terms URL already present in Dashboard settings; the code does not alter it.
Inspect a real sandbox Checkout to verify the custom DeadHangs legal text replaces
the shared default, and that receipts, statement descriptor, support identity,
refund/cancellation terms and tax display are accurate for this merchant.

All customer, Checkout and subscription metadata uses `app=deadhangs` and
`deadhangs_user_ref=<random app reference>`. Never add `metadata.userId`:
if the merchant account also serves another application, that application's
webhook may consume that key (OwnedWork's does).

Create a dedicated snapshot webhook pointing to `/api/billing/webhook`, using
Stripe API version **2026-10-28.endive**, subscribed to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.voided
invoice.marked_uncollectible
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

Test the sandbox setup on an exact configured preview origin before live
activation. Test successful payment, failed payment, renewal, cancellation at
period end, full/partial refunds, replay/out-of-order webhook delivery, portal,
expired checkout and account deletion. The launch gate stays off until real
provider evidence and the merchant/legal/support checks are reviewed.

## State and recovery behaviour

Entitlements come from current provider state, not the success redirect or event
snapshot. A live paid active subscription with one approved price, a paid invoice
covering the current period and one successful card payment is required. No trial,
unpaid, paused, fully refunded or unresolved disputed payment grants Pro. A partial
goodwill refund retains the term; a won/closed dispute can restore verified access.
Cancellation at period end retains access to that paid term. Cached entitlement
reads expire locally and refresh at most five minutes after verification; status
always refreshes and webhook processing reconciles immediately. Provider errors
fail closed for paid writes and show an uncertain state to the user.

D1 customer uniqueness, fenced per-user leases and stable Stripe idempotency keys
serialize checkout and deletion. An unresolved customer/Checkout create older than
23 hours returns `billing_recovery_required`: Stripe only guarantees retaining
idempotency keys for 24 hours, so creating another chargeable object would be unsafe.
An operator must inspect that app reference and reconcile the original object;
never clear the marker and retry blindly. Foreign active subscriptions on a
dedicated customer refuse deletion rather than cancelling another application's
billing. Unsupported invoice structures or more than one active subscription
require review. Deletion can cancel every correctly owned duplicate subscription.

## Evidence and remaining validation

- `node --test tests/billing-core.test.mjs`: real Miniflare D1 state-machine,
  concurrency, signature, retry, ownership, refund and deletion tests.
- `node --test tests/billing-http.test.mjs`: actual Better Auth session cookies and
  billing adapters in workerd, including CSRF, account-switch guard, forbidden
  client fields, own-customer portal and session-refresh forwarding.
- Provider responses are fixtures. Real Stripe sandbox and live merchant/legal
  readiness remain pending. These local passes do not claim a working live payment.

Official API references checked:
[Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[invoice payments](https://docs.stripe.com/api/invoice-payment/list),
[subscription objects](https://docs.stripe.com/api/subscriptions/object),
[portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create),
[webhooks](https://docs.stripe.com/webhooks),
[API versioning](https://docs.stripe.com/api/versioning).
