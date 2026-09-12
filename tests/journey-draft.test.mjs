import assert from "node:assert/strict";
import test from "node:test";
import {
  JOURNEY_DRAFT_KEY,
  JOURNEY_DRAFT_MAX_AGE_MS,
  makeDraft,
  parseDraft,
  readDraft,
  stageDraft,
} from "../src/lib/journey-draft.mjs";

const now = 1_789_000_000_000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("C4 keeps finite decimal comparison values without rounding", () => {
  const draft = makeDraft({ targetSeconds: 30.1, holdSeconds: 0 }, now);
  assert.deepEqual(draft, {
    version: 1,
    targetSeconds: 30.1,
    holdSeconds: 0,
    createdAtMs: now,
  });
  assert.deepEqual(parseDraft(JSON.stringify(draft), now).draft, draft);
});

test("C4 rejects malformed, oversized, future and expired values", () => {
  assert.equal(parseDraft("{", now).state, "corrupt");
  assert.equal(parseDraft("x".repeat(2049), now).state, "corrupt");
  assert.equal(
    parseDraft(
      JSON.stringify({ version: 1, targetSeconds: 30, holdSeconds: 0, createdAtMs: now + 1 }),
      now,
    ).state,
    "invalid",
  );
  assert.equal(
    parseDraft(
      JSON.stringify({ version: 1, targetSeconds: 30, holdSeconds: 0, createdAtMs: now - JOURNEY_DRAFT_MAX_AGE_MS - 1 }),
      now,
    ).state,
    "invalid",
  );
});

test("stage/read use only the C4 key and storage failure is harmless", () => {
  const storage = memoryStorage();
  const draft = makeDraft({ targetSeconds: 31, holdSeconds: 12.4 }, now);
  assert.equal(stageDraft(draft, storage), true);
  assert.equal(storage.getItem(JOURNEY_DRAFT_KEY) !== null, true);
  assert.deepEqual(readDraft(storage, now).draft, draft);
  assert.equal(stageDraft(draft, null), false);
  assert.equal(readDraft(null, now).state, "unavailable");
});
