// One line-drawn figure system for every hang diagram on the site.
// Output is plain SVG markup, so pages that build their body as a template string and
// Astro components can share it. All colour and stroke rules live in src/styles/figures.css.

export const VIEWBOX_W = 120;
export const VIEWBOX_H = 176; // poses with a floor or box
export const CROPPED_VIEWBOX_H = 158; // same scale, no empty floor space
export const GRIP_VIEWBOX_H = 100;
export const BAR_Y = 26;
export const FLOOR_Y = 166;
const CX = 60;

export const BODY_POSES = [
  "supported",
  "dead-hang",
  "active",
  "flexed",
  "step-down",
  "scapular-pull",
];
export const GRIP_POSES = ["overhand", "underhand", "mixed"];
export const POSE_NAMES = [...BODY_POSES, ...GRIP_POSES];

// Left-side keypoints in viewBox units. The right side mirrors across x = 60.
// sh = shoulder joint, el = elbow, hd = hand on the bar, head = head centre y,
// t = top of the trunk, py = pelvis y, kn = knee, ft = foot.
const BASE = { sh: [48, 64], el: [45, 45], hd: [42, BAR_Y], head: 57, t: 69, py: 99, kn: [55.5, 124], ft: [55, 149], boxTop: 156 };

const KEY = {
  dead: { ...BASE },
  active: { ...BASE, head: 45, t: 62, py: 92, kn: [55.5, 117], ft: [55, 142] },
  supported: { sh: [48, 56], el: [34, 43], hd: [42, BAR_Y], head: 47, t: 60, py: 90, kn: [52, 114], ft: [55, 138], boxTop: 138 },
  toes: { sh: [48, 62], el: [40, 45], hd: [42, BAR_Y], head: 53, t: 66, py: 96, kn: [55.5, 121], ft: [55, 146], boxTop: 146 },
  flexed: { sh: [48, 34], el: [36, 48], hd: [42, BAR_Y], head: 15, t: 38, py: 68, kn: [55.5, 93], ft: [55, 118], boxTop: 156 },
  scapular: { ...BASE, head: 42, t: 58, py: 88, kn: [55.5, 113], ft: [55, 138] },
  stepEnd: { handOff: true, sh: [48, 72], el: [45, 90], hd: [44, 108], head: 63, t: 76, py: 106, kn: [52.5, 129], ft: [55, 152], boxTop: 152 },
  stepMid: { handOff: true, sh: [48, 68], el: [30, 74], hd: [14, 80], head: 59, t: 72, py: 102, kn: [53, 126], ft: [55, 150], boxTop: 152 },
};

// Per pose: the key frame, what the figure teaches (drawn in the highlight colour),
// the prop it stands on and which motion cue it shows.
const POSE_DEFS = {
  supported: { key: "supported", hl: "legs", box: true },
  "dead-hang": { key: "dead", hl: "grip", box: false },
  active: { key: "active", hl: "shoulders", cue: "down" },
  flexed: { key: "flexed", hl: "arms", box: false },
  "step-down": { key: "stepEnd", hl: "legs", box: true },
  "scapular-pull": { key: "scapular", hl: "shoulders", cue: "up" },
};

const f = (n) => String(Math.round(n * 10) / 10);
const mx = (x) => 2 * CX - x;
const pts = (list) => list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

