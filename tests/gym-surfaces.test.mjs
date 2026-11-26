import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { safeBack, signInBody } from "../src/lib/account-client.mjs";
import {
  campaignIdFrom, correctionInput, effectiveSeconds, enquiryBody, formatDay, gymErrorMessage, gymShouldRefetch, inviteTokenFrom, joinPath, joinUrl, parseSeconds, rankBoard, resultDateBounds, ruleLines, validateJoin,
} from "../src/lib/gym-client.mjs";
import { trackTrainingEvent } from "../src/scripts/training-events.js";

const hasDist = existsSync(new URL("../dist/gym/campaign/index.html", import.meta.url));
const hasOffer = existsSync(new URL("../dist/gym-challenge/index.html", import.meta.url));
const dist = (p) => readFileSync(new URL(`../dist/${p}`, import.meta.url), "utf8");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sitemaps = () => readdirSync(new URL("../dist/", import.meta.url)).filter((x) => /^sitemap-.*\.xml$/.test(x));
const TOKEN = "A".repeat(43);
const ID = "abcDEF12_-xyz789";

test("sign-in return allowlist accepts the two gym shapes", () => {
  assert.equal(safeBack(`/gym/join/?t=${TOKEN}`), `/gym/join/?t=${TOKEN}`);
  assert.equal(safeBack(`/gym/join/?t=${"a-_Z9".repeat(8)}abc`), `/gym/join/?t=${"a-_Z9".repeat(8)}abc`);
  assert.equal(safeBack(`/gym/campaign/?id=${ID}`), `/gym/campaign/?id=${ID}`);
  assert.equal(safeBack(`/gym/campaign/?id=${"a".repeat(8)}`), `/gym/campaign/?id=${"a".repeat(8)}`);
  assert.equal(safeBack(`/gym/campaign/?id=${"a".repeat(64)}`), `/gym/campaign/?id=${"a".repeat(64)}`);
  assert.deepEqual(signInBody(false, `/gym/join/?t=${TOKEN}`), { provider: "google", callbackURL: `/gym/join/?t=${TOKEN}`, errorCallbackURL: `/gym/join/?t=${TOKEN}` });
});

test("sign-in return allowlist rejects anything else", () => {
  const bad = [
    "/gym/join/", "/gym/join/?t=", `/gym/join/?t=${"A".repeat(42)}`, `/gym/join/?t=${"A".repeat(44)}`, `/gym/join/?t=${"A".repeat(42)}!`, `/gym/join/?t=${"A".repeat(42)}.`,
    `/gym/join/?id=${TOKEN}`, `/gym/join/?t=${TOKEN}&x=1`, `/gym/join/?t=${TOKEN}&t=${TOKEN}`, `/gym/join/?t=${TOKEN}#x`, `/gym/join/?t=${TOKEN}?x=1`, `/gym/join?t=${TOKEN}`,
    `/gym/campaign/?id=${"a".repeat(7)}`, `/gym/campaign/?id=${"a".repeat(65)}`, "/gym/campaign/", `/gym/campaign/?t=${ID}`, `/gym/campaign/?id=${ID}&buy=1`, `/gym/campaign/?id=a%2Fb12345`, `/gym/campaign/?id=${ID}/../x`,
    `https://evil.example/gym/join/?t=${TOKEN}`, `//evil.example/gym/join/?t=${TOKEN}`, `/gym/other/?t=${TOKEN}`, `/gym/?t=${TOKEN}`, `/gym-challenge/`, `/account/?x=1`, "/programme/app/?id=" + ID, "constructor", "__proto__", "", null, undefined, 5,
  ];
  for (const value of bad) assert.equal(safeBack(value), null, String(value));
  assert.equal(signInBody(false, `/gym/join/?t=${TOKEN}&x=1`).callbackURL, "/account/");
  // Existing destinations are unchanged.
  assert.equal(safeBack("/programme/app/?buy=1"), "/programme/app/?buy=1");
  assert.equal(safeBack("/pro/"), "/pro/");
  assert.equal(safeBack("/pro/?buy=1"), null);
});

test("invite token and campaign id are read only in their exact shapes", () => {
  assert.equal(inviteTokenFrom(`?t=${TOKEN}`), TOKEN);
  assert.equal(inviteTokenFrom("?t=short"), null);
  assert.equal(inviteTokenFrom(`?t=${TOKEN}&t=${TOKEN}`), null);
  assert.equal(inviteTokenFrom(""), null);
  assert.equal(campaignIdFrom(`?id=${ID}`), ID);
  assert.equal(campaignIdFrom("?id=short"), null);
  assert.equal(campaignIdFrom(`?id=${"a".repeat(65)}`), null);
  assert.equal(joinPath(TOKEN), `/gym/join/?t=${TOKEN}`);
  assert.equal(joinUrl("https://deadhangs.com", TOKEN), `https://deadhangs.com/gym/join/?t=${TOKEN}`);
});

