# Training-tool measurement

Updated 10 November 2026. Analytics run only after consent. Events use fixed `page_path`, `tool_source`, and where applicable `timer_mode`, `feature` or `session_choice`. No hold times, ages, assistance, goals, dates, entry IDs, email addresses or full URLs are accepted by the event helper. Internal callers still use `source`; the transmitted parameter is `tool_source` so it cannot collide with acquisition source.

## Events and interpretation

| Event | Meaning |
|---|---|
| `training_tool_view` | Eligible hydrated tool view. A pre-consent view is not replayed. |
| `training_calculator_used` / `training_calculator_continued` | Valid calculation / action opening goal setup. |
| `next_session_chosen` | Click on a fixed starter choice (`level_1`, `level_2`, `level_3`). Navigation may interrupt delivery. |
| `training_session_loaded` | Timer accepted settings; `tool_source=chosen_session` identifies an accepted starter arrival. Nothing auto-starts. |
| `training_timer_started` / `training_timer_finished` | Timer action / completion, not proof of exercise or a log save. |
| `training_goal_saved` | Goal settings saved. |
| `training_log_saved` | Any successful manual log save, including a measured/test hold. Historical broad activity metric. |
| `training_session_saved` | Successful manual save of a non-test training entry. Use for repeat training activity. |
| `first_training_session_saved` | First successful non-test save in the current local log history. Activation key event with no monetary value. |
| `first_test_hold_saved` | First successful test-kind save in the current local log history, including a comparison measurement or max test. Never training activation. |
| `feature_used` | One fixed named feature action; see the helper's allowlist. |

### Pro and sign-up events (10 November 2026)

All are `feature_used` rows with a fixed `feature` name and a fixed `tool_source` placement label. No new parameters and no values.

| `feature` | Fires when | `tool_source` |
|---|---|---|
| `pro_link_click` | Primary click on any same-origin link to `/pro/` | The link's `data-dh-source` if allowlisted (`nav`, `footer`, `log_header`, `post_save`, `progress`, `your_number`, `calculator_result`), else `article` |
| `account_link_click` | Primary click on any same-origin link to `/account/` | As above |
| `pro_signin_click` | "Continue with Google" on `/pro/` only | `pro_page` |
| `pro_plan_monthly_click` / `pro_plan_yearly_click` | Plan button on `/pro/` only | `pro_page` |
| `pro_nudge_dismissed` | "Not now" on an inline Pro line in the /training-log/ workspace; the dismissal is stored in this browser (`dh-pro-nudge`) and hides every line for good | `post_save` (under the save status, after a save that leaves 2 or more entries) or `progress` (under Comparable progress, 3 or more entries) |
| `email_signup_success` | SignupForm reports a new registration (not an address already on file) | `home` or `article` |

`/pro/` loads the same consent-gated Google Analytics as public pages. `/account/` loads none, so the shared account component's calls are no-ops there. Link clicks are sent as the page unloads; GA4 sends them as a keepalive request before the page unloads (seen in 15 of 15 preview runs), but some may still be lost.

First-save classification runs against stored entries and fires only after a successful write. Imports, deletion, failed writes, timer completion, pause and resume do not fire save events. Deleting all entries of a kind, clearing storage, using another browser/device, or importing a different history can change first-save eligibility. These are browser-log milestones, not lifetime unique people. A save without analytics consent is not replayed after consent.

## Reporting definitions

- **Starter arrival:** consent-observed users with `training_session_loaded` and `tool_source=chosen_session`. Prefer this to the click event as evidence that the timer accepted the choice.
- **Activation:** consent-observed users with an eligible tool interaction or starter arrival followed by `first_training_session_saved` in an ordered same-session exploration. Divide by users entering that same defined funnel. Aggregate user counts across unrelated events are not an ordered conversion rate.
- **Seven/28-day return:** first-training-save cohort members with a later `training_session_saved` on another GA4 reporting date within the window. Include only cohorts with the full observation window. Do not use `training_log_saved`, which includes test holds.
- **Revenue:** actual payment-provider transactions, reconciled for refunds and fees. Activation has no currency value and is not a sale.
- **Funnel A (GA4, ordered, same session):** `page_view` on a top page, `training_tool_view`, `first_training_session_saved` or `training_log_saved`, `feature_used` with `feature=pro_link_click`, `page_view` of `/pro/`, `feature_used` with `feature=pro_plan_monthly_click` or `pro_plan_yearly_click`. Consent-limited; a Pro visit that starts on `/pro/` from search or a bookmark skips the earlier steps.
- **Funnel B (D1 counts, `scripts/funnel-readout.mjs`):** accounts created, accounts whose latest checkout start falls in the window, paid (eligible active subscriptions by plan), cancelled at period end. `billing_accounts.checkout_started_at` is overwritten by each new checkout, so it counts accounts, not checkout attempts. Read-only aggregate counts; never emails, names or IDs.
- **Joining A and B:** by counts and dates only, never by user. GA4 has no account identifier and D1 has no analytics identifier.

Read and record the property's reporting timezone when constructing cohort reports. The browser's entry date is not sent to GA4 or used to backdate events. Consent gaps, blocked analytics, storage changes and multiple devices limit interpretation; no retention rate is inferred from this release.

## Attribution and privacy controls

`page_location` is the canonical path without query or fragment. External `page_referrer` is reduced to its HTTP(S) origin; internal referrers are blank. Campaign source, medium and optional name must all match fixed public allowlists in `Analytics.astro`; duplicate or unknown labels discard the campaign set. Other campaign parameters and click IDs are not forwarded by the site.

New measured-hold links use `/training-log/#hold=N`; fragments do not reach the HTTP server. Old `?hold=N` links remain readable for compatibility. Both save as test-kind entries unless the visitor explicitly chooses a training entry.

On 7 November, GA4 enhanced form interactions, site search and history-change page views were disabled on the stream. Real gtag testing showed enhanced `form_start` could otherwise send the raw current URL as `form_destination`. Explicit clean form actions provide additional protection. Keep those stream settings disabled unless an equivalent request-level privacy check passes. Other enhanced-measurement settings are unchanged.

If consent begins after leaving the landing page, the original acquisition source may be unavailable: the site does not store attribution before consent. This release affects future collection only.
