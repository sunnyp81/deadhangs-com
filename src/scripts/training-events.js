const EVENTS = new Set([
  "training_tool_view",
  "training_goal_saved",
  "training_session_loaded",
  "training_timer_started",
  "training_timer_finished",
  "training_log_saved",
  "training_calculator_used",
  "training_calculator_continued",
  "feature_used",
]);
export const FEATURES = new Set([
  "your_number_compared",
  "your_number_log_link",
  "setup_saved_with_tags",
  "setup_best_use",
  "max_test_started",
  "max_test_saved",
  "preset_link_opened",
  "preset_copy_link",
  "haptics_enabled",
  "voice_enabled",
  "bar_card_print",
  "pwa_installed",
  "pwa_standalone_session",
  "backup_export",
  "csv_export",
  "backup_import",
  "ladder_link_click",
  "stop_rules_view",
  "header_timer_started",
  "demo_loop_played",
  "video_played",
]);
const SOURCES = new Set([
  "calculator",
  "plans",
  "workspace",
  "home",
  "shared",
  "embed",
  "article_header",
]);
const MODES = new Set(["simple", "emom", "ladder", "test"]);
const PATHS = new Set([
  "/",
  "/dead-hang-calculator/",
  "/training-log/",
  "/training-programs/",
]);

function canonicalPathname(candidate, browser) {
  const fallback = browser.location?.pathname;
  const value = typeof candidate === "string" ? candidate : fallback;
  if (typeof value !== "string") return null;
  const pathname = value.split(/[?#]/, 1)[0];
  return PATHS.has(pathname) ? pathname : null;
}

/**
 * Same-origin path only: no scheme, host, query or hash, and only characters that
 * appear in this site's own URLs. Used for feature_used so any page can report.
 */
export function sanitizePathname(candidate, browser = window) {
  const fallback = browser.location?.pathname;
  const value = typeof candidate === "string" ? candidate : fallback;
  if (typeof value !== "string") return null;
  const pathname = value.split(/[?#]/, 1)[0];
  if (pathname.length > 120) return null;
  if (!/^\/(?:[a-z0-9._~-]+\/?)*$/i.test(pathname)) return null;
  if (/(^|\/)\.+(\/|$)/.test(pathname)) return null;
  return pathname;
}

/** True when a setup form has any of the optional tags filled (assistance always has a default). */
export function setupHasTags(form) {
  if (!form || typeof form !== "object") return false;
  return ["bar", "grip", "chalk", "load"].some(
    (key) => typeof form[key] === "string" && form[key].trim() !== "",
  );
}

/** Count one real use of a feature. Sends the feature name and page path only. */
export function trackFeature(feature, { source, mode, pathname } = {}, browser = window) {
  return trackTrainingEvent("feature_used", { feature, source, mode, pathname }, browser);
}

/** Mark an eligible hydrated page once, without replaying a pre-consent view. */
export function trackTrainingToolView({ source, pathname } = {}, browser = window) {
  try {
    const pagePath = canonicalPathname(pathname, browser);
    if (!pagePath || !SOURCES.has(source)) return false;
    const key = `${source}:${pagePath}`;
    const views = (browser.__dhTrainingToolViews ||= new Set());
    if (views.has(key)) return false;
    views.add(key);
    return trackTrainingEvent(
      "training_tool_view",
      { source, pathname: pagePath },
      browser,
    );
  } catch {
    return false;
  }
}

/** Send only fixed, consented training-tool events. Personal training data is never accepted. */
export function trackTrainingEvent(
  event,
  { source, mode, pathname, feature } = {},
  browser = window,
) {
  try {
    const isFeature = event === "feature_used";
    if (
      !EVENTS.has(event) ||
      (isFeature ? !FEATURES.has(feature) : !SOURCES.has(source)) ||
      (source !== undefined && !SOURCES.has(source)) ||
      browser.localStorage.getItem("cookieConsent") !== "accepted" ||
      typeof browser.gtag !== "function"
    )
      return false;
    const page_path = isFeature
      ? sanitizePathname(pathname, browser)
      : canonicalPathname(pathname, browser);
    if (!page_path || (mode && !MODES.has(mode))) return false;
    const payload = { page_path };
    if (isFeature) payload.feature = feature;
    if (source) payload.source = source;
    if (mode) payload.timer_mode = mode;
    browser.gtag("event", event, payload);
    return true;
  } catch {
    return false;
  }
}
