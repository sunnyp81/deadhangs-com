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

## Switching on
Written 15 Nov 2026 from the signup growth plan (`memory/site-directives/deadhangs.com/game-plan-2026-11-10/signup-growth-plan-2026-11-15.md`, section 4). The Brevo menu labels are as the plan records them and have not been checked against the live Brevo screens; confirm each label on the first run and note any change here.

Sender address proposed: `hello@deadhangs.com` (display name "DeadHangs"). Confirm it exists in Hostinger first: hPanel > Emails > deadhangs.com > Email accounts, or Forwarders. Postal address proposed for `EMAIL_POSTAL_ADDRESS`, from the Companies House register for ND Media Ltd, company 10784524, fetched 15 Nov 2026 from https://find-and-update.company-information.service.gov.uk/company/10784524 (registered office shown as "17 Gainsborough Road, Reading, England, RG30 3DB"). Sunny confirms this before it is set; the registered office is a valid address for the footer and privacy page.

### Option A (recommended): Sunny gives a Brevo API key
1. In Brevo, click your name (top right), then "SMTP & API".
2. Open the "API Keys" tab and choose "Generate a new API key".
3. Name it `claude-deadhangs-local`, click Generate, and copy the key.
4. Save it in `G:\My Drive\_SHARED\ai-memory\reference_deadhangs_credentials.md` (Drive-only, gitignored). Do not paste it into the repo, a PR, or chat.
5. Reply "key saved". Claude then creates the three contact attributes, reads the list 3 count, adds and authenticates the sending domain, and adds the sender.

### Option B: Sunny does it in Brevo
1. Contacts > Settings > Contact attributes > "Add a new attribute". Create `CONSENT_SOURCE`, `CONSENT_AT` and `CONSENT_WORDING`, each as type Text, so the ISO timestamp is accepted.
2. Contacts > Lists. Read the contact count on list ID 3 and send it to Claude.
3. Your name > "Senders, Domains & Dedicated IPs" > Domains > "Add a domain". Enter the sender's domain and choose "Authenticate this domain". Send Claude the records shown (two DKIM, one Brevo verification, one DMARC) so Claude adds them in Cloudflare DNS. Then click "Verify".
4. Senders tab > "Add a sender". Name it DeadHangs, use the address from the sender step, and save. Open the verification email in that mailbox and click the link.
