import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import {
  STARTER_SESSIONS,
  parseSessionParam,
  starterById,
  starterTimerLoad,
  starterLogSetup,
} from "../src/lib/next-session.mjs";
import { validTimerLoad } from "../src/lib/timer-state.mjs";
import { parseTimerParams, TIMER_PRESETS } from "../src/lib/timer-preset.mjs";
import { parseHoldParam, parseMeasuredParam, describeHold } from "../src/lib/your-number.mjs";
import { firstSaveKind, FIRST_SAVE_EVENTS } from "../src/lib/first-save.mjs";
import { SESSION_CHOICES, trackNextSessionChosen, trackTrainingEvent } from "../src/scripts/training-events.js";

const browser = (over = {}) => {
  const calls = [];
  return {
    calls,
    localStorage: { getItem: () => "accepted" },
    location: { pathname: "/dead-hang-time-by-age/" },
    gtag: (...x) => calls.push(x),
    ...over,
  };
};

test("starter sessions are the published level starting points and load in the timer", () => {
  assert.deepEqual(STARTER_SESSIONS.map((s) => s.id), ["level-1", "level-2", "level-3"]);
  for (const s of STARTER_SESSIONS) {
    const load = starterTimerLoad(s);
    assert.equal(validTimerLoad({ requestId: "r", ...load }), true, s.id);
    assert.equal(s.path, `/training-log/?session=${s.id}`);
    assert.ok(SESSION_CHOICES.has(s.choice));
    assert.doesNotMatch(s.path, /hold=/);
    assert.equal(load.config.prepSeconds, 5);
  }
  assert.deepEqual(starterById("level-1").config, TIMER_PRESETS.find((p) => p.id === "level-1").settings.config);
});

test("chosen support is preserved without carrying a previous weighted setup", () => {
  const previous = { assistance: "unassisted", load: "20", bar: "round", ended: "grip", bodyweight: "80" };
  assert.deepEqual(starterLogSetup("?session=level-1", previous), {
    assistance: "feet-supported", load: "", bar: "round", ended: "", bodyweight: "",
  });
  assert.equal(previous.load, "20");
  assert.equal(starterLogSetup("", previous), previous);
  assert.equal(starterLogSetup("?session=invalid", previous), previous);
  assert.equal(starterLogSetup("?session=level-2", { ...previous, assistance: "feet-supported" }).assistance, "unassisted");
});

test("session param is validated, and it never autostarts or carries a hold", () => {
  assert.equal(parseSessionParam("?session=level-2").id, "level-2");
  for (const bad of ["", "?session=", "?session=level-9", "?session=LEVEL-1", "?session=level-1&session=level-2", "?session=__proto__", "?session=toString"]) {
    assert.equal(parseSessionParam(bad), null, bad);
  }
  assert.equal(starterTimerLoad(null), null);
  assert.equal(starterTimerLoad({ id: "level-1", config: { mode: "simple", workSeconds: 999 } }).config.workSeconds, 15);
  assert.equal(parseHoldParam("?session=level-1"), null);
});

test("old hold and preset links keep working", () => {
  assert.equal(parseHoldParam("?hold=45"), "45");
  assert.equal(parseMeasuredParam("?hold=45"), true);
  assert.equal(parseTimerParams("?mode=simple&hang=15&rest=90&rounds=3&prep=5").config.workSeconds, 15);
  assert.equal(parseSessionParam("?mode=simple&hang=15"), null);
});

test("measured-hold links are recognised only with a valid hold", () => {
  assert.equal(describeHold(30, {}).logHref, "/training-log/#hold=30");
  assert.equal(parseMeasuredParam("?hold=30&measured=1"), true);
  assert.equal(parseHoldParam("#hold=30"), "30");
  assert.equal(parseMeasuredParam("#hold=30"), true);
  for (const bad of ["?measured=1", "?hold=0&measured=1", "?hold=30&hold=31", "#hold=-1"]) {
    assert.equal(parseMeasuredParam(bad), false, bad);
  }
});

test("next_session_chosen sends a fixed choice, tool_source and clean path only", () => {
  const b = browser({ location: { pathname: "/dead-hang-time-by-age/?hold=45#r" } });
  assert.equal(trackNextSessionChosen("level_2", {}, b), true);
  assert.deepEqual(b.calls, [["event", "next_session_chosen", {
    page_path: "/dead-hang-time-by-age/", tool_source: "age_card", session_choice: "level_2",
  }]]);
  for (const choice of ["level_9", "45", "", undefined, "Level_1"]) {
    const x = browser();
    assert.equal(trackNextSessionChosen(choice, {}, x), false);
    assert.equal(x.calls.length, 0);
  }
  const extra = browser();
  assert.equal(trackTrainingEvent("training_log_saved", { source: "workspace", choice: "level_1" }, extra), false);
  const unlisted = browser({ location: { pathname: "/some-article/" } });
  assert.equal(trackNextSessionChosen("level_1", {}, unlisted), false);
});

