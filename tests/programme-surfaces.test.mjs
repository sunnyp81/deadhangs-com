import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import copy from "../src/server/programmes/hang4.copy.json" with { type: "json" };
import rules from "../src/data/plan-rules.json" with { type: "json" };
import { programmeNumbers, routeForBaseline, suggestedBaseline } from "../src/lib/programme-engine.mjs";
import {
  appendResultToDeviceLog, fitResult, newResultId, parseSetInputs, programmeErrorMessage, routeFor, setupForServer, setupToForm, suggestedHold, weekTargets,
} from "../src/lib/programme-client.mjs";
import { STORAGE_KEY, parseStoredLog } from "../src/lib/training-log.mjs";
import { trackTrainingEvent } from "../src/scripts/training-events.js";

const hasDist = existsSync(new URL("../dist/programme/index.html", import.meta.url));
const dist = (p) => readFileSync(new URL(`../dist/${p}`, import.meta.url), "utf8");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const decode = (html) => html.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const limits = { ...programmeNumbers(rules) };
const sitemaps = () => readdirSync(new URL("../dist/", import.meta.url)).filter((x) => /^sitemap-.*\.xml$/.test(x));

test("limits and targets come from the rules and agree with the engine", () => {
  for (const s of [0, 4, 5, 12, 20, 21, 600]) assert.equal(routeFor(s, limits), routeForBaseline(s, rules), String(s));
  assert.equal(routeFor(-1, limits), null);
  assert.equal(routeFor(1.5, limits), null);
  assert.deepEqual(weekTargets(12, limits), { week1: 12, week2: 12 + limits.week2Add, week3: 12 + limits.week2Add + limits.week3Add });
  for (const s of [1, 25, 31]) assert.equal(suggestedHold(s, limits), suggestedBaseline(s, rules));
  assert.equal(suggestedHold(0, limits), null);
});

test("fit result: routes, suggestion and bad input", () => {
  assert.equal(fitResult("", "", limits).status, "empty");
  assert.equal(fitResult("abc", "", limits).status, "invalid");
  assert.equal(fitResult("10", "5", limits).status, "invalid");
  assert.equal(fitResult("3", "", limits).route, "supported");
  const std = fitResult("12", "", limits);
  assert.equal(std.route, "standard");
  assert.equal(std.targets.week2, 12 + limits.week2Add);
  assert.equal(fitResult("20", "", limits).route, "standard");
  assert.equal(fitResult("21", "", limits).route, "outside");
  assert.equal(fitResult("21", "", limits).targets, null);
  const hint = fitResult("", "25", limits);
  assert.equal(hint.status, "suggest");
  assert.equal(hint.suggestion, suggestedBaseline(25, rules));
});

test("result ids are dashless, retry-safe strings the engine accepts", () => {
  const id = newResultId();
  assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  assert.doesNotMatch(id, /-/);
  assert.match(newResultId({ getRandomValues: (b) => b.fill(7) }), /^0707/);
  assert.notEqual(newResultId(), newResultId());
});

test("set inputs: empty is not done, at least one value needed, whole seconds only", () => {
  assert.deepEqual(parseSetInputs(["12", "", "10"]), { error: null, sets: [12, null, 10] });
  assert.equal(parseSetInputs(["", "", ""]).error, "no_actual_result");
  assert.equal(parseSetInputs(["12.5", "", ""]).error, "invalid_sets");
  assert.equal(parseSetInputs(["x"]).error, "invalid_sets");
});

test("setup converts both ways and never sends fields the server rejects", () => {
  const { errors, setup } = setupForServer({ bar: "standard", grip: "neutral", chalk: "yes", load: "2.5", loadUnit: "kg", bodyweight: "80", ended: "slipping" });
  assert.deepEqual(errors, []);
  assert.deepEqual(setup, { bar: "standard", grip: "neutral", chalk: true, load: 2.5, loadUnit: "kg" });
  assert.deepEqual(setupForServer({ bar: "", grip: "", chalk: "", load: "", loadUnit: "kg" }).setup, {});
  assert.ok(setupForServer({ bar: "nope" }).errors.length);
  assert.deepEqual(setupToForm({ chalk: false, load: 5, loadUnit: "lb" }), { bar: "", grip: "", chalk: "no", load: "5", loadUnit: "lb" });
});

