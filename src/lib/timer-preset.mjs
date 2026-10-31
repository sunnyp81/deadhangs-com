import { MAX_TEST_DEFAULTS, MAX_TEST_REST_CHOICES } from "./timer-state.mjs";

/** Fills any field a link leaves out. Matches the timer's own starting values. */
export const DEFAULT_TIMER_CONFIG = Object.freeze({
  mode: "simple",
  workSeconds: 30,
  restSeconds: 60,
  rounds: 3,
  prepSeconds: 0,
});

const MODE_FROM_URL = { simple: "simple", emom: "emom", ladder: "ladder", max: "test" };
const MODE_TO_URL = { simple: "simple", emom: "emom", ladder: "ladder", test: "max" };
const PREP_CHOICES = [0, 5, 10];

const HANG = { min: 5, max: 120, emomMax: 50 };
const REST = { min: 10, max: 300 };
const ROUNDS = { min: 1, max: 10 };
const WARMUPS = { min: 0, max: 3 };

function wholeNumber(value) {
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  return Number(value);
}
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const nearest = (n, choices) =>
  choices.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), choices[0]);

/**
 * Reads timer settings from a query string. Every value is clamped to the same
 * limits the on-screen controls use, and anything unreadable is ignored.
 * Returns null when no usable setting was found, so a plain visit is untouched.
 */
export function parseTimerParams(search) {
  const params = new URLSearchParams(String(search ?? ""));
  const found = {};
  let used = false;

  const modeRaw = (params.get("mode") ?? "").toLowerCase();
  const mode = Object.hasOwn(MODE_FROM_URL, modeRaw) ? MODE_FROM_URL[modeRaw] : null;
  if (mode) {
    found.mode = mode;
    used = true;
  }
  const effectiveMode = mode ?? DEFAULT_TIMER_CONFIG.mode;

  const hang = wholeNumber(params.get("hang"));
  if (hang !== null && effectiveMode !== "test") {
    found.workSeconds = clamp(hang, HANG.min, effectiveMode === "emom" ? HANG.emomMax : HANG.max);
    used = true;
  }
  const rest = wholeNumber(params.get("rest"));
  let maxRest;
  if (rest !== null) {
    if (effectiveMode === "test") {
      maxRest = nearest(rest, MAX_TEST_REST_CHOICES);
      used = true;
    } else if (effectiveMode !== "emom") {
      found.restSeconds = clamp(rest, REST.min, REST.max);
      used = true;
    }
  }
  const rounds = wholeNumber(params.get("rounds"));
  if (rounds !== null && effectiveMode !== "test") {
    found.rounds = clamp(rounds, ROUNDS.min, ROUNDS.max);
    used = true;
  }
  const prep = wholeNumber(params.get("prep"));
  if (prep !== null) {
    found.prepSeconds = nearest(prep, PREP_CHOICES);
    used = true;
  }
  const warmupsRaw = wholeNumber(params.get("warmups"));
  let warmups;
  if (warmupsRaw !== null && effectiveMode === "test") {
    warmups = clamp(warmupsRaw, WARMUPS.min, WARMUPS.max);
    used = true;
  }
  const voiceRaw = params.get("voice");
  let voice;
  if (voiceRaw === "1" || voiceRaw === "0") {
    voice = voiceRaw === "1";
    used = true;
  }
  if (!used) return null;

  const config = { ...DEFAULT_TIMER_CONFIG, ...found };
  if (config.mode === "emom" && config.workSeconds > HANG.emomMax) config.workSeconds = HANG.emomMax;
  const result = { config };
  if (voice !== undefined) result.voice = voice;
  if (config.mode === "test") {
    result.maxTest = {
      warmups: warmups ?? MAX_TEST_DEFAULTS.warmups,
      restSeconds: maxRest ?? MAX_TEST_DEFAULTS.restSeconds,
    };
  }
  return result;
}

/** Builds the query string (no leading "?") for a set of timer settings. */
export function buildTimerQuery({ config, voice = false, maxTest }) {
  const q = new URLSearchParams();
  q.set("mode", MODE_TO_URL[config.mode] ?? "simple");
  if (config.mode === "test") {
    const plan = maxTest ?? MAX_TEST_DEFAULTS;
    q.set("warmups", String(plan.warmups));
    q.set("rest", String(plan.restSeconds));
  } else {
    q.set("hang", String(config.workSeconds));
    if (config.mode !== "emom") q.set("rest", String(config.restSeconds));
    q.set("rounds", String(config.rounds));
  }
  q.set("prep", String(config.prepSeconds));
  if (voice) q.set("voice", "1");
  return q.toString();
}

export function buildTimerUrl(origin, settings) {
  return `${origin}/training-log/?${buildTimerQuery(settings)}`;
}

const LEVEL_1 = { mode: "simple", workSeconds: 15, restSeconds: 90, rounds: 3, prepSeconds: 5 };

/**
 * Named starting points. Level 1 values are the site's canonical dose (see
 * /deadhang-progressions/). The max test uses the timer's own default plan.
 */
export const TIMER_PRESETS = [
  {
    id: "level-1",
    name: "Level 1 session",
    summary: "3 hangs of 15 seconds, 90 seconds of rest between hangs, 5 seconds to get ready.",
    dose: "3 hangs of 15 seconds",
    rest: "90 seconds of rest between hangs",
    settings: { config: LEVEL_1 },
  },
  {
    id: "level-1-voice",
    name: "Level 1 session with voice cues",
    summary: "The same Level 1 session with spoken cues switched on for when you cannot look at the screen.",
    dose: "3 hangs of 15 seconds",
    rest: "90 seconds of rest between hangs",
    settings: { config: LEVEL_1, voice: true },
  },
  {
    id: "max-test",
    name: "Max test",
    summary: "Two easy 10 second warm-up holds, a 2 minute rest, then one max hold counting up.",
    dose: "One max hold, counting up",
    rest: "Two easy 10 second warm-up holds and a 2 minute rest first",
    settings: {
      config: { mode: "test", workSeconds: 30, restSeconds: 60, rounds: 3, prepSeconds: 5 },
      maxTest: { ...MAX_TEST_DEFAULTS },
    },
  },
].map((p) => ({ ...p, query: buildTimerQuery(p.settings), path: `/training-log/?${buildTimerQuery(p.settings)}` }));
