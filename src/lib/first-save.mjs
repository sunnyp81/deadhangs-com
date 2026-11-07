/**
 * Decides whether a just-saved log entry is the first of its kind in this browser's
 * current log. "session" = a manual training entry; "max_test" = a max test or a
 * measured hold saved as a test. Returns null when an earlier entry of the same kind
 * already exists. Clearing or deleting every entry of that kind re-arms it.
 */
export function firstSaveKind(entriesBefore, savedKind) {
  const isTest = savedKind === "test";
  const list = Array.isArray(entriesBefore) ? entriesBefore : [];
  const seen = list.some((entry) => entry && typeof entry === "object" && (entry.kind === "test") === isTest);
  if (seen) return null;
  return isTest ? "max_test" : "session";
}

export const FIRST_SAVE_EVENTS = Object.freeze({
  session: "first_training_session_saved",
  max_test: "first_test_hold_saved",
});
