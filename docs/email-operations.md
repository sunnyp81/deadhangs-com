# Email operations

Nothing sends while `EMAIL_CAPTURE_ENABLED` is absent or anything but `"true"`. It is not set in `wrangler.jsonc` for any environment.

## What the flag controls
- Build time (Cloudflare Pages build variable): the signup form under "Turn your baseline into a routine" on /dead-hang-time-by-age/ and the form shown after a save on /training-log/. Off: neither renders.
- Runtime (Pages Functions variable): the welcome email from `/api/subscribe`, the consent attributes on new contacts, and live drip sends. Off: signup still adds the contact to the list as today, and nothing is sent.

## Send gate (`src/server/email.mjs`, `sendReadiness`)
Every send is refused unless all of these hold: flag `"true"`; `BREVO_API_KEY`; `UNSUB_SECRET` (32+ characters, secret); `EMAIL_POSTAL_ADDRESS` set and not `POSTAL ADDRESS REQUIRED`; `EMAIL_SENDER` (authenticated sender address); `AUTH_BASE_URL` the https origin; `EMAIL_LIST_ID` valid (defaults to 3).
Each send then checks Brevo for `emailBlacklisted` immediately before sending (errors count as suppressed), and carries `List-Unsubscribe` (https and mailto), `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a footer with the unsubscribe link and the postal address.

## Unsubscribe
`/api/unsubscribe?e=<email>&t=<token>`; token is base64url HMAC-SHA256 of the lowercased address with `UNSUB_SECRET`. GET (footer link and the https List-Unsubscribe URI) verifies the token and shows a confirm page with one Unsubscribe button; it never calls Brevo, so link scanners and prefetchers cannot unsubscribe anyone. POST (the RFC 8058 one-click body `List-Unsubscribe=One-Click` from mail clients, or the confirm button) sets `emailBlacklisted: true` in Brevo. Bad or missing token: 403/400, nothing changed. Missing secret: 503, nothing changed. Suppression lives in Brevo only; there is no local store.

## Replies saying "stop" (manual process)
The mailto in `List-Unsubscribe` goes to `EMAIL_SENDER`. Check that inbox at least weekly while sending. For any "stop", "unsubscribe" or removal request: in Brevo, open the contact and set it to blacklisted (Contacts, the contact, Blocklist). For a deletion request, also clear every attribute except the email so the blocklist entry stays; reply within one month.

## Before the flag turns on (Sunny)
1. Set `UNSUB_SECRET` as a Pages secret (production and preview).
2. Authenticate the sender domain in Brevo (SPF, DKIM, DMARC) and set `EMAIL_SENDER`.
3. Set `EMAIL_POSTAL_ADDRESS` and add the same address to the privacy page.
4. Confirm `EMAIL_LIST_ID` (list 3 today) and its contact count.
5. Create Brevo contact attributes `CONSENT_SOURCE`, `CONSENT_AT` (text) and `CONSENT_WORDING` (text).
6. Approve the welcome copy in `welcomeEmail()`.
7. Test send to your own address: read the raw headers, run the one-click round trip, confirm a second send is skipped.
