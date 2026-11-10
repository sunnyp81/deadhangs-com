import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  sanitizePathname,
  setupHasTags,
  trackFeature,
  trackTrainingEvent,
} from "../src/scripts/training-events.js";
import { isLadderLink, proAccountLink } from "../src/scripts/feature-tracking.js";
import { readFileSync } from "node:fs";

const browser = (over = {}) => {
  const calls = [];
  return {
    calls,
    localStorage: { getItem: () => "accepted" },
    location: { pathname: "/dead-hang-time-by-age/", origin: "https://deadhangs.com", href: "https://deadhangs.com/x/" },
    gtag: (...x) => calls.push(x),
    ...over,
  };
};

test("the feature allowlist is exactly the agreed 28 names", () => {
  assert.deepEqual([...FEATURES].sort(), [
    "backup_export", "backup_import", "bar_card_print", "csv_export", "demo_loop_played",
    "haptics_enabled", "header_timer_started", "ladder_link_click", "max_test_saved",
    "max_test_started", "preset_copy_link", "preset_link_opened", "pwa_installed",
    "pwa_standalone_session", "setup_best_use", "setup_saved_with_tags", "stop_rules_view",
    "video_played", "voice_enabled", "your_number_compared", "your_number_log_link",
    "pro_link_click", "account_link_click", "pro_signin_click", "pro_plan_monthly_click",
    "pro_plan_yearly_click", "pro_nudge_dismissed", "email_signup_success",
  ].sort());
});

test("every allowed feature sends only feature and page path", () => {
  for (const feature of FEATURES) {
    const b = browser();
    assert.equal(trackFeature(feature, {}, b), true, feature);
    assert.deepEqual(b.calls, [["event", "feature_used", { page_path: "/dead-hang-time-by-age/", feature }]]);
  }
});

test("source article_header and mode are accepted, other values are not", () => {
  const b = browser();
  assert.equal(trackFeature("header_timer_started", { source: "article_header", mode: "simple" }, b), true);
  assert.deepEqual(b.calls[0][2], {
    page_path: "/dead-hang-time-by-age/", feature: "header_timer_started", tool_source: "article_header", timer_mode: "simple",
  });
  assert.equal(trackFeature("header_timer_started", { source: "made_up" }, browser()), false);
  assert.equal(trackFeature("header_timer_started", { mode: "turbo" }, browser()), false);
});

test("unknown or missing features are dropped, and non-feature events still need a source", () => {
  for (const f of ["hold_time", "", undefined, null, "__proto__", "VOICE_ENABLED"]) {
    const b = browser();
    assert.equal(trackFeature(f, {}, b), false);
    assert.equal(b.calls.length, 0);
  }
  assert.equal(trackTrainingEvent("training_log_saved", {}, browser()), false);
});

test("consent is required", () => {
  for (const consent of [null, "declined"]) {
    const b = browser({ localStorage: { getItem: () => consent } });
    assert.equal(trackFeature("voice_enabled", {}, b), false);
    assert.equal(b.calls.length, 0);
  }
  assert.equal(trackFeature("voice_enabled", {}, browser({ gtag: undefined })), false);
  assert.equal(trackFeature("voice_enabled", {}, browser({ localStorage: { getItem() { throw new Error("blocked"); } } })), false);
});

test("extra user-entered values never reach the payload", () => {
  const b = browser();
  trackFeature("your_number_compared", { hold: 95, age: 41, seconds: 95, pathname: "/bar-card/?age=41" }, b);
  assert.deepEqual(b.calls[0][2], { page_path: "/bar-card/", feature: "your_number_compared" });
});

test("pathname is sanitised to a same-origin path with no query or hash", () => {
  assert.equal(sanitizePathname("/beginner-deadhang/?hold=95#cant-hang-yet", {}), "/beginner-deadhang/");
  assert.equal(sanitizePathname("/deadhang-safety/#stop-and-step-down", {}), "/deadhang-safety/");
  assert.equal(sanitizePathname("/", {}), "/");
  for (const bad of ["https://evil.test/x/", "//evil.test/x/", "javascript:alert(1)", "/a b/", "/../etc/", "/./", "/x/<script>/", "x/y", "/" + "a".repeat(130)])
    assert.equal(sanitizePathname(bad, { location: {} }), null, bad);
  assert.equal(sanitizePathname(undefined, { location: { pathname: "/how-to-deadhang/?q=1" } }), "/how-to-deadhang/");
  assert.equal(sanitizePathname(undefined, {}), null);
});

test("the new article pages are accepted", () => {
  for (const path of ["/dead-hang-time-by-age/", "/deadhang-guide/", "/beginner-deadhang/", "/deadhang-safety/", "/bar-card/", "/how-to-deadhang/", "/deadhang-progressions/"]) {
    const b = browser({ location: { pathname: path } });
    assert.equal(trackFeature("stop_rules_view", {}, b), true, path);
    assert.equal(b.calls[0][2].page_path, path);
  }
});

