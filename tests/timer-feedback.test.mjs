import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackLifecycle } from "../src/lib/timer-feedback.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function fakeSentinel() {
  const listeners = new Set();
  return {
    releases: 0,
    addEventListener(type, listener) {
      if (type === "release") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "release") listeners.delete(listener);
    },
    release() {
      this.releases += 1;
    },
    systemRelease() {
      for (const listener of listeners) listener();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("late wake resolution after stop releases its own sentinel and never activates", async () => {
  const pending = deferred();
  const statuses = [];
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => true,
    requestWake: () => pending.promise,
    cancelSpeech() {},
  }, (status) => statuses.push(status));
  lifecycle.setWakeOptIn(true);
  lifecycle.setRunning(true);
  lifecycle.stop();
  const sentinel = fakeSentinel();
  pending.resolve(sentinel);
  await flush();
  assert.equal(sentinel.releases, 1);
  assert.equal(statuses.includes("active"), false);
  assert.equal(statuses.at(-1), "ready");
});

test("a stale wake resolution cannot remove the newer sentinel release listener", async () => {
  const first = deferred();
  const newer = fakeSentinel();
  const statuses = [];
  let calls = 0;
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => true,
    requestWake: () => (calls++ === 0 ? first.promise : newer),
    cancelSpeech() {},
  }, (status) => statuses.push(status));
  lifecycle.setWakeOptIn(true);
  lifecycle.setRunning(true);
  lifecycle.setRunning(false);
  lifecycle.setRunning(true);
  await flush();
  const stale = fakeSentinel();
  first.resolve(stale);
  await flush();
  assert.equal(stale.releases, 1);
  newer.systemRelease();
  assert.equal(statuses.at(-1), "released");
});

test("pause, resume, system release and toggle-off retain truthful wake states", async () => {
  const sentinels = [fakeSentinel(), fakeSentinel()];
  const statuses = [];
  let request = 0;
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => true,
    requestWake: () => sentinels[request++],
    cancelSpeech() {},
  }, (status) => statuses.push(status));
  lifecycle.setWakeOptIn(true);
  lifecycle.setRunning(true);
  await flush();
  assert.equal(statuses.at(-1), "active");
  lifecycle.setRunning(false);
  assert.equal(sentinels[0].releases, 1);
  assert.equal(statuses.at(-1), "ready");
  lifecycle.setRunning(true);
  await flush();
  sentinels[1].systemRelease();
  assert.equal(statuses.at(-1), "released");
  lifecycle.setWakeOptIn(false);
  assert.equal(statuses.at(-1), "off");
});

test("unsupported and denied wake requests never claim active", async () => {
  const unsupported = [];
  createFeedbackLifecycle({ supportsWake: () => false, cancelSpeech() {} }, (status) => unsupported.push(status))
    .setWakeOptIn(true);
  assert.equal(unsupported.at(-1), "unsupported");

  const denied = [];
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => true,
    requestWake: () => Promise.reject(new Error("denied")),
    cancelSpeech() {},
  }, (status) => denied.push(status));
  lifecycle.setWakeOptIn(true);
  lifecycle.setRunning(true);
  await flush();
  assert.equal(denied.at(-1), "denied");
  assert.equal(denied.includes("active"), false);
});

test("a rejected sentinel release is contained during feedback cleanup", async () => {
  const sentinel = fakeSentinel();
  sentinel.release = () => Promise.reject(new Error("release failed"));
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => true,
    requestWake: () => sentinel,
    cancelSpeech() {},
  });
  lifecycle.setWakeOptIn(true);
  lifecycle.setRunning(true);
  await flush();
  lifecycle.stop();
  await flush();
  assert.ok(true);
});

test("voice uses a local adapter, beep falls back, and stop/dispose cancel speech", () => {
  const spoken = [];
  let beeps = 0;
  let cancels = 0;
  const lifecycle = createFeedbackLifecycle({
    supportsWake: () => false,
    speak: (text) => {
      spoken.push(text);
      return text !== "Rest";
    },
    cancelSpeech: () => {
      cancels += 1;
    },
  });
  lifecycle.cue("Start", { voice: true, sound: true, beep: () => beeps += 1 });
  lifecycle.cue("Rest", { voice: true, sound: true, beep: () => beeps += 1 });
  lifecycle.cue("Finish", { voice: true, sound: false, beep: () => beeps += 1 });
  assert.deepEqual(spoken, ["Start", "Rest"]);
  assert.equal(beeps, 1);
  lifecycle.stop();
  lifecycle.dispose();
  assert.equal(cancels, 2);
});