/** Geometry for one frame. Every frame returns the same element list so frames can morph. */
function frameElements(key, { boxOpacity = 0, boxTop, cueDown = 0, cueUp = 0, hl }) {
  const k = key;
  const hlSet = new Set(Array.isArray(hl) ? hl : hl ? [hl] : []);
  const cls = (base, part) => (hlSet.has(part) ? `${base} hf-hl` : base);
  const [shx, shy] = k.sh;
  const hipL = [CX - 4, k.py];
  const hipR = [CX + 4, k.py];
  const handBox = (hx) => ({ x: f(hx - 4.5), y: f(k.hd[1] - 5.5) });
  const hL = handBox(k.hd[0]);
  const hR = handBox(mx(k.hd[0]));
  const top = boxTop ?? k.boxTop;
  const handOp = k.handOff ? 0 : 1;
  const footL = [k.ft[0] - 5, k.ft[1] + 1];
  const footR = [mx(k.ft[0]) + 5, k.ft[1] + 1];
  const els = [
    { tag: "rect", cls: "hf-prop hf-box", attrs: { x: 34, y: f(top), width: 52, height: f(FLOOR_Y - top), rx: 2, opacity: boxOpacity } },
    { tag: "circle", cls: "hf-head", attrs: { cx: CX, cy: f(k.head), r: 7 } },
    { tag: "line", cls: "hf-limb", attrs: { x1: CX, y1: f(Math.min(k.head + 7, k.t)), x2: CX, y2: f(k.t) } },
    { tag: "line", cls: "hf-limb", attrs: { x1: CX, y1: f(k.t), x2: CX, y2: f(k.py) } },
    { tag: "line", cls: "hf-limb", attrs: { x1: f(hipL[0]), y1: f(k.py), x2: f(hipR[0]), y2: f(k.py) } },
    { tag: "polyline", cls: cls("hf-limb", "legs"), attrs: { points: pts([footL, k.ft, k.kn, hipL]) } },
    { tag: "polyline", cls: cls("hf-limb", "legs"), attrs: { points: pts([footR, [mx(k.ft[0]), k.ft[1]], [mx(k.kn[0]), k.kn[1]], hipR]) } },
    { tag: "rect", cls: "hf-bar", attrs: { x: 10, y: BAR_Y - 2.5, width: 100, height: 5, rx: 2.5 } },
    { tag: "polyline", cls: cls("hf-limb", "arms"), attrs: { points: pts([k.hd, k.el, k.sh]) } },
    { tag: "polyline", cls: cls("hf-limb", "arms"), attrs: { points: pts([[mx(k.hd[0]), k.hd[1]], [mx(k.el[0]), k.el[1]], [mx(shx), shy]]) } },
    { tag: "rect", cls: cls("hf-hand", "grip"), attrs: { x: hL.x, y: hL.y, width: 9, height: 11, rx: 3, opacity: handOp } },
    { tag: "rect", cls: cls("hf-hand", "grip"), attrs: { x: hR.x, y: hR.y, width: 9, height: 11, rx: 3, opacity: handOp } },
    { tag: "line", cls: cls("hf-limb", "shoulders"), attrs: { x1: f(shx), y1: f(shy), x2: f(mx(shx)), y2: f(shy) } },
    { tag: "path", cls: "hf-cue", attrs: { d: "M26 50V68M21 62L26 68L31 62M94 50V68M89 62L94 68L99 62", opacity: cueDown } },
    { tag: "path", cls: "hf-cue", attrs: { d: "M26 70V52M21 58L26 52L31 58M94 70V52M89 58L94 52L99 58", opacity: cueUp } },
  ];
  return els;
}

function resolveFrame(name, opts = {}) {
  const def = POSE_DEFS[name];
  if (!def) throw new Error(`Unknown hang pose: ${name}`);
  const key = KEY[def.key];
  let showBox = def.box ?? false;
  let boxTop;
  if (opts.box === true) showBox = true;
  else if (opts.box === false) showBox = false;
  else if (typeof opts.box === "number") {
    showBox = true;
    boxTop = opts.box;
  }
  return {
    key: opts.key ?? key,
    opts: {
      boxOpacity: opts.boxOpacity ?? (showBox ? 1 : 0),
      boxTop: boxTop ?? opts.boxTop,
      cueDown: opts.cueDown ?? (def.cue === "down" ? 1 : 0),
      cueUp: opts.cueUp ?? (def.cue === "up" ? 1 : 0),
      hl: opts.hl ?? def.hl,
    },
  };
}

function frameFor(name, opts) {
  const { key, opts: o } = resolveFrame(name, opts);
  return frameElements(key, o);
}

function attrString(attrs) {
  return Object.entries(attrs)
    .map(([a, v]) => `${a}="${v}"`)
    .join(" ");
}

function floorEl(visible) {
  return visible ? `<line class="hf-prop hf-floor" x1="8" y1="${FLOOR_Y}" x2="112" y2="${FLOOR_Y}"/>` : "";
}

function setsDots(n) {
  if (!n) return "";
  const xs = n === 1 ? [60] : n === 2 ? [52, 68] : [44, 60, 76];
  return xs.map((x) => `<circle class="hf-dot" cx="${x}" cy="160" r="2.5"/>`).join("");
}

