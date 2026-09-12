import test from "node:test";
import assert from "node:assert/strict";
import {
  canResetSchedule,
  nextScheduledDate,
  parseProfile,
  scheduledDates,
  serializeProfile,
  validateProfile,
} from "../src/lib/training-profile.mjs";

const profile = {
  version: 1,
  targetSeconds: 60,
  assistance: "feet-supported",
  startDate: "2026-09-14",
  weekdays: [4, 1, 1],
  windowWeeks: 4,
  session: {
    mode: "simple",
    workSeconds: 30,
    restSeconds: 60,
    rounds: 3,
    prepSeconds: 5,
  },
};

test("C3 exact fixture round-trips and uses ISO weekdays", () => {
  const parsed = validateProfile(profile);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.profile.weekdays, [1, 4]);
  assert.deepEqual(
    JSON.parse(serializeProfile({ ...profile, extra: "discard" })),
    { ...profile, weekdays: [1, 4] },
  );
  assert.equal(scheduledDates(parsed.profile).length, 8);
  assert.equal(nextScheduledDate(parsed.profile, "2026-10-12"), null);
});
test("parser distinguishes unsupported from corrupt and validates calendar dates", () => {
  assert.equal(
    parseProfile(JSON.stringify({ ...profile, version: 99 })).state,
    "unsupported",
  );
  assert.equal(parseProfile("{").state, "corrupt");
  assert.equal(
    validateProfile({ ...profile, startDate: "2026-02-30" }).ok,
    false,
  );
  assert.equal(
    validateProfile({ ...profile, startDate: "1999-12-31" }).ok,
    false,
  );
  assert.equal(canResetSchedule("2026-09-14", "2026-09-14"), true);
  assert.equal(canResetSchedule("2026-09-13", "2026-09-14"), false);
});