test("error messages are plain and 503 never leaks a code", () => {
  assert.match(programmeErrorMessage({ status: 503, code: "programme_unavailable" }), /not available right now\. Nothing was changed/);
  assert.match(programmeErrorMessage({ code: "revision_conflict" }), /another device.*nothing was overwritten/i);
  assert.match(programmeErrorMessage({ code: "something_new" }), /Nothing was changed/);
});

test("device log copy appends once, and leaves a corrupt or full log alone", () => {
  const store = (initial) => {
    const data = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  };
  const ok = store();
  const result = appendResultToDeviceLog({ storage: ok, date: "2026-11-20", sets: [12, null, 10], assistance: "unassisted", setup: { bar: "standard", chalk: true } }, "2026-11-25");
  assert.equal(result.ok, true);
  const [entry] = parseStoredLog(ok.getItem(STORAGE_KEY), "2026-11-25").entries;
  assert.equal(entry.seconds, 12);
  assert.equal(entry.sets, 2);
  assert.equal(entry.bar, "standard");
  const bad = store("{not json");
  assert.deepEqual(appendResultToDeviceLog({ storage: bad, date: "2026-11-20", sets: [10], assistance: "unassisted" }, "2026-11-25"), { ok: false, reason: "corrupt" });
  assert.equal(bad.getItem(STORAGE_KEY), "{not json");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() {} };
  assert.equal(appendResultToDeviceLog({ storage: blocked, date: "2026-11-20", sets: [10], assistance: "unassisted" }, "2026-11-25").reason, "unavailable");
});

test("programme events are consent-gated, allowlisted and carry no hold times", () => {
  const sent = [];
  const browser = (consent) => ({ localStorage: { getItem: () => consent }, location: { pathname: "/programme/" }, gtag: (...a) => sent.push(a) });
  assert.equal(trackTrainingEvent("programme_viewed", { source: "programme_page" }, browser("accepted")), true);
  assert.equal(trackTrainingEvent("programme_interest_submitted", { source: "programme_page" }, browser("accepted")), true);
  assert.equal(trackTrainingEvent("programme_checkout_started", { source: "programme_page" }, browser("accepted")), true);
  assert.equal(trackTrainingEvent("programme_fit_checked", { source: "programme_page", route: "standard" }, browser("accepted")), true);
  assert.deepEqual(sent.at(-1), ["event", "programme_fit_checked", { page_path: "/programme/", tool_source: "programme_page", programme_route: "standard" }]);
  assert.equal(trackTrainingEvent("programme_fit_checked", { source: "programme_page", route: "12" }, browser("accepted")), false);
  assert.equal(trackTrainingEvent("programme_fit_checked", { source: "programme_page" }, browser("accepted")), false);
  assert.equal(trackTrainingEvent("programme_viewed", { source: "programme_page", route: "standard" }, browser("accepted")), false);
  assert.equal(trackTrainingEvent("programme_viewed", { source: "programme_page" }, browser(null)), false);
  const n = sent.length;
  assert.equal(trackTrainingEvent("programme_viewed", { source: "programme_page", email: "a@b.c", seconds: 12 }, browser("accepted")), true);
  assert.deepEqual(sent[n][2], { page_path: "/programme/", tool_source: "programme_page" });
});