function renderStatic(els, { skipHidden = true } = {}) {
  return els
    .filter((e) => !(skipHidden && e.attrs.opacity !== undefined && Number(e.attrs.opacity) === 0))
    .map((e) => {
      const a = { ...e.attrs };
      if (a.opacity !== undefined && Number(a.opacity) === 1) delete a.opacity;
      return `<${e.tag} class="${e.cls}" ${attrString(a)}/>`;
    })
    .join("");
}

/** Close-up of the hands on the bar, seen from above. Same stroke, colour and unit scale as the body poses. */
function gripSvg(pose, { tone } = {}) {
  // Thumbs point in for an overhand grip and out for an underhand grip, which is the difference to look for.
  const hand = (cx, kind, side) => {
    const x = cx - 13;
    const body = `<rect class="hf-hand" x="${x}" y="30" width="26" height="30" rx="8"/>`;
    const marks =
      kind === "over"
        ? [-7.5, -2.5, 2.5, 7.5].map((d) => `<line class="hf-limb" x1="${cx + d}" y1="34" x2="${cx + d}" y2="44"/>`).join("")
        : `<path class="hf-limb" d="M${cx - 8} 46Q${cx} 51 ${cx + 8} 46M${cx - 8} 53Q${cx} 58 ${cx + 8} 53"/>`;
    const inward = -side; // side: -1 left hand, +1 right hand
    const sx = kind === "over" ? inward : -inward;
    const edge = cx + sx * 13;
    const thumb = `<path class="hf-limb" d="M${edge} 50Q${edge + sx * 5} 52 ${edge + sx * 7} 58"/>`;
    const wrist = `<line class="hf-limb" x1="${cx}" y1="60" x2="${cx}" y2="92"/>`;
    return `<g class="hf-hl">${body}${marks}${thumb}</g>${wrist}`;
  };
  const kinds = pose === "overhand" ? ["over", "over"] : pose === "underhand" ? ["under", "under"] : ["over", "under"];
  const hands = hand(34, kinds[0], -1) + hand(86, kinds[1], 1);
  return `<svg class="hf hf-grip" data-pose="${pose}"${tone === "warn" ? ' data-tone="warn"' : ""} viewBox="0 0 ${VIEWBOX_W} ${GRIP_VIEWBOX_H}" aria-hidden="true" focusable="false"><rect class="hf-bar" x="8" y="42" width="104" height="5" rx="2.5"/>${hands}</svg>`;
}

/**
 * One figure as SVG markup.
 * pose: supported | dead-hang | active | flexed | step-down | scapular-pull | overhand | underhand | mixed
 * box: true | false | number (top of the box in viewBox units), floor: draw the floor line,
 * assist: "toes" draws the toes-touching variant of the supported pose, sets: dots under the feet,
 * hl: part drawn in the highlight colour (arms, shoulders, grip, legs), tone: "warn" turns the highlight amber.
 */
export function hangFigureSvg({ pose = "dead-hang", box, floor, assist, sets, hl, tone } = {}) {
  if (!POSE_NAMES.includes(pose)) throw new Error(`Unknown hang pose: ${pose}`);
  if (GRIP_POSES.includes(pose)) return gripSvg(pose, { tone });
  const opts = { box, hl };
  if (pose === "supported" && assist === "toes") opts.key = KEY.toes;
  const els = frameFor(pose, opts);
  const showFloor = floor ?? els.some((e) => e.cls.includes("hf-box") && Number(e.attrs.opacity) > 0);
  const h = showFloor || sets ? VIEWBOX_H : CROPPED_VIEWBOX_H;
  return `<svg class="hf" data-pose="${pose}"${tone === "warn" ? ' data-tone="warn"' : ""} viewBox="0 0 ${VIEWBOX_W} ${h}" aria-hidden="true" focusable="false">${floorEl(showFloor)}${renderStatic(els)}${setsDots(sets)}</svg>`;
}

const SPLINE = ".45 0 .2 1";

function animateTags(frames, times, dur) {
  const n = frames.length;
  const keyTimes = times.map(f).join(";");
  const keySplines = Array.from({ length: n - 1 }, () => SPLINE).join(";");
  const base = frames[0];
  return base
    .map((el, i) => {
      const names = Object.keys(el.attrs);
      const anims = names
        .map((name) => {
          const values = frames.map((fr) => String(fr[i].attrs[name]));
          if (values.every((v) => v === values[0])) return "";
          return `<animate attributeName="${name}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" values="${values.join(";")}" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`;
        })
        .join("");
      const a = { ...el.attrs };
      return `<${el.tag} class="${el.cls}" ${attrString(a)}>${anims}</${el.tag}>`;
    })
    .join("");
}