test("seconds, dates and the result window", () => {
  assert.equal(parseSeconds("45"), 45);
  assert.equal(parseSeconds(" 3600 "), 3600);
  for (const bad of ["0", "3601", "-1", "4.5", "abc", "", "12345", null]) assert.equal(parseSeconds(bad), null, String(bad));
  const c = { startsOn: "2026-12-01", endsOn: "2026-12-31" };
  assert.deepEqual(resultDateBounds(c, "2026-12-10"), { min: "2026-12-01", max: "2026-12-10", value: "2026-12-10", open: true });
  assert.deepEqual(resultDateBounds(c, "2027-01-05"), { min: "2026-12-01", max: "2026-12-31", value: "2026-12-31", open: true });
  assert.equal(resultDateBounds(c, "2026-11-20").open, false);
  assert.equal(formatDay("2026-12-03"), "3 Dec 2026");
});

test("rule lines, board ranks and corrected times", () => {
  const { lines, note } = ruleLines({ bar: "Pull-up bar", grip: "Overhand", chalk: "Allowed", assistance: "unassisted", note: " Chin above bar not needed. " });
  assert.deepEqual(lines.map((l) => l.label), ["Bar", "Grip", "Chalk", "Assistance"]);
  assert.equal(note, "Chin above bar not needed.");
  assert.equal(ruleLines({}).lines.at(-1).value, "unassisted");
  const ranked = rankBoard([{ display_name: "A", best: 60, entries: 2 }, { display_name: "B", best: 60, entries: 1 }, { display_name: "C", best: 40, entries: 3 }]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3]);
  assert.deepEqual(rankBoard(null), []);
  assert.equal(effectiveSeconds({ seconds: 30, corrected_seconds: 25 }), 25);
  assert.equal(effectiveSeconds({ seconds: 30, corrected_seconds: null }), 30);
});

test("join and enquiry validation send only what the server accepts", () => {
  assert.equal(validateJoin({ displayName: "", shareConsent: true }).error, "Enter a display name.");
  assert.match(validateJoin({ displayName: "x".repeat(41), shareConsent: true }).error, /40/);
  assert.match(validateJoin({ displayName: "A <b>", shareConsent: true }).error, /<|>/);
  assert.match(validateJoin({ displayName: "Sam", shareConsent: false }).error, /share your results/);
  assert.deepEqual(validateJoin({ displayName: "  Sam   P ", shareConsent: true }), { error: null, name: "Sam P" });
  const ok = enquiryBody({ gymName: " Test Gym ", contactName: "A", email: "A@B.CO", location: "", members: "", message: "", consent: true, website: "" });
  assert.deepEqual(ok, { error: null, body: { gymName: "Test Gym", contactName: "A", email: "a@b.co", consent: true, website: "" } });
  assert.deepEqual(Object.keys(enquiryBody({ gymName: "G", contactName: "A", email: "a@b.co", location: "L", members: "50", message: "Hi", consent: true, website: "" }).body).sort(),
    ["consent", "contactName", "email", "gymName", "location", "members", "message", "website"]);
  assert.match(enquiryBody({ gymName: "G", contactName: "A", email: "nope", consent: true }).error, /valid email/);
  assert.match(enquiryBody({ gymName: "G", contactName: "A", email: "a@b.co", consent: false }).error, /Tick the box/);
  assert.match(enquiryBody({ gymName: "", contactName: "A", email: "a@b.co", consent: true }).error, /gym name/);
  assert.match(enquiryBody({ gymName: "G", contactName: "A", email: "a@b.co", message: "x".repeat(1001), consent: true }).error, /too long/);
  assert.deepEqual(correctionInput("30", " typo "), { error: null, seconds: 30, note: "typo" });
  assert.ok(correctionInput("30", "").error);
  assert.ok(correctionInput("0", "x").error);
});

test("error messages are plain, 503 never leaks a code and the invite sentence is exact", () => {
  assert.equal(gymErrorMessage({ code: "invite_invalid", status: 404 }), "This invite has expired, was revoked or has been used.");
  assert.match(gymErrorMessage({ code: "campaign_closed" }), /closed/);
  assert.match(gymErrorMessage({ code: "removed" }), /removed/);
  assert.match(gymErrorMessage({ status: 503, code: "gym_unavailable" }), /not available right now\. Nothing was changed/);
  assert.match(gymErrorMessage({ code: "new_unknown_code" }), /Nothing was changed/);
  assert.equal(gymShouldRefetch({ code: "campaign_closed" }), true);
  assert.equal(gymShouldRefetch({ code: "invalid_seconds" }), false);
});

