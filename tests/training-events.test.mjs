import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  trackTrainingEvent,
  trackTrainingToolView,
} from "../src/scripts/training-events.js";
test("only allowlisted consented payload is emitted", () => {
  const calls = [];
  const b = {
    localStorage: { getItem: () => "accepted" },
    location: { pathname: "/training-log/" },
    gtag: (...x) => calls.push(x),
  };
  assert.equal(
    trackTrainingEvent(
      "training_timer_started",
      { source: "workspace", mode: "test", hold: 99 },
      b,
    ),
    true,
  );
  assert.deepEqual(calls, [
    [
      "event",
      "training_timer_started",
      { page_path: "/training-log/", source: "workspace", timer_mode: "test" },
    ],
  ]);
});
test("invalid, non-consented and failures are safe", () => {
  for (const consent of [null, "declined"]) {
    const calls = [];
    assert.equal(
      trackTrainingEvent(
        "training_goal_saved",
        { source: "workspace" },
        {
          localStorage: { getItem: () => consent },
          location: { pathname: "/training-log/" },
          gtag: (...x) => calls.push(x),
        },
      ),
      false,
    );
    assert.equal(calls.length, 0);
  }
  assert.equal(
    trackTrainingEvent(
      "anything",
      { source: "workspace" },
      {
        localStorage: { getItem: () => "accepted" },
        location: { pathname: "/training-log/" },
        gtag() {},
      },
    ),
    false,
  );
});
test("pathnames are canonical and an eligible page view is never replayed", () => {
  const calls = [];
  const b = {
    localStorage: { getItem: () => "accepted" },
    location: { pathname: "/training-log/" },
    gtag: (...x) => calls.push(x),
  };
  assert.equal(
    trackTrainingEvent(
      "training_log_saved",
      { source: "workspace", pathname: "/training-log/?hold=31#private" },
      b,
    ),
    true,
  );
  assert.deepEqual(calls[0][2], {
    page_path: "/training-log/",
    source: "workspace",
  });
  assert.equal(trackTrainingToolView({ source: "workspace" }, b), true);
  assert.equal(trackTrainingToolView({ source: "workspace" }, b), false);
  assert.equal(calls.filter((call) => call[1] === "training_tool_view").length, 1);
});
test("a pre-consent view is not replayed after consent changes", () => {
  const calls = [];
  let consent = null;
  const b = {
    localStorage: { getItem: () => consent },
    location: { pathname: "/dead-hang-calculator/" },
    gtag: (...x) => calls.push(x),
  };
  assert.equal(trackTrainingToolView({ source: "calculator" }, b), false);
  consent = "accepted";
  assert.equal(trackTrainingToolView({ source: "calculator" }, b), false);
  assert.equal(calls.length, 0);
});
test("only the explicit setup save can invoke the goal-saved callback", async () => {
  const source = await fs.readFile(
    new URL("../src/components/GoalSetup.tsx", import.meta.url),
    "utf8",
  );
  const save = source.slice(source.indexOf("async function save("), source.indexOf("function load()"));
  const imported = source.slice(source.indexOf("async function applyImport()"), source.indexOf("function download("));
  assert.match(save, /onSaved\?\.\(\)/);
  assert.doesNotMatch(imported, /onSaved\?\.\(\)/);
});
