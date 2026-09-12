export const PROFILE_KEY = "dh.training-profile.v1";
export const PROFILE_VERSION = 1;
export const PROFILE_MAX_BYTES = 4096;
const assistanceTypes = new Set(["unassisted", "feet-supported"]);
const weekDays = new Set([1, 2, 3, 4, 5, 6, 7]);

const localIso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const asDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
};
const integer = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

export function validateProfile(value) {
  if (!value || typeof value !== "object")
    return { ok: false, error: "Profile must be an object." };
  if (value.version !== PROFILE_VERSION)
    return {
      ok: false,
      state: "unsupported",
      error: "This settings version is not supported.",
    };
  const date = asDate(value.startDate);
  const weekdays = [
    ...new Set(Array.isArray(value.weekdays) ? value.weekdays : []),
  ].sort((a, b) => a - b);
  const session = value.session;
  if (
    !integer(value.targetSeconds, 1, 3600) ||
    !assistanceTypes.has(value.assistance) ||
    !date ||
    date.getFullYear() < 2000 ||
    !weekdays.length ||
    !weekdays.every((day) => weekDays.has(day)) ||
    ![4, 8, 12].includes(value.windowWeeks) ||
    !session ||
    session.mode !== "simple" ||
    !integer(session.workSeconds, 5, 120) ||
    !integer(session.restSeconds, 10, 300) ||
    !integer(session.rounds, 1, 10) ||
    ![0, 5, 10].includes(session.prepSeconds)
  )
    return { ok: false, error: "Check the saved plan settings." };
  return {
    ok: true,
    state: "ready",
    profile: {
      version: 1,
      targetSeconds: value.targetSeconds,
      assistance: value.assistance,
      startDate: value.startDate,
      weekdays,
      windowWeeks: value.windowWeeks,
      session: {
        mode: "simple",
        workSeconds: session.workSeconds,
        restSeconds: session.restSeconds,
        rounds: session.rounds,
        prepSeconds: session.prepSeconds,
      },
    },
  };
}
export function parseProfile(text) {
  if (text === null || text === "")
    return { ok: false, state: "empty", error: "No saved plan." };
  if (typeof text !== "string")
    return { ok: false, state: "corrupt", error: "Saved plan cannot be read." };
  if (new TextEncoder().encode(text).length > PROFILE_MAX_BYTES)
    return { ok: false, state: "corrupt", error: "Saved plan is too large." };
  try {
    const result = validateProfile(JSON.parse(text));
    return result.ok ? result : { ...result, state: result.state || "corrupt" };
  } catch {
    return { ok: false, state: "corrupt", error: "Saved plan cannot be read." };
  }
}
export function serializeProfile(profile) {
  const result = validateProfile(profile);
  if (!result.ok) throw new Error(result.error);
  return JSON.stringify(result.profile);
}
export function scheduleEnd(profile) {
  const valid = validateProfile(profile);
  if (!valid.ok) return null;
  const date = asDate(valid.profile.startDate);
  date.setDate(date.getDate() + valid.profile.windowWeeks * 7 - 1);
  return localIso(date);
}
export function scheduledDates(profile) {
  const valid = validateProfile(profile);
  if (!valid.ok) return [];
  const start = asDate(valid.profile.startDate);
  const end = asDate(scheduleEnd(valid.profile));
  const dates = [];
  for (
    const date = new Date(start);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    const isoDay = date.getDay() === 0 ? 7 : date.getDay();
    if (valid.profile.weekdays.includes(isoDay)) dates.push(localIso(date));
  }
  return dates;
}
export function nextScheduledDate(profile, today = localIso(new Date())) {
  return scheduledDates(profile).find((date) => date >= today) || null;
}
export function canResetSchedule(startDate, today = localIso(new Date())) {
  const date = asDate(startDate);
  return !!date && date.getFullYear() >= 2000 && startDate >= today;
}
