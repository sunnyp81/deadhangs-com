// Starter sessions use the low end of each published level on /deadhang-progressions/.
// They are common training practice, not a prescription computed from anyone's hold.
const STARTERS = [
  {
    id: "level-1",
    choice: "level_1",
    assistance: "feet-supported",
    name: "Level 1: supported hangs",
    dose: "3 hangs of 15 seconds, 90 seconds of rest",
    how: "Keep your toes supported on a box or the floor.",
    fit: "For anyone who cannot yet hold a full dead hang for 15 seconds, including people who cannot hang at all yet.",
    config: { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 },
  },
  {
    id: "level-2",
    choice: "level_2",
    assistance: "unassisted",
    name: "Level 2: full dead hangs",
    dose: "3 hangs of 15 seconds, 90 seconds of rest",
    how: "Feet off the floor. Step down before your grip gives out.",
    fit: "For people who can already hold a full dead hang for 15 seconds.",
    config: { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 },
  },
  {
    id: "level-3",
    choice: "level_3",
    assistance: "unassisted",
    name: "Level 3: longer dead hangs",
    dose: "3 hangs of 30 seconds, 90 seconds of rest",
    how: "Feet off the floor, arms straight. Stop before your form breaks down.",
    fit: "For people who already hold 30 seconds for 3 sets with clean form. One long hold is not the same as 3 sets.",
    config: { mode: "simple", workSeconds: 30, restSeconds: 90, rounds: 3, prepSeconds: 5 },
  },
].map((s) => Object.freeze({ ...s, config: Object.freeze({ ...s.config }), path: `/training-log/?session=${s.id}` }));

export const STARTER_SESSIONS = Object.freeze(STARTERS);

export function starterById(id) {
  return STARTER_SESSIONS.find((s) => s.id === id) ?? null;
}

/** Reads ?session=level-N from a query string. Unknown or repeated values give null. */
export function parseSessionParam(search) {
  try {
    const values = new URLSearchParams(String(search ?? "")).getAll("session");
    if (values.length !== 1) return null;
    return starterById(values[0]);
  } catch {
    return null;
  }
}

/** Timer load for a starter. Same shape as a preset link, so the timer validates it the same way. */
export function starterTimerLoad(starter) {
  const known = starter ? starterById(starter.id) : null;
  return known ? { config: { ...known.config } } : null;
}

/** A chosen starter sets assistance, but never invents an actual hold or extra load. */
export function starterLogSetup(search, remembered) {
  const starter = parseSessionParam(search);
  return starter ? { ...remembered, assistance: starter.assistance, load: "", ended: "", bodyweight: "" } : remembered;
}
