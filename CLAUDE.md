# deadhangs-com — Project Brain

Per-repo brain, migrated from central claude-memory 2026-06-20. Canonical project memory now lives here.

## Current state

deadhangs.com — dead-hang fitness content + affiliate site. **Rebuilt May 9 2026 on Astro 5 + Tailwind 4** (cyan-accent manifesto design), replacing the older static HTML site. ~53 pages. Repo `sunnyp81/deadhangs-com`, local `C:\Users\sunny\repos\deadhangs-com`. Auto-deploys from git push to Cloudflare Pages (project `deadhangs-com` → `deadhangs-com-bew.pages.dev` → `deadhangs.com`). Revenue £0 (AdSense application pending; Amazon affiliate tag `deadhangs-21`).

Monetisation: Amazon affiliate (pull-up bars, chalk) + a Brevo free-tier 12-week drip email campaign + AdSense (not yet applied). Interactive tools: Dead Hang Calculator (age × gender × seconds → percentile) and HangTimer (Simple/EMOM/Ladder modes).

**Top traffic page:** `/dead-hang-time-by-age/` (was ~21.7k impr, pos 7). `/dead-hang-world-record/` is the other big one.

## Key facts & warnings

- 🔴 **Separate Cloudflare account** from main sunnypat81: CF account `fiedss47hh637@gmail.com`, account ID `d2373b6986cd74e0f99d4927b57e8d46`, project `deadhangs-com`. (Now auto-deploys from git push.) If a manual wrangler deploy ever breaks with an auth error, the sunnypat81 wrangler OAuth session overrides the env var — the old fix was correcting `.wrangler/cache/pages.json` account_id. CF API token + StaticForms accessKey + Brevo API key live in central memory / CF Pages secrets — pointers only, never copy.
- 🔴 **All fabricated authority signals were removed (May 9) — keep them gone.** No Berkeley CA, no "study N=2847", no "our cohort", no version numbers, no "Made in California". Every stat must cite a real paper: Leong/Lancet 2015 (grip strength + mortality), Bohannon 2019, Kirsch 2017, Peterson 2023. Dead-hang world record = **80 min 41 sec by Kenta Adachi (Japan), 18 Nov 2022** (verified GWR — an earlier version wrongly showed 16:03 Harald Riise).
- Brevo drip: account `hello@deadhangs.com`, contact list ID 3 ("Dead Hang Protocol"), 12 HTML templates (IDs 1-12) in Brevo. Drip logic in `functions/api/drip-cron.ts`; `deadhangs-drip` Worker cron 09:00 UTC daily calls it; `/api/subscribe` adds contacts. Template content also in `emails/drip-sequence.md` + `emails/drip-api.json`. Buttondown account exists but unused (automations need paid plan).
- No em/en dashes in content (global rule).
- New-page conventions (from May 10 audit): use `Article.astro` layout (auto-canonical, auto-BreadcrumbList, cookie banner in layout). Titles <60ch, no `| DeadHangs.com` suffix. FAQ = `<div class="faq">` + `<h3>` pattern, gets FAQPage schema. Org + WebSite + BreadcrumbList schema is in Base.astro/Article.astro.
- Legacy CSS-bug lessons (older HTML era, but still good practice): inline SVGs with no width/height default to 300×150px — always set explicit size. Article-level elements (`.author-box`, `.sources`) outside the inner container need their own `max-width:720px; margin:auto`.

## History

- 2026-03-23 — Older static HTML era: white editorial design ("Instrument Serif" + "Plus Jakarta Sans", teal #0d9488), StaticForms email capture mid-article. Deployed from a git repo on Drive; UX redesign (hamburger nav, hero, hub cards).
- 2026-04-01 — Big content + design overhaul (dark "Chalk & Iron" theme, brand #ea580c): 8 key pages rewritten with real UGC (StrongFirst, PURE/Lancet, Peterson 2023), CTR title rewrites, world-record fact correction (Kenta Adachi). Fixed CSS bugs (oversized SVG, page-header block, unstyled meta/author/sources).
- 2026-04-23 — Built Dead Hang Calculator + contact page (StaticForms), ads.txt placeholder, noindexed 4 thin community stubs.
- 2026-05-09 — Full rebuild on Astro 5 + Tailwind 4; Brevo drip system; all fabricated authority signals stripped.
- 2026-05-10 — Full SEO audit + fixes (53 pages, commits e7b9138/cdff1d7/1118640/1db12aa/1db...): global Org/WebSite/BreadcrumbList schema, canonicals + OG, @astrojs/sitemap, llms.txt/ai.txt, 49 titles shortened, FAQ/Article schema added, cookie banner moved to layout, cannibalization pairs differentiated, HangTimer 3-mode + ProtocolCalculator wired.

Open / next: fill ads.txt with AdSense publisher ID then apply; build 2-3 backlinks to `/dead-hang-time-by-age/` (pos 7 → 4-5 doubles CTR); homepage authority for "deadhangs" brand term.
