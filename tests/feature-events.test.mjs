import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  sanitizePathname,
  setupHasTags,
  trackFeature,
  trackTrainingEvent,
} from "../src/scripts/training-events.js";
import { isLadderLink } from "../src/scripts/feature-tracking.js";

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

test("the feature allowlist is exactly the agreed 21 names", () => {
  assert.deepEqual([...FEATURES].sort(), [
    "backup_export", "backup_import", "bar_card_print", "csv_export", "demo_loop_played",
    "haptics_enabled", "header_timer_started", "ladder_link_click", "max_test_saved",
    "max_test_started", "preset_copy_link", "preset_link_opened", "pwa_installed",
    "pwa_standalone_session", "setup_best_use", "setup_saved_with_tags", "stop_rules_view",
    "video_played", "voice_enabled", "your_number_compared", "your_number_log_link",
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
    page_path: "/dead-hang-time-by-age/", feature: "header_timer_started", source: "article_header", timer_mode: "simple",
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
