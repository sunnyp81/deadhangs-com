// Inline Pro lines in the free log. One browser-wide dismissal hides every line for good.
export const PRO_NUDGE_KEY = 'dh-pro-nudge';
export const PRO_NUDGE_DISMISSED_EVENT = 'deadhangs:pro-nudge-dismissed';
export const SAVE_NUDGE_MIN_ENTRIES = 2;
export const PROGRESS_NUDGE_MIN_ENTRIES = 3;

/** True when the visitor said "Not now", or storage cannot be read (fail quiet: no nudge). */
export function nudgeDismissed(storage) {
  try { return storage.getItem(PRO_NUDGE_KEY) === 'dismissed'; } catch { return true; }
}

/** Remembers the dismissal. Returns false if storage is blocked; the line still hides for this page view. */
export function dismissNudge(storage) {
  try { storage.setItem(PRO_NUDGE_KEY, 'dismissed'); return true; } catch { return false; }
}

/** The post-save line appears only after a save that leaves two or more entries in the log. */
export const showSaveNudge = (entryCount) => Number.isInteger(entryCount) && entryCount >= SAVE_NUDGE_MIN_ENTRIES;
export const showProgressNudge = (entryCount) => Number.isInteger(entryCount) && entryCount >= PROGRESS_NUDGE_MIN_ENTRIES;
