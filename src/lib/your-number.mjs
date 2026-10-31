export const GRIP6_MEN_MEAN = 64.0;
export const GRIP6_WOMEN_MEAN = 48.4;
export const ATTIA_MAN_TARGET = 120;
export const ATTIA_WOMAN_TARGET = 90;
export const LADDER_BELOW_SECONDS = 10;
export const MAX_HOLD_SECONDS = 3600;

/** Parse "65", "65.5", "1:05" or "1:05.5" into seconds. Returns {ok, seconds} or {ok:false, error}. */
export function parseHold(raw) {
  const text = String(raw ?? '').trim();
  const bad = { ok: false, error: 'Enter your hold as seconds (65) or minutes and seconds (1:05).' };
  if (!text) return bad;
  let seconds;
  const clock = /^(\d{1,3}):([0-5]?\d(?:\.\d+)?)$/.exec(text);
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]);
  else if (/^\d+(\.\d+)?$/.test(text)) seconds = Number(text);
  else return bad;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_HOLD_SECONDS)
    return { ok: false, error: 'Enter a hold between 1 and 3,600 seconds.' };
  return { ok: true, seconds };
}

/** Optional age: blank is fine; anything else must be a whole number 1 to 120. Used only for a note. */
export function parseAge(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, age: null };
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 120)
    return { ok: false, error: 'Age is optional. If you add it, use a whole number.' };
  return { ok: true, age: Number(text) };
}

function position(seconds, reference) {
  if (seconds > reference) return 'above';
  if (seconds < reference) return 'below';
  return 'equal';
}

function measuredLine(seconds, sex) {
  const men = sex === 'men';
  const mean = men ? GRIP6_MEN_MEAN : GRIP6_WOMEN_MEAN;
  const p = position(seconds, mean);
  const rel = p === 'above' ? 'Above' : p === 'below' ? 'Below' : 'Equal to';
  return {
    kind: 'measured',
    sex,
    position: p,
    label: rel,
    text: `The ${men ? "men's" : "women's"} mean of ${mean.toFixed(1)} s in one small study of ${men ? '11 trained men' : '14 trained women'}, mean age about 20.`,
    source: 'GRIP-6 study (2025). A small, young sample and not a norm.',
  };
}

function targetLine(seconds, sex) {
  const men = sex === 'men';
  const target = men ? ATTIA_MAN_TARGET : ATTIA_WOMAN_TARGET;
  const p = position(seconds, target);
  const rel = p === 'below' ? 'Below' : p === 'above' ? 'Above' : 'At';
  return {
    kind: 'target',
    sex,
    position: p,
    label: rel,
    text: `Attia's suggested target of at least ${target} s for a very strong 40-year-old ${men ? 'man' : 'woman'}.`,
    source: 'The Peter Attia Drive #329 (Dec 2024). A podcast target for very strong people, not measured data.',
  };
}

/**
 * Where a hold sits against the labelled reference values already on the page.
 * sex: 'men' | 'women' | '' (both shown). Age never scores anything; it only adds a note.
 */
export function describeHold(seconds, { sex = '', age = null } = {}) {
  const sexes = sex === 'men' ? ['men'] : sex === 'women' ? ['women'] : ['men', 'women'];
  const lines = [];
  for (const s of sexes) lines.push(measuredLine(seconds, s));
  for (const s of sexes) lines.push(targetLine(seconds, s));
  const ageNote =
    age === null
      ? null
      : 'Published hang-time data by age is thin. The measured samples are small and mostly young, so your age is not used to score this hold.';
  return {
    lines,
    ageNote,
    logHref: `/training-log/?hold=${Math.round(seconds)}`,
    showLadder: seconds < LADDER_BELOW_SECONDS,
    ladderHref: '/beginner-deadhang/#cant-hang-yet',
  };
}

/** Read ?hold=SECONDS for the training log. Whole seconds 1 to 3,600, else null. */
export function parseHoldParam(search) {
  const value = new URLSearchParams(String(search ?? '')).get('hold');
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_HOLD_SECONDS ? String(n) : null;
}
