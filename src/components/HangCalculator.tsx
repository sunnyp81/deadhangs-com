import { useEffect, useState } from "react";
import NextSessionChoices from "./NextSessionChoices";
import { compareHang } from "../lib/hang-comparison.mjs";
import { makeDraft, stageDraft } from "../lib/journey-draft.mjs";
import type { JourneyDraft, ToolSource } from "../lib/training-types";
import {
  trackTrainingToolView,
  trackTrainingEvent,
} from "../scripts/training-events.js";

type Props = {
  onContinue?: (draft: JourneyDraft) => void;
  analyticsSource?: ToolSource;
  /** One result-state line pointing to /pro/; on for /dead-hang-calculator/ only, never the homepage. */
  proLine?: boolean;
};

export default function HangCalculator({ onContinue, analyticsSource = "calculator", proLine = false }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [hold, setHold] = useState("");
  const [target, setTarget] = useState("60");
  const [previous, setPrevious] = useState("");
  const [result, setResult] = useState<ReturnType<typeof compareHang> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setHydrated(true);
    trackTrainingToolView({ source: analyticsSource });
  }, [analyticsSource]);

  function calculate(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!hold.trim() || !target.trim())
        throw new Error("Enter your hold time and a target.");
      setResult(
        compareHang(
          Number(hold),
          Number(target),
          previous.trim() ? Number(previous) : null,
        ),
      );
      setError("");
      trackTrainingEvent("training_calculator_used", {
        source: analyticsSource,
      });
    } catch (reason) {
      setResult(null);
      setError((reason as Error).message);
    }
  }

  function continueToSetup() {
    try {
      const draft = makeDraft({
        targetSeconds: Number(target),
        holdSeconds: Number(hold),
      }) as JourneyDraft;
      trackTrainingEvent("training_calculator_continued", {
        source: analyticsSource,
      });
      if (onContinue) {
        onContinue(draft);
        return;
      }
      const stored = stageDraft(draft);
      if (!stored)
        setError(
          "Your browser could not carry the temporary proposal over. You can still set up a goal on the next page.",
        );
      window.location.assign("/training-log/");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <div className="hang-calculator">
      <form action="/dead-hang-calculator/" method="post" onSubmit={calculate}>
        <div className="field-grid">
          <div>
          <label htmlFor="calc-time">
            Your hold, seconds
            <input
              id="calc-time"
              type="number"
              disabled={!hydrated}
              min="0"
              max="3600"
              step="0.1"
              required
              value={hold}
              onChange={(event) => {
                setHold(event.target.value);
                setResult(null);
              }}
              inputMode="decimal"
              aria-describedby="calc-time-hint"
            />
          </label>
          <p className="small-copy" id="calc-time-hint">Seconds, for example 45.</p>
          </div>
          <div>
          <label htmlFor="calc-target">
            Your target, seconds
            <input
              id="calc-target"
              aria-describedby="calc-target-hint"
              type="number"
              disabled={!hydrated}
              min="1"
              max="3600"
              step="0.1"
              required
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setResult(null);
              }}
              inputMode="decimal"
            />
          </label>
          <p className="small-copy" id="calc-target-hint">60 is an editable personal goal, not an age norm or fitness requirement.</p>
          </div>
          <details className="calc-previous">
          <summary>Compare with a previous hold (optional)</summary>
          <label htmlFor="calc-previous">
            Previous hold, seconds <span className="optional">Optional</span>
            <input
              id="calc-previous"
              type="number"
              disabled={!hydrated}
              min="0.1"
              max="3600"
              step="0.1"
              value={previous}
              onChange={(event) => {
                setPrevious(event.target.value);
                setResult(null);
              }}
              inputMode="decimal"
            />
          </label>
          </details>
        </div>
        <p className="small-copy">
          Compare holds with the same assistance, bar and grip.
        </p>
        <button className="dh-btn" type="submit" disabled={!hydrated}>
          Compare my hold
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div id="calc-result" aria-live="polite" aria-atomic="true">
        {result ? (
          <div className="calculator-result">
            <p className="dh-eyebrow">Against your own target</p>
            <div className="result-number">
              {result.percent}
              <span>%</span>
            </div>
            <p>
              {result.remaining > 0
                ? `${result.remaining} seconds between this hold and your target.`
                : "This hold meets or exceeds your target."}
            </p>
            {result.difference !== null && (
              <p>
                {result.difference > 0 ? "+" : ""}
                {result.difference} seconds ({result.change! > 0 ? "+" : ""}
                {result.change}%) compared with your previous hold.
              </p>
            )}
            <p className="small-copy">
              This is a personal comparison. It is not a population percentile
              or a medical assessment.
            </p>
            <NextSessionChoices source={analyticsSource} />
            <button
              type="button"
              className="dh-btn dh-btn-ghost"
              onClick={continueToSetup}
            >
              Review this goal in the timer
            </button>
            {proLine && (
              <p className="small-copy calc-pro">
                Holds you log stay on this device. A free account plus Pro keeps them on every device.{" "}
                <a className="text-link" href="/pro/" data-dh-source="calculator_result">See what Pro adds</a>
              </p>
            )}
          </div>
        ) : (
          <p className="calculator-empty">
            Enter a hold to see your target progress. Your entries stay on this
            page and are not saved.
          </p>
        )}
      </div>
    </div>
  );
}