/** Named demo loops. Each is a list of frames with the time each is reached, so the same data draws the animation and the still start and end frames. */
export const LOOPS = {
  "feet-to-hang": {
    dur: 3.6,
    label: "Animated loop: a person standing on a box, hands on the bar with bent arms, steps off the box and hangs with straight arms, then returns to the box.",
    start: { pose: "supported", opts: { hl: "legs" }, note: "Feet on the box" },
    end: { pose: "dead-hang", opts: { hl: "legs" }, note: "Feet off the box" },
    frames: [
      ["supported", { hl: "legs" }],
      ["supported", { hl: "legs" }],
      ["dead-hang", { hl: "legs", box: true, boxOpacity: 0, boxTop: 138 }],
      ["dead-hang", { hl: "legs", box: true, boxOpacity: 0, boxTop: 138 }],
      ["supported", { hl: "legs" }],
    ],
    times: [0, 0.25, 0.55, 0.8, 1],
  },
  "passive-to-active": {
    dur: 3.2,
    label: "Animated loop: a person hanging with relaxed shoulders pulls the shoulders down and back. The chest lifts about two centimeters and the head rises away from the shoulders, then the shoulders relax again.",
    start: { pose: "dead-hang", opts: { hl: "shoulders" }, note: "Passive: shoulders relaxed" },
    end: { pose: "active", opts: { hl: "shoulders" }, note: "Active: shoulders down" },
    frames: [
      ["dead-hang", { hl: "shoulders" }],
      ["dead-hang", { hl: "shoulders" }],
      ["active", { hl: "shoulders" }],
      ["active", { hl: "shoulders" }],
      ["dead-hang", { hl: "shoulders" }],
    ],
    times: [0, 0.2, 0.5, 0.8, 1],
  },
  "step-down": {
    dur: 4,
    label: "Animated loop: a person hanging from the bar lowers their feet onto a box, lets go of the bar and stands with soft knees, then the loop restarts.",
    start: { pose: "dead-hang", opts: { box: 152, hl: "legs" }, note: "Hang, box below" },
    end: { pose: "step-down", opts: { hl: "legs" }, note: "Feet on the box, hands off" },
    frames: [
      ["dead-hang", { box: 152, hl: "legs" }],
      ["dead-hang", { box: 152, hl: "legs" }],
      ["step-down", { key: KEY.stepMid, hl: "legs" }],
      ["step-down", { hl: "legs" }],
      ["step-down", { hl: "legs" }],
      ["step-down", { key: KEY.stepMid, hl: "legs" }],
      ["dead-hang", { box: 152, hl: "legs" }],
    ],
    times: [0, 0.18, 0.4, 0.58, 0.78, 0.9, 1],
  },
};

function stillFigure(name, spec) {
  const { pose, opts, note } = spec;
  return `<figure class="hf-still-fig">${hangFigureSvg({ pose, floor: true, ...(opts ?? {}) })}<figcaption>${note}</figcaption></figure>`;
}

/**
 * A short autoplaying loop of one move, with real HTML Start and End frames for reduced motion
 * and a pause button that src/scripts/demo-loop.js reveals. Pause is a real button.
 */
export function demoLoopHtml(name, { caption } = {}) {
  const loop = LOOPS[name];
  if (!loop) throw new Error(`Unknown demo loop: ${name}`);
  const frames = loop.frames.map(([pose, opts]) => frameFor(pose, opts));
  const live = `<svg class="hf" data-loop="${name}" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}" aria-hidden="true" focusable="false">${floorEl(true)}${animateTags(frames, loop.times, loop.dur)}</svg>`;
  const cap = caption ? `<p class="hf-loop-cap">${caption}</p>` : "";
  return `<div class="hf-loop" data-hf-loop="${name}"><div class="hf-stage" role="img" aria-label="${loop.label}"><div class="hf-live">${live}</div><div class="hf-still">${stillFigure(name, loop.start)}${stillFigure(name, loop.end)}</div></div><div class="hf-controls"><button type="button" class="hf-toggle" aria-pressed="false" hidden>Pause animation</button>${cap}</div></div>`;
}
