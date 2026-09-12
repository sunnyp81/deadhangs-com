const EVENTS = new Set([
  "training_tool_view",
  "training_goal_saved",
  "training_session_loaded",
  "training_timer_started",
  "training_timer_finished",
  "training_log_saved",
]);
const SOURCES = new Set([
  "calculator",
  "plans",
  "workspace",
  "home",
  "shared",
  "embed",
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
  { source, mode, pathname } = {},
  browser = window,
) {
  try {
    if (
      !EVENTS.has(event) ||
      !SOURCES.has(source) ||
      browser.localStorage.getItem("cookieConsent") !== "accepted" ||
      typeof browser.gtag !== "function"
    )
      return false;
    const page_path = canonicalPathname(pathname, browser);
    if (!page_path || (mode && !MODES.has(mode))) return false;
    const payload = { page_path, source };
    if (mode) payload.timer_mode = mode;
    browser.gtag("event", event, payload);
    return true;
  } catch {
    return false;
  }
}
