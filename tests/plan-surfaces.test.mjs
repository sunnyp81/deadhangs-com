import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlanInputs, ageBandFor, eligibility, isStripeCheckoutUrl, PLAN_REASONS } from "../src/lib/plan-offer.mjs";
import { SOURCES } from "../src/scripts/training-events.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("buildPlanInputs matches the interface contract and derives nothing", () => {
  assert.deepEqual(buildPlanInputs({ testSeconds: "60", repeatSeconds: "30", ageBand: "40-59" }).inputs, {
    testSeconds: 60, repeatSeconds: 30, ageBand: "40-59", sessionsPerWeek: 3,
  });
  assert.ok(!("sex" in buildPlanInputs({ testSeconds: 60, repeatSeconds: 30, ageBand: "under-40", sex: "men" }).inputs));
});

test("buildPlanInputs rejects bad holds and bands", () => {
  for (const bad of [
    { testSeconds: 0, repeatSeconds: 5, ageBand: "under-40" },
    { testSeconds: 25, repeatSeconds: 30, ageBand: "under-40" },
    { testSeconds: 60, repeatSeconds: "", ageBand: "under-40" },
    { testSeconds: 4000, repeatSeconds: 5, ageBand: "under-40" },
    { testSeconds: 60, repeatSeconds: 30, ageBand: "" },
  ]) assert.ok(buildPlanInputs(bad).error, JSON.stringify(bad));
});

test("eligibility window is 20 to 60 inclusive", () => {
  for (const [n, want] of [[19, "low"], [20, "ok"], [30, "ok"], [60, "ok"], [61, "high"]]) assert.equal(eligibility(n), want, String(n));
  assert.equal(eligibility(""), null);
  assert.equal(buildPlanInputs({ testSeconds: 90, repeatSeconds: 19, ageBand: "under-40" }).ineligible, "low");
  assert.equal(buildPlanInputs({ testSeconds: 90, repeatSeconds: 61, ageBand: "under-40" }).ineligible, "high");
  const form = read("src/components/PlanBuyForm.tsx");
  assert.match(form, /plan_offer_ineligible_low/);
  assert.match(form, /plan_offer_ineligible_high/);
  assert.match(form, /href="\/beginner-deadhang\/"/);
  assert.match(form, /href="\/deadhang-progressions\/"/);
  assert.doesNotMatch(form, /\bsex\b/);
});

test("checkout posts the flat PlanInputs and success uses the url as given", () => {
  const form = read("src/components/PlanBuyForm.tsx");
  assert.ok(form.includes("body: JSON.stringify(built.inputs)"));
  assert.doesNotMatch(form, /{ inputs:/);
  const ok = read("src/pages/plan/success/index.astro");
  assert.match(ok, /link.href = data.url/);
  assert.doesNotMatch(ok, /data.token/);
});

test("age bands and Stripe URL guard", () => {
  assert.equal(ageBandFor(39), "under-40");
  assert.equal(ageBandFor(40), "40-59");
  assert.equal(ageBandFor(60), "60-plus");
  assert.equal(ageBandFor(null), null);
  assert.ok(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_1"));
  assert.ok(!isStripeCheckoutUrl("https://evil.example/checkout.stripe.com"));
  assert.ok(!isStripeCheckoutUrl("http://checkout.stripe.com/x"));
  assert.equal(PLAN_REASONS.length, 4);
});

test("offer card renders only behind the opt-in prop, inside the result state", () => {
  const card = read("src/components/YourNumberCard.tsx");
  assert.ok(card.indexOf("{planOffer && <PlanOfferCard") > card.indexOf("{shown && ("));
  assert.match(read("src/pages/dead-hang-time-by-age/index.astro"), /PLAN_LAUNCH_ENABLED \? \{ planOffer: true \} : \{\}/);
});

test("plan events use only the consent-gated helper and allowlisted sources", () => {
  for (const s of ["plan_offer", "plan_page", "plan_success"]) assert.ok(SOURCES.has(s), s);
  for (const f of ["src/components/PlanBuyForm.tsx", "src/pages/plan/success/index.astro"]) {
    const src = read(f);
    assert.match(src, /trackTrainingEvent/);
    assert.doesNotMatch(src, /gtag|dataLayer|localStorage/);
  }
});

test("denylisted words never appear in the new copy", () => {
  const files = ["src/components/PlanBuyForm.tsx", "src/components/PlanOfferCard.tsx", "src/pages/plan/index.astro", "src/pages/plan/success/index.astro", "src/pages/plan/lost-link/index.astro", "src/lib/plan-offer.mjs"];
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /—|–/, `${f} dash`);
    assert.doesNotMatch(t, /\b(coach|programme|reviewed|improve|stronger|health|pain|longevity)\b/i, f);
  }
});
