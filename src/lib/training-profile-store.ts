import {
  PROFILE_KEY,
  parseProfile,
  serializeProfile,
} from "./training-profile.mjs";
import type { TrainingProfile } from "./training-types";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProfileSnapshot = {
  raw: string | null;
  profile: TrainingProfile | null;
  state: string;
  error: string;
};
const browserStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const read = (storage: StorageLike): ProfileSnapshot => {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    const parsed = parseProfile(raw);
    return {
      raw,
      profile: parsed.ok ? (parsed.profile as TrainingProfile) : null,
      state: parsed.state || "corrupt",
      error: parsed.error || "",
    };
  } catch {
    return {
      raw: null,
      profile: null,
      state: "unavailable",
      error: "Browser storage is unavailable.",
    };
  }
};
export function readProfile(storage?: StorageLike | null) {
  const target = storage === undefined ? browserStorage() : storage;
  return target
    ? read(target)
    : {
        raw: null,
        profile: null,
        state: "unavailable",
        error: "Browser storage is unavailable.",
      };
}
export async function saveProfile(
  profile: TrainingProfile,
  expectedRaw: string | null,
  storage?: StorageLike | null,
  locks?: LockManager | null,
) {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target)
    return {
      ok: false,
      reason: "unavailable" as const,
      snapshot: readProfile(null),
    };
  const targetLocks =
    locks === undefined
      ? (() => {
          try {
            return navigator.locks;
          } catch {
            return null;
          }
        })()
      : locks;
  const write = async () => {
    const now = read(target);
    if (now.state === "unavailable")
      return { ok: false, reason: "unavailable" as const, snapshot: now };
    if (now.raw !== expectedRaw)
      return { ok: false, reason: "conflict" as const, snapshot: now };
    let raw: string;
    try {
      raw = serializeProfile(profile);
      target.setItem(PROFILE_KEY, raw);
    } catch {
      return { ok: false, reason: "unavailable" as const, snapshot: now };
    }
    const snapshot = read(target);
    return snapshot.raw === raw
      ? { ok: true, snapshot }
      : { ok: false, reason: "unavailable" as const, snapshot };
  };
  try {
    return targetLocks?.request
      ? await targetLocks.request("dh.training-profile.v1", write)
      : await write();
  } catch {
    return {
      ok: false,
      reason: "unavailable" as const,
      snapshot: readProfile(target),
    };
  }
}
export async function deleteProfile(
  expectedRaw: string | null,
  storage?: StorageLike | null,
  locks?: LockManager | null,
) {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target)
    return {
      ok: false,
      reason: "unavailable" as const,
      snapshot: readProfile(null),
    };
  const targetLocks =
    locks === undefined
      ? (() => {
          try {
            return navigator.locks;
          } catch {
            return null;
          }
        })()
      : locks;
  const remove = async () => {
    const now = read(target);
    if (now.state === "unavailable")
      return { ok: false, reason: "unavailable" as const, snapshot: now };
    if (now.raw !== expectedRaw)
      return { ok: false, reason: "conflict" as const, snapshot: now };
    try {
      target.removeItem(PROFILE_KEY);
    } catch {
      return { ok: false, reason: "unavailable" as const, snapshot: now };
    }
    return { ok: true, snapshot: read(target) };
  };
  try {
    return targetLocks?.request
      ? await targetLocks.request("dh.training-profile.v1", remove)
      : await remove();
  } catch {
    return {
      ok: false,
      reason: "unavailable" as const,
      snapshot: readProfile(target),
    };
  }
}
export function subscribeProfile(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: StorageEvent) => {
    if (event.key === PROFILE_KEY || event.key === null) callback();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
