import { useEffect, useRef, useState } from "react";
import { trackTrainingEvent } from "../scripts/training-events.js";
import rules from "../data/plan-rules.json";
import { baselineHint, weekOneLine } from "../lib/plan8.mjs";
import { AGE_BANDS, PLAN_CHECKOUT_PATH, PLAN_PRICE_LABEL, ageBandFor, buildPlanInputs, eligibility, ineligibleRoute, isStripeCheckoutUrl } from "../lib/plan-offer.mjs";

type Props = {
  /** Card mode: the hold and age come from the by-age result. Page mode: the buyer types them. */
  testSeconds?: number;
  age?: number | null;
  source: "plan_offer" | "plan_page";
};

export default function PlanBuyForm({ testSeconds, age = null, source }: Props) {
  const card = testSeconds !== undefined;
  const [hydrated, setHydrated] = useState(false);
  const [test, setTest] = useState("");
  const [repeat, setRepeat] = useState("");
  const [band, setBand] = useState(ageBandFor(age) ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shownFor = useRef<string>("");
  const flagged = useRef<string>("");

  useEffect(() => setHydrated(true), []);
  useEffect(() => setBand(ageBandFor(age) ?? ""), [age]);
  useEffect(() => {
    const key = `${source}:${testSeconds ?? ""}`;
    if (shownFor.current === key) return;
    shownFor.current = key;
    trackTrainingEvent("plan_offer_shown", { source });
  }, [source, testSeconds]);

  const fit = eligibility(repeat);
  useEffect(() => {
    if ((fit !== "low" && fit !== "high") || flagged.current === fit) return;
    flagged.current = fit;
    trackTrainingEvent(fit === "low" ? "plan_offer_ineligible_low" : "plan_offer_ineligible_high", { source });
  }, [fit, source]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const built = buildPlanInputs({ testSeconds: card ? testSeconds : test, repeatSeconds: repeat, ageBand: band });
    if (built.error) {
      setError(built.error);
      return;
    }
    if (built.ineligible) return;
    setError("");
    setBusy(true);
    trackTrainingEvent("plan_offer_click", { source });
    try {
      const res = await fetch(PLAN_CHECKOUT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.inputs),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && (data.error === "ineligible_low" || data.error === "ineligible_high")) {
        setError(data.error === "ineligible_low" ? "The plan starts from a repeatable hold of 20 to 60 seconds." : "The plan stops at 60-second holds.");
        setBusy(false);
        return;
      }
      if (res.ok && isStripeCheckoutUrl(data.url)) {
        window.location.assign(data.url);
        return;
      }
    } catch { /* fall through */ }
    setError("The plan is not available to buy right now. Nothing has been charged.");
    setBusy(false);
  }

  const preview = card && fit === "ok" ? buildPlanInputs({ testSeconds, repeatSeconds: repeat, ageBand: band }).inputs : undefined;
  const weekOne = preview ? weekOneLine(preview, rules) : null;
  const route = fit === "low" || fit === "high" ? ineligibleRoute(repeat, rules) : null;
  const hint = baselineHint(rules);
  const id = `pb-${source}`;
  return (
    <form className="plan-buy" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      {weekOne && <p className="plan-week1" data-rules={weekOne.ruleIds.join(" ")}>{weekOne.text}</p>}
      <div className="field-grid">
        {!card && (
          <label htmlFor={`${id}-test`}>
            Your max hold <span className="optional">seconds</span>
            <input id={`${id}-test`} type="text" inputMode="numeric" autoComplete="off" disabled={!hydrated} value={test} onChange={(e) => setTest(e.target.value)} />
          </label>
        )}
        <label htmlFor={`${id}-repeat`}>
          Longest hold you can repeat three times <span className="optional">seconds</span>
          <input id={`${id}-repeat`} type="text" inputMode="numeric" autoComplete="off" disabled={!hydrated} value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-describedby={`${id}-hint`} />
          <span className="small-copy" id={`${id}-hint`}>From the 4-week guide: {hint.quote} The plan starts at the hold you enter.</span>
        </label>
        {(!card || !band) && (
          <label htmlFor={`${id}-age`}>
            Age band
            <select id={`${id}-age`} disabled={!hydrated} value={band} onChange={(e) => setBand(e.target.value)}>
              <option value="">Choose</option>
              {AGE_BANDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      {fit === "low" && route && (
        <p className="plan-ineligible" role="status">
          The plan starts from a repeatable hold of 20 to 60 seconds. Your next step is on the <a className="text-link" href={route.url}>free guide for your hold</a>, then come back.
        </p>
      )}
      {fit === "high" && route && (
        <p className="plan-ineligible" role="status">
          The plan stops at 60-second holds. Your next step is on the free <a className="text-link" href={route.url}>progressions page, Level 4</a>.
        </p>
      )}
      {(fit === "ok" || fit === null) && (
        <>
          <button className="dh-btn" type="submit" disabled={!hydrated || busy}>
            Get my 8-week plan, {PLAN_PRICE_LABEL}
          </button>
          <p className="small-copy">{PLAN_PRICE_LABEL}, one payment, 14-day refund. Pay by card on Stripe. No account needed.</p>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