test("funnel events need consent and ignore training values", () => {
  for (const consent of [null, "declined"]) {
    const b = browser({ localStorage: { getItem: () => consent } });
    assert.equal(trackNextSessionChosen("level_1", {}, b), false);
    assert.equal(trackTrainingEvent("first_training_session_saved", { source: "workspace", pathname: "/training-log/" }, b), false);
    assert.equal(trackTrainingEvent("training_session_saved", { source: "workspace", pathname: "/training-log/" }, b), false);
    assert.equal(b.calls.length, 0);
  }
  const throwing = browser({ localStorage: { getItem: () => { throw new Error("blocked"); } } });
  assert.equal(trackNextSessionChosen("level_1", {}, throwing), false);
  const b = browser({ location: { pathname: "/training-log/" } });
  assert.equal(trackTrainingEvent("first_training_session_saved", { source: "chosen_session", hold: 45, target: 60, age: 40, bodyweightKg: 80 }, b), true);
  assert.deepEqual(b.calls[0], ["event", "first_training_session_saved", { page_path: "/training-log/", tool_source: "chosen_session" }]);
  assert.equal(trackTrainingEvent("first_test_hold_saved", { source: "workspace" }, b), true);
  assert.deepEqual(b.calls[1][2], { page_path: "/training-log/", tool_source: "workspace" });
  assert.equal(JSON.stringify(b.calls.map((call) => call[2])).match(/45|60|80|hold|"age|weight/), null);
});

test("first-save is decided by the current log history and kind", () => {
  assert.equal(firstSaveKind([], undefined), "session");
  assert.equal(firstSaveKind([], "test"), "max_test");
  assert.equal(firstSaveKind([{ kind: "test" }], undefined), "session");
  assert.equal(firstSaveKind([{ seconds: 20 }], "test"), "max_test");
  assert.equal(firstSaveKind([{ seconds: 20 }], undefined), null);
  assert.equal(firstSaveKind([{ kind: "test" }], "test"), null);
  assert.equal(firstSaveKind(null, undefined), "session");
  assert.equal(firstSaveKind([null, 3], undefined), "session");
  assert.equal(FIRST_SAVE_EVENTS.session, "first_training_session_saved");
  assert.equal(FIRST_SAVE_EVENTS.max_test, "first_test_hold_saved");
});

async function loadLogStore() {
  const lib = (f) => new URL(`../src/lib/${f}`, import.meta.url).href;
  let source = await fs.readFile(new URL("../src/lib/training-log-store.ts", import.meta.url), "utf8");
  source = source
    .replace('from "./training-log.mjs"', `from "${lib("training-log.mjs")}"`)
    .replace('from "./first-save.mjs"', `from "${lib("first-save.mjs")}"`);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const store = await loadLogStore();
const setup = { assistance: "unassisted", bar: "", grip: "", chalk: "", load: "", loadUnit: "kg", ended: "" };

function withWindow(localStorage, fn) {
  const previous = globalThis.window;
  globalThis.window = { localStorage, dispatchEvent() {} };
  try {
    return fn();
  } finally {
    globalThis.window = previous;
  }
}

test("a real max-test save reports first once, and duplicates do not", () => {
  const data = new Map();
  const ls = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  withWindow(ls, () => {
    assert.deepEqual(store.saveNewEntry({ seconds: "40", kind: "test", setup }), { ok: true, first: "max_test" });
    assert.deepEqual(store.saveNewEntry({ seconds: "42", kind: "test", setup }), { ok: true, first: null });
    assert.deepEqual(store.saveNewEntry({ seconds: "20", sets: "3", setup }), { ok: true, first: "session" });
    assert.deepEqual(store.saveNewEntry({ seconds: "22", sets: "3", setup }), { ok: true, first: null });
  });
});

test("storage that is blocked or full fails without a first-save result", () => {
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
  withWindow(blocked, () => {
    const r = store.saveNewEntry({ seconds: "40", kind: "test", setup });
    assert.equal(r.ok, false);
    assert.equal("first" in r, false);
  });
  const readOnly = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  withWindow(readOnly, () => {
    const r = store.saveNewEntry({ seconds: "40", setup });
    assert.equal(r.ok, false);
  });
});

test("components fire first-save only after a successful write, never from timer end or import", async () => {
  const read = (f) => fs.readFile(new URL(`../src/components/${f}`, import.meta.url), "utf8");
  const workspace = await read("TrainingWorkspace.tsx");
  const submit = workspace.slice(workspace.indexOf("function handleSubmit("), workspace.indexOf("function handleDelete("));
  assert.match(submit, /if \(commit\([\s\S]*if \(first\) trackTrainingEvent\(FIRST_SAVE_EVENTS\[first\]/);
  const rest = workspace.replace(submit, "");
  assert.doesNotMatch(rest, /FIRST_SAVE_EVENTS\[/);
  const maxTest = await read("MaxTestSave.tsx");
  const save = maxTest.slice(maxTest.indexOf("function save()"), maxTest.indexOf("if (dismissed)"));
  assert.match(save, /if \(!result\.ok\) \{[\s\S]*return;[\s\S]*if \(result\.first\) trackTrainingEvent/);
  for (const f of ["HangTimer.tsx", "TrainingJourney.tsx", "YourNumberCard.tsx", "HangCalculator.tsx"]) {
    assert.doesNotMatch(await read(f), /first_training_session_saved|FIRST_SAVE_EVENTS/, f);
  }
  const card = await read("YourNumberCard.tsx");
  assert.doesNotMatch(card, /trackNextSessionChosen\([^)]*(hold|seconds|age|sex)/);
  const journey = await read("TrainingJourney.tsx");
  assert.doesNotMatch(journey, /autoStart|\.start\(\)/);
});
