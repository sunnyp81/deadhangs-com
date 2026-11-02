import {
  SETUP_DEFAULT_KEY,
  STORAGE_KEY,
  appendToStoredLog,
  makeEntryId,
  parseSetupDefault,
  parseStoredLog,
  serializeSetupDefault,
  toLocalDateString,
  validateEntryInput,
} from "./training-log.mjs";

export type SetupForm = {
  assistance: string;
  bar: string;
  grip: string;
  chalk: string;
  load: string;
  loadUnit: string;
  ended: string;
  bodyweight?: string;
  bodyweightUnit?: string;
};

export const LOG_UPDATED_EVENT = "deadhangs:training-log-updated";

/** Last-used setup from this browser, or the blank default. Never throws. */
export function readRememberedSetup(): SetupForm {
  try {
    return parseSetupDefault(window.localStorage.getItem(SETUP_DEFAULT_KEY)) as SetupForm;
  } catch {
    return parseSetupDefault(null) as SetupForm;
  }
}

export function rememberSetup(form: SetupForm) {
  try {
    window.localStorage.setItem(SETUP_DEFAULT_KEY, serializeSetupDefault(form));
  } catch {
    /* remembering a default is a convenience; the entry itself is already saved */
  }
}

export type SaveResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Saves one new entry straight to the on-device log, used by the timer's max
 * test. It refuses rather than overwrite an unreadable or full log, and tells
 * other islands on the page (the log, the graph) to re-read.
 */
export function saveNewEntry(input: {
  seconds: string;
  sets?: string;
  kind?: "test";
  setup: SetupForm;
}): SaveResult {
  const today = toLocalDateString();
  const checked = validateEntryInput(
    { date: today, seconds: input.seconds, sets: input.sets ?? "1", kind: input.kind, ...input.setup },
    today,
  );
  if (!checked.ok || !checked.value) return { ok: false, message: checked.errors[0] ?? "Check the values and try again." };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, message: "This browser is blocking local storage, so nothing could be saved." };
  }
  const existing = parseStoredLog(raw, today);
  const entry = { id: makeEntryId(existing.entries), ...checked.value };
  const result = appendToStoredLog(raw, entry, today);
  if (!result.ok) {
    const message =
      result.reason === "corrupt"
        ? "Your saved log could not be read, so nothing was added. Open the training log page to recover it."
        : result.reason === "full"
          ? "Your log is full (200 entries). Export it from the training log page, then delete some entries."
          : "That entry could not be saved. Check the values.";
    return { ok: false, message };
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, result.text);
  } catch {
    return { ok: false, message: "Could not save to this browser's storage. It may be full or blocked." };
  }
  rememberSetup(input.setup);
  window.dispatchEvent(new Event(LOG_UPDATED_EVENT));
  return { ok: true };
}
