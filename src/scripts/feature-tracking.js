// Page-wide feature usage events, sent through the consented, allowlisted helper.
// Only the feature name and page path leave the browser.
import { trackFeature } from "./training-events.js";

const LADDER = "/beginner-deadhang/#cant-hang-yet";
const STOP_RULES_ID = "stop-and-step-down";

function seen(browser, key) {
  if ((browser.__dhFeatureOnce ||= new Set()).has(key)) return true;
  try {
    return Boolean(browser.sessionStorage.getItem(`dh-feature-${key}`));
  } catch {
    return false;
  }
}

function mark(browser, key, session) {
  browser.__dhFeatureOnce.add(key);
  if (!session) return;
  try {
    browser.sessionStorage.setItem(`dh-feature-${key}`, "1");
  } catch {}
}

// Count once, and only mark as counted when the event was really sent (consent given).
function trackOnce(browser, feature, session) {
  if (seen(browser, feature)) return false;
  const sent = trackFeature(feature, {}, browser);
  if (sent) mark(browser, feature, session);
  return sent;
}

export function isLadderLink(anchor, browser = window) {
  try {
    const url = new URL(anchor.getAttribute("href") || "", browser.location.href);
    return url.origin === browser.location.origin && url.pathname + url.hash === LADDER;
  } catch {
    return false;
  }
}

export function initFeatureTracking(browser = window) {
  const doc = browser.document;
  try {
    doc.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const anchor = event.target?.closest?.("a[href]");
      if (anchor && isLadderLink(anchor, browser)) trackFeature("ladder_link_click", {}, browser);
    });

    browser.addEventListener("appinstalled", () => trackFeature("pwa_installed", {}, browser));

    const standalone =
      browser.matchMedia?.("(display-mode: standalone)")?.matches ||
      browser.navigator?.standalone === true;
    if (standalone) trackOnce(browser, "pwa_standalone_session", true);

    const stop = doc.getElementById(STOP_RULES_ID);
    if (stop && "IntersectionObserver" in browser) {
      const observer = new browser.IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          trackOnce(browser, "stop_rules_view", false);
        },
        { threshold: 0.5 },
      );
      observer.observe(stop);
    }
  } catch {
    // Measurement must never interrupt the page.
  }
}
