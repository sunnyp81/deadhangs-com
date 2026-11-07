# Comparison-to-training activation release

7 November 2026. The age comparison and calculator previously left visitors to find a practical next step. This change places **Choose my next session** immediately after the result, opening three self-selected starting options from the existing level guide. A choice loads the timer for review, with supported assistance preselected where appropriate. The timer never starts automatically, and visitors record only holds they actually performed.

The existing dark training-tool design, condensed headings, mono numerals and cyan controls are retained. Result first, next action second, reference evidence third is the reading order. Comparison evidence remains qualified; no percentile, clinical claim or personal prescription has been added. A single measured hold does not automatically determine a suitable level.

## Behaviour and measurement

- Measurement handoffs use browser-only URL fragments; legacy query links remain compatible. Saving a measurement is separate from logging a training session.
- First training saves, first test saves and repeat training saves have distinct consented events. Failed writes and imports never count as activation. See [training-measurement.md](training-measurement.md) for definitions and limits.
- External acquisition referrers are restored as origins only. Campaign fields require fixed public allowlists; internal placement is sent as `tool_source`. No training values are transmitted.
- GA4 enhanced form/search/history measurement is disabled after network testing exposed a raw form-destination URL. Privacy is checked against actual gtag requests, not only the data layer.
- Consent choices have equal visual emphasis and larger mobile labels. The calculator's optional previous hold is collapsed, with units and target guidance beside the relevant input.
- Goal setup resolves today's date after hydration, fixing the existing mismatch between build date and later visits.

No checkout, paid programme, account requirement or email campaign is part of this release. Commercial planning, audience figures and supplier research remain in the private project directive.

## Validation record

- Production build: 60 pages. Automated regression suite: 200 passing before final review fixes; final count recorded in the release PR.
- Browser journeys cover comparison to starter to save, supported assistance, legacy and fragment handoffs, max tests, existing preset URLs, unavailable storage and future-date hydration.
- Rendered QA at 320, 390 and 1366 pixels covers form/error/result/choice/timer/save states. Automated accessibility checks supplement two independent screenshot critiques; neither substitutes for a real-device study.
- Actual gtag requests tested with organic, approved campaign and rejected campaign URLs. Test collection requests were intercepted so synthetic training did not enter live reports. No collection before consent; revocation stops collection.
- Existing `astro check` debt remains: 37 errors, zero warnings. No new errors were introduced by this change. This is not a claim that repository-wide type checking is clean.
- HTML validation has no errors; existing warnings concern 404/embed canonical or description metadata. Dependency audit has no high/critical findings; two moderate development-tool findings remain.

Deployment commit, final checks and live readback belong in the release PR. Analytics report population and commercial outcomes must be measured after release; local QA cannot establish them.
