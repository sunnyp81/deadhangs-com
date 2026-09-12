export const JOURNEY_DRAFT_KEY = "dh.journey-draft.v1";
export const JOURNEY_DRAFT_MAX_BYTES = 2048;
export const JOURNEY_DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

function browserSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function usableStorage(storage) {
  return storage === undefined ? browserSessionStorage() : storage;
}

function isFiniteSeconds(value, minimum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= 3600;
}

export function validateDraft(value, now = Date.now()) {
  if (!value || typeof value !== "object")
    return { ok: false, error: "Calculator handoff could not be read." };
  if (
    value.version !== 1 ||
    !isFiniteSeconds(value.targetSeconds, 1) ||
    !isFiniteSeconds(value.holdSeconds, 0) ||
    !Number.isInteger(value.createdAtMs)
  )
    return { ok: false, error: "Calculator handoff is not valid." };
  if (value.createdAtMs > now)
    return { ok: false, error: "Calculator handoff has an invalid future date." };
  if (now - value.createdAtMs > JOURNEY_DRAFT_MAX_AGE_MS)
    return { ok: false, error: "Calculator handoff expired. Please review your target again." };
  return {
    ok: true,
    draft: {
      version: 1,
      targetSeconds: value.targetSeconds,
      holdSeconds: value.holdSeconds,
      createdAtMs: value.createdAtMs,
    },
  };
}

export function makeDraft({ targetSeconds, holdSeconds }, now = Date.now()) {
  const result = validateDraft(
    { version: 1, targetSeconds, holdSeconds, createdAtMs: now },
    now,
  );
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

export function parseDraft(text, now = Date.now()) {
  if (!text)
    return { ok: false, state: "empty", error: "No calculator handoff found." };
  if (typeof text !== "string")
    return { ok: false, state: "corrupt", error: "Calculator handoff could not be read." };
  if (new TextEncoder().encode(text).length > JOURNEY_DRAFT_MAX_BYTES)
    return { ok: false, state: "corrupt", error: "Calculator handoff is too large." };
  try {
    const result = validateDraft(JSON.parse(text), now);
    return result.ok
      ? { ...result, state: "ready" }
      : { ...result, state: "invalid" };
  } catch {
    return { ok: false, state: "corrupt", error: "Calculator handoff could not be read." };
  }
}

export function readDraft(storage, now = Date.now()) {
  try {
    const target = usableStorage(storage);
    if (!target)
      return {
        ok: false,
        state: "unavailable",
        error: "Calculator handoff could not be carried over because temporary browser storage is unavailable.",
      };
    return parseDraft(target.getItem(JOURNEY_DRAFT_KEY), now);
  } catch {
    return {
      ok: false,
      state: "unavailable",
      error: "Calculator handoff could not be carried over because temporary browser storage is unavailable.",
    };
  }
}

export function stageDraft(draft, storage) {
  try {
    const target = usableStorage(storage);
    if (!target) return false;
    const value = makeDraft(draft, draft.createdAtMs);
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > JOURNEY_DRAFT_MAX_BYTES) return false;
    target.setItem(JOURNEY_DRAFT_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage) {
  try {
    usableStorage(storage)?.removeItem(JOURNEY_DRAFT_KEY);
  } catch {}
}
