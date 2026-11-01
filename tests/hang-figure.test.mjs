import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  POSE_NAMES,
  GRIP_POSES,
  BODY_POSES,
  VIEWBOX_W,
  VIEWBOX_H,
  CROPPED_VIEWBOX_H,
  LOOPS,
  hangFigureSvg,
  demoLoopHtml,
} from "../src/lib/hang-figure.js";
import { createFirstInteractionTracker } from "../src/scripts/demo-loop.js";
import { videoObjectSchema, isoDuration, videoTypeFor } from "../src/lib/video-object.js";

const css = fs.readFileSync(new URL("../src/styles/figures.css", import.meta.url), "utf8");

test("nine poses are available", () => {
  assert.equal(POSE_NAMES.length, 9);
  for (const p of ["supported", "dead-hang", "active", "overhand", "underhand", "mixed", "flexed", "step-down", "scapular-pull"]) {
    assert.ok(POSE_NAMES.includes(p), p);
  }
});

test("every pose uses the same 120 unit width and scale; body poses are 176 tall, or 158 when no floor is drawn", () => {
  for (const pose of BODY_POSES) {
    assert.ok(hangFigureSvg({ pose, floor: true }).includes(`viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}"`), pose);
    assert.ok(hangFigureSvg({ pose, box: false, floor: false }).includes(`viewBox="0 0 ${VIEWBOX_W} ${CROPPED_VIEWBOX_H}"`), pose);
  }
  for (const pose of GRIP_POSES) {
    assert.ok(hangFigureSvg({ pose }).includes(`viewBox="0 0 ${VIEWBOX_W} `), pose);
  }
});

test("head is an unfilled circle and there is exactly one per body pose", () => {
  for (const pose of BODY_POSES) {
    const svg = hangFigureSvg({ pose });
    const heads = svg.match(/<circle class="hf-head"[^>]*>/g) ?? [];
    assert.equal(heads.length, 1, pose);
    assert.ok(!/fill=/.test(heads[0]), pose);
    assert.ok(/ r="7"/.test(heads[0]), pose);
  }
});

test("no figure carries inline colour, stroke width or dashes; styling comes from the stylesheet", () => {
  for (const pose of POSE_NAMES) {
    const svg = hangFigureSvg({ pose, box: true });
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(svg), `${pose} hex`);
    assert.ok(!/stroke-width|stroke=|fill=|stroke-dasharray/.test(svg), `${pose} inline paint`);
  }
});

test("stylesheet fixes one stroke weight, non-scaling, and amber only under warn", () => {
  assert.match(css, /--hf-stroke: 2\.5px/);
  assert.match(css, /vector-effect: non-scaling-stroke/);
  const amberUses = css.split("\n").filter((l) => /--hf-warn|--color-warn/.test(l) && !/^\s*--hf-warn:/.test(l));
  assert.ok(amberUses.every((l) => /data-tone="warn"/.test(l)), amberUses.join("\n"));
});

test("only the highlighted part is marked, and warn is opt-in", () => {
  const svg = hangFigureSvg({ pose: "active", hl: "shoulders" });
  assert.equal((svg.match(/hf-hl/g) ?? []).length, 1);
  assert.ok(!svg.includes('data-tone="warn"'));
  assert.ok(hangFigureSvg({ pose: "active", tone: "warn" }).includes('data-tone="warn"'));
});

test("poses are drawn differently and unknown poses throw", () => {
  const all = new Set(POSE_NAMES.map((pose) => hangFigureSvg({ pose })));
  assert.equal(all.size, POSE_NAMES.length);
  assert.throws(() => hangFigureSvg({ pose: "nope" }));
});

test("chin is above the bar in the flexed arm hang and below it in the dead hang", () => {
  const chin = (pose) => {
    const m = hangFigureSvg({ pose }).match(/<circle class="hf-head" cx="60" cy="([\d.]+)" r="7"/);
    return Number(m[1]) + 7;
  };
  assert.ok(chin("flexed") < 23.5);
  assert.ok(chin("dead-hang") > 28.5);
});

test("demo loops: three loops, 2 to 4 seconds, same element structure in every frame, real HTML start and end labels", () => {
  assert.deepEqual(Object.keys(LOOPS).sort(), ["feet-to-hang", "passive-to-active", "step-down"]);
  for (const [name, loop] of Object.entries(LOOPS)) {
    assert.ok(loop.dur >= 2 && loop.dur <= 4, name);
    assert.equal(loop.frames.length, loop.times.length, name);
    assert.equal(loop.times[0], 0);
    assert.equal(loop.times.at(-1), 1);
    const html = demoLoopHtml(name, { caption: "Caption" });
    assert.match(html, /<animate /);
    assert.match(html, /role="img" aria-label="Animated loop/);
    assert.ok(html.includes("<figcaption>"), name);
    assert.match(html, /<button type="button" class="hf-toggle" aria-pressed="false" hidden>Pause animation<\/button>/);
    assert.ok(!/<button[^>]*>[^<]*<\/button>[^]*<\/div><div class="hf-controls">/.test(html));
    // the pause control is a sibling of the role=img stage, never inside it
    const stage = html.slice(html.indexOf('role="img"'), html.indexOf('<div class="hf-controls">'));
    assert.ok(!stage.includes("<button"), name);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(html), name);
  }
});

test("first interaction is reported once", () => {
  let calls = 0;
  const first = createFirstInteractionTracker(() => calls++);
  assert.equal(first(), true);
  assert.equal(first(), false);
  assert.equal(first(), false);
  assert.equal(calls, 1);
});

test("VideoObject JSON-LD only exists for a real video", () => {
  const base = { poster: "/images/p.jpg", name: "Active hang", uploadDate: "2026-11-02", duration: 12 };
  assert.equal(videoObjectSchema({ ...base }), "");
  assert.equal(videoObjectSchema({ ...base, src: "" }), "");
  assert.equal(videoObjectSchema({ src: "/v/a.mp4", name: "x", poster: "/p.jpg" }), "", "needs uploadDate");
  const out = videoObjectSchema({ ...base, src: ["/v/a.mp4", "/v/a.webm"] });
  const json = JSON.parse(out.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
  assert.equal(json["@type"], "VideoObject");
  assert.equal(json.contentUrl, "https://deadhangs.com/v/a.mp4");
  assert.deepEqual(json.thumbnailUrl, ["https://deadhangs.com/images/p.jpg"]);
  assert.equal(json.duration, "PT12S");
  assert.equal(json.uploadDate, "2026-11-02");
});

test("duration and type helpers", () => {
  assert.equal(isoDuration(75), "PT1M15S");
  assert.equal(isoDuration(60), "PT1M");
  assert.equal(isoDuration(0), null);
  assert.equal(videoTypeFor("/a.webm"), "video/webm");
  assert.equal(videoTypeFor("/a.mp4"), "video/mp4");
});