test("gym_pilot_requested is consent-gated and carries no fields", () => {
  const sent = [];
  const browser = (consent) => ({ localStorage: { getItem: () => consent }, location: { pathname: "/gym-challenge/" }, gtag: (...a) => sent.push(a) });
  assert.equal(trackTrainingEvent("gym_pilot_requested", { source: "gym_page" }, browser("accepted")), true);
  assert.deepEqual(sent.at(-1), ["event", "gym_pilot_requested", { page_path: "/gym-challenge/", tool_source: "gym_page" }]);
  assert.equal(trackTrainingEvent("gym_pilot_requested", { source: "gym_page" }, browser(null)), false);
  const n = sent.length;
  trackTrainingEvent("gym_pilot_requested", { source: "gym_page", email: "a@b.c", gym: "X" }, browser("accepted"));
  assert.deepEqual(sent[n][2], { page_path: "/gym-challenge/", tool_source: "gym_page" });
  const outsider = { localStorage: { getItem: () => "accepted" }, location: { pathname: "/gym/campaign/" }, gtag: () => assert.fail("must not send") };
  assert.equal(trackTrainingEvent("gym_pilot_requested", { source: "gym_page" }, outsider), false);
});

test("components keep campaign data out of storage and analytics", () => {
  for (const f of ["src/components/GymJoin.tsx", "src/components/GymCampaign.tsx"]) {
    assert.doesNotMatch(read(f), /localStorage|sessionStorage|indexedDB|trackTrainingEvent|trackFeature|gtag|dataLayer/, f);
  }
  const enquiry = read("src/components/GymEnquiry.tsx");
  assert.doesNotMatch(enquiry, /gtag|dataLayer|localStorage|sessionStorage/);
  assert.ok(enquiry.indexOf('trackTrainingEvent("gym_pilot_requested"') > enquiry.indexOf("data.saved === true"));
  for (const f of ["src/components/GymCampaign.tsx", "src/components/GymJoin.tsx", "src/components/GymEnquiry.tsx"]) {
    assert.doesNotMatch(read(f), /\b(?:window\.)?(?:alert|confirm|prompt)\(/, `${f} browser dialog`);
  }
});

test("no dash punctuation, emoji or placeholders in the new visible copy", () => {
  for (const f of ["src/components/GymJoin.tsx", "src/components/GymCampaign.tsx", "src/components/GymEnquiry.tsx", "src/pages/gym-challenge/index.astro", "src/pages/gym/join/index.astro", "src/pages/gym/campaign/index.astro", "src/lib/gym-client.mjs"]) {
    const t = read(f);
    assert.doesNotMatch(t, /[–—]/, `${f} dash`);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, `${f} emoji`);
    assert.doesNotMatch(t, /OWNER TO CONFIRM|lorem/i, f);
  }
});

test("shared config keeps the gym pages out of the sitemap, uncached and out of the service worker", () => {
  assert.match(read("astro.config.mjs"), /'\/gym-challenge\/'/);
  assert.match(read("astro.config.mjs"), /'\/gym\/'/);
  const headers = read("public/_headers");
  assert.match(headers, /\/gym\/\*\n\s+Cache-Control: no-store\n\s+Referrer-Policy: no-referrer\n\s+X-Robots-Tag: noindex/);
  assert.match(headers, /\/gym-challenge\/\*\n\s+X-Robots-Tag: noindex/);
  assert.match(read("scripts/sw-template.js"), /programme\\\/app\|gym\)/);
  assert.match(read("src/layouts/Article.astro"), /programme\\\/app\|gym\)/);
});

test("private gym pages are noindex, have no analytics tag and stay out of the sitemap", { skip: !hasDist }, () => {
  for (const page of ["gym/campaign/index.html", "gym/join/index.html"]) {
    const html = dist(page);
    assert.match(html, /<meta name="robots" content="noindex, follow">/, page);
    for (const bad of ["googletagmanager", "G-YBPRQVR2Y3", "__gaLoad", "gtag("]) assert.ok(!html.includes(bad), `${page} ${bad}`);
  }
  for (const f of sitemaps()) assert.doesNotMatch(dist(f), /\/gym(-challenge)?\//, f);
});

test("gym campaign page shell carries no campaign data", { skip: !hasDist }, () => {
  const html = dist("gym/campaign/index.html");
  assert.doesNotMatch(html, /[–—]/);
  assert.match(html, /Your gym challenge\./);
});

test("offer page: noindex, price line and form when the pilot flag was on at build", { skip: !hasOffer }, () => {
  const html = dist("gym-challenge/index.html");
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  if (/gym-form-title|A dead hang challenge for your gym/.test(html)) {
    assert.match(html, /£99<\/span> per campaign, founding price, invoiced, no subscription/);
    assert.match(html, /Contact me about a gym challenge pilot\. Nothing else\./);
    assert.match(html, /<input id="gym-consent" type="checkbox"/);
    assert.match(html, /Self-reported/i);
    assert.doesNotMatch(html, /[–—]/);
  } else {
    assert.match(html, /The gym challenge is not open yet\./);
    assert.doesNotMatch(html, /gym-consent|gym-email|<form/);
    assert.doesNotMatch(html, /£99/);
  }
});