test("components use only the consent-gated helper and never touch programme data in storage", () => {
  for (const f of ["src/components/ProgrammeOffer.tsx", "src/components/ProgrammeFit.tsx"]) {
    assert.doesNotMatch(read(f), /gtag|dataLayer|sessionStorage/, f);
  }
  const app = read("src/components/ProgrammeApp.tsx");
  assert.doesNotMatch(app, /trackTrainingEvent|trackFeature|gtag|sessionStorage/);
  assert.equal((app.match(/localStorage/g) || []).length, 1, "only the optional device-log copy touches storage");
  assert.match(app, /appendResultToDeviceLog\(\{ storage: window\.localStorage/);
  const offer = read("src/components/ProgrammeOffer.tsx");
  assert.ok(offer.indexOf('trackTrainingEvent("programme_interest_submitted"') > offer.indexOf("data.saved === true"));
  assert.ok(offer.indexOf('trackTrainingEvent("programme_checkout_started"') > offer.indexOf("await requestCheckout("));
  assert.doesNotMatch(read("src/components/ProgrammeFit.tsx"), /programme_fit_checked", \{[^}]*(repeat|longest|seconds)/);
});

test("no dash punctuation, emoji or owner placeholders in the new visible copy", () => {
  for (const f of ["src/components/ProgrammeApp.tsx", "src/components/ProgrammeOffer.tsx", "src/components/ProgrammeFit.tsx", "src/pages/programme/index.astro", "src/pages/programme/app/index.astro", "src/lib/programme-client.mjs"]) {
    const t = read(f);
    assert.doesNotMatch(t, /[–—]/, `${f} dash`);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, `${f} emoji`);
    assert.doesNotMatch(t, /OWNER TO CONFIRM/, f);
  }
});

test("sales page is noindex, out of the sitemap, shows the price and the closed form", { skip: !hasDist }, () => {
  const html = dist("programme/index.html");
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  for (const f of sitemaps()) assert.doesNotMatch(dist(f), /\/programme\//, f);
  assert.match(html, /£29/);
  assert.match(html, /one payment, no subscription/);
  assert.match(html, /Not on sale yet\. It opens after a qualified fitness professional has checked it\./);
  assert.match(html, /<label for="prg-email">Your email<\/label>/);
  assert.match(html, /<input id="prg-email" type="email"/);
  assert.match(html, /<input id="prg-consent" type="checkbox"/);
  assert.match(html, /Email me once when this programme opens\. Nothing else, and no newsletter\./);
  assert.match(html, /Email me when it opens/);
  assert.doesNotMatch(html, /Buy for £29/);
  assert.doesNotMatch(html, /OWNER TO CONFIRM/);
  assert.match(html, /Refund, support and access terms will be published here before sales open\./);
  assert.match(html, /href="\/deadhang-safety\/"/);
  assert.doesNotMatch(html, /[–—]/);
});

test("sales page carries week 1 session 1 and the stop signs, and none of the rest of the paid copy", { skip: !hasDist }, () => {
  const text = decode(dist("programme/index.html"));
  assert.ok(text.includes(copy.standard.w1s1.title));
  assert.ok(text.includes(copy.common.stopSigns.text));
  const allowed = new Set([...copy.standard.w1s1.cues, copy.standard.w1s1.focus, copy.standard.w1s1.title, copy.common.stopSigns.text]);
  const strings = [];
  const walk = (value, path) => {
    if (typeof value === "string") { if (!path.includes("ruleIds")) strings.push([path, value]); }
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(copy, "");
  assert.ok(strings.length > 100, "walked the copy");
  const leaked = strings.filter(([, s]) => s.length >= 20 && !allowed.has(s) && text.includes(s));
  assert.deepEqual(leaked, []);
  for (const [path, s] of strings) if (/\.title$/.test(path) && s !== copy.standard.w1s1.title) assert.ok(!text.includes(s), `${path} title leaked`);
});

test("workspace page is noindex, uncached and has no analytics", { skip: !hasDist }, () => {
  const html = dist("programme/app/index.html");
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  for (const bad of ["googletagmanager", "G-YBPRQVR2Y3", "__gaLoad", "gtag("]) assert.ok(!html.includes(bad), bad);
  assert.match(read("public/_headers"), /\/programme\/app\/\*\n\s+Cache-Control: no-store\n\s+Referrer-Policy: no-referrer\n\s+X-Robots-Tag: noindex/);
  for (const f of sitemaps()) assert.doesNotMatch(dist(f), /\/programme\/app/, f);
});

test("the free four-week page and the programmes index link to the sales page", { skip: !hasDist }, () => {
  assert.match(dist("4-week-program/index.html"), /<a href="\/programme\/">See the four-week guided programme<\/a>/);
  assert.match(dist("training-programs/index.html"), /<a href="\/programme\/">See the four-week guided programme<\/a>/);
});

test("service worker template ignores the workspace", () => {
  assert.match(read("scripts/sw-template.js"), /programme\\\/app/);
});
