import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const profileUrl = new URL(
  "../src/lib/training-profile.mjs",
  import.meta.url,
).href;

async function loadStore() {
  let source = await fs.readFile(
    new URL("../src/lib/training-profile-store.ts", import.meta.url),
    "utf8",
  );
  source = source.replace('from "./training-profile.mjs"', `from "${profileUrl}"`);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const store = await loadStore();
const profile = {
  version: 1,
  targetSeconds: 60,
  assistance: "unassisted",
  startDate: "2026-09-14",
  weekdays: [1, 4],
  windowWeeks: 4,
  session: {
    mode: "simple",
    workSeconds: 30,
    restSeconds: 60,
    rounds: 3,
    prepSeconds: 5,
  },
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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

test("unsupported saved profiles retain raw bytes until a reviewed replacement", async () => {
  const raw = '{"version":99,"future":true}';
  const storage = memoryStorage({ "dh.training-profile.v1": raw });

  const before = store.readProfile(storage);
  assert.equal(before.state, "unsupported");
  assert.equal(before.raw, raw);
  assert.equal(before.profile, null);

  const protectedSave = await store.saveProfile(profile, null, storage, null);
  assert.equal(protectedSave.ok, false);
  assert.equal(protectedSave.reason, "conflict");
  assert.equal(storage.getItem("dh.training-profile.v1"), raw);

  const replacement = await store.saveProfile(profile, raw, storage, null);
  assert.equal(replacement.ok, true);
  assert.deepEqual(JSON.parse(storage.getItem("dh.training-profile.v1")), profile);
});

test("storage and Web Lock failures leave the profile unsaved", async () => {
  const unavailable = await store.saveProfile(profile, null, null, null);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, "unavailable");

  const storage = memoryStorage();
  const lockFailure = await store.saveProfile(profile, null, storage, {
    request: async () => {
      throw new Error("lock unavailable");
    },
  });
  assert.equal(lockFailure.ok, false);
  assert.equal(lockFailure.reason, "unavailable");
  assert.equal(storage.getItem("dh.training-profile.v1"), null);
});

test("a failed fresh read cannot overwrite or delete a previously readable profile", async () => {
  const raw = JSON.stringify(profile);
  const storage = memoryStorage({ "dh.training-profile.v1": raw });
  assert.equal(store.readProfile(storage).raw, raw);
  storage.getItem = () => {
    throw new Error("read denied");
  };

  const save = await store.saveProfile({ ...profile, targetSeconds: 99 }, raw, storage, null);
  assert.equal(save.ok, false);
  assert.equal(save.reason, "unavailable");
  const remove = await store.deleteProfile(raw, storage, null);
  assert.equal(remove.ok, false);
  assert.equal(remove.reason, "unavailable");

  storage.getItem = (key) => (key === "dh.training-profile.v1" ? raw : null);
  assert.equal(storage.getItem("dh.training-profile.v1"), raw);
});