test("setupHasTags ignores the default assistance and blanks", () => {
  assert.equal(setupHasTags({ assistance: "none", bar: "", grip: "", chalk: "", load: "", loadUnit: "kg" }), false);
  assert.equal(setupHasTags({ bar: " ", grip: "", chalk: "", load: "" }), false);
  assert.equal(setupHasTags({ bar: "", grip: "", chalk: "yes", load: "" }), true);
  assert.equal(setupHasTags({ load: "5" }), true);
  assert.equal(setupHasTags(null), false);
});

test("ladder link detection matches only the same-origin starting ladder anchor", () => {
  const b = browser();
  const a = (href) => ({ getAttribute: () => href });
  assert.equal(isLadderLink(a("/beginner-deadhang/#cant-hang-yet"), b), true);
  assert.equal(isLadderLink(a("https://deadhangs.com/beginner-deadhang/#cant-hang-yet"), b), true);
  assert.equal(isLadderLink(a("https://other.test/beginner-deadhang/#cant-hang-yet"), b), false);
  assert.equal(isLadderLink(a("/beginner-deadhang/"), b), false);
});

const link = (href, dhSource) => ({ getAttribute: () => href, dataset: dhSource === undefined ? {} : { dhSource } });

test("links to /pro/ and /account/ map to their feature with an allowlisted placement", () => {
  const b = browser();
  assert.deepEqual(proAccountLink(link("/pro/", "nav"), b), { feature: "pro_link_click", source: "nav" });
  assert.deepEqual(proAccountLink(link("/account/", "footer"), b), { feature: "account_link_click", source: "footer" });
  assert.deepEqual(proAccountLink(link("https://deadhangs.com/pro/?ref=x#plans", "post_save"), b), { feature: "pro_link_click", source: "post_save" });
  assert.deepEqual(proAccountLink(link("/account"), b), { feature: "account_link_click", source: "article" });
  assert.deepEqual(proAccountLink(link("/pro/", "made_up"), b), { feature: "pro_link_click", source: "article" });
  assert.deepEqual(proAccountLink(link("/pro/", "__proto__"), b), { feature: "pro_link_click", source: "article" });
  for (const href of ["https://other.test/pro/", "/pro/plans/", "/training-log/", "/account/delete/", "", "javascript:void(0)"])
    assert.equal(proAccountLink(link(href, "nav"), b), null, href);
});

test("every new placement label is sent as tool_source with the Pro features and nothing else", () => {
  for (const source of ["nav", "footer", "log_header", "post_save", "progress", "your_number", "calculator_result", "pro_page", "article", "home"]) {
    const b = browser();
    assert.equal(trackFeature("pro_link_click", { source, email: "a@b.test", href: "/pro/?x=1" }, b), true, source);
    assert.deepEqual(b.calls, [["event", "feature_used", { page_path: "/dead-hang-time-by-age/", feature: "pro_link_click", tool_source: source }]]);
  }
  assert.equal(trackFeature("email_signup_success", { source: "newsletter" }, browser()), false);
});

test("Pro and sign-up events stay consent-gated", () => {
  for (const feature of ["pro_link_click", "account_link_click", "pro_signin_click", "pro_plan_monthly_click", "pro_plan_yearly_click", "email_signup_success"]) {
    const b = browser({ localStorage: { getItem: () => null } });
    assert.equal(trackFeature(feature, { source: "nav" }, b), false, feature);
    assert.equal(trackFeature(feature, { source: "nav" }, browser({ gtag: undefined })), false, feature);
    assert.equal(b.calls.length, 0);
  }
});

test("nav and footer links carry their placement label", () => {
  assert.match(readFileSync(new URL("../src/components/Nav.astro", import.meta.url), "utf8"), /<a href=\{link\.href\} data-dh-source="nav"/);
  assert.match(readFileSync(new URL("../src/components/Footer.astro", import.meta.url), "utf8"), /<a href=\{l\.href\} data-dh-source="footer"/);
});

test("pricing events fire only on the pricing instance, and sign-up success skips existing addresses", () => {
  const account = readFileSync(new URL("../src/components/AccountWorkspace.tsx", import.meta.url), "utf8");
  assert.match(account, /if \(pricing\) trackFeature\(feature, \{ source: 'pro_page' \}\)/);
  for (const f of ["pro_signin_click", "pro_plan_monthly_click", "pro_plan_yearly_click"]) assert.ok(account.includes(`track('${f}')`), f);
  const signup = readFileSync(new URL("../src/components/SignupForm.tsx", import.meta.url), "utf8");
  assert.match(signup, /if \(!existingAddress\) trackFeature\('email_signup_success', \{ source \}\)/);
});
