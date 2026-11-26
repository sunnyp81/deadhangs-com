import { useEffect, useRef, useState } from "react";
import { fitResult } from "../lib/programme-client.mjs";
import { trackTrainingEvent } from "../scripts/training-events.js";

type Limits = { minBaseline: number; maxBaseline: number; baselinePercent: number; week2Add: number; week3Add: number; supportedSets: number; supportedHold: number };
type Props = { limits: Limits; planPrice: string };

/** "Is it for you?" Everything is computed here from the two typed numbers. The seconds are never stored or sent. */
export default function ProgrammeFit({ limits, planPrice }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [repeat, setRepeat] = useState("");
  const [longest, setLongest] = useState("");
  const sent = useRef("");
  useEffect(() => setHydrated(true), []);
  const result: any = fitResult(repeat, longest, limits);
  const route = result.status === "route" ? result.route : null;
  useEffect(() => {
    if (!route || sent.current === route) return;
    sent.current = route;
    trackTrainingEvent("programme_fit_checked", { source: "programme_page", route });
  }, [route]);

  return (
    <div className="prg-card prg-fit">
      <div className="prg-form">
        <div className="prg-field">
          <label htmlFor="prg-fit-repeat">The hold you can repeat for three clean sets (seconds)</label>
          <input id="prg-fit-repeat" className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={!hydrated} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        <div className="prg-field">
          <label htmlFor="prg-fit-longest">Your longest single hold (seconds, optional)</label>
          <input id="prg-fit-longest" className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={!hydrated} value={longest} onChange={(e) => setLongest(e.target.value)} />
        </div>
      </div>
      <div className="prg-fit-result" role="status" aria-live="polite">
        {result.status === "invalid" && <p>{result.message}</p>}
        {result.status === "suggest" && (
          <p>
            About <span className="prg-num">{result.suggestion}</span> seconds is {limits.baselinePercent}% of your longest hold, a usual starting point for a hold you can repeat. Try three sets at it, then enter the hold you could really repeat above.
          </p>
        )}
        {result.status === "route" && result.route === "supported" && (
          <>
            <p>Your hold: <span className="prg-num">{result.repeat} s</span>. The feet-supported route is built for you: <span className="prg-num">{limits.supportedSets}</span> sets of <span className="prg-num">{limits.supportedHold}</span> seconds with as much foot help as you need, then a short unassisted check in week 4.</p>
          </>
        )}
        {result.status === "route" && result.route === "standard" && (
          <>
            <p>Your hold: <span className="prg-num">{result.repeat} s</span>. The standard route is built for you. Your target per set:</p>
            <ul className="prg-weeks">
              <li><span>Week 1</span><span className="prg-num">{result.targets.week1} s</span></li>
              <li><span>Week 2</span><span className="prg-num">{result.targets.week2} s</span></li>
              <li><span>Week 3</span><span className="prg-num">{result.targets.week3} s</span></li>
            </ul>
            <p>Week 4 repeats the week 3 targets, then ends with a test day.</p>
          </>
        )}
        {result.status === "route" && result.route === "outside" && (
          <p>
            Your hold: <span className="prg-num">{result.repeat} s</span>. This programme is not built for you, because it starts below that level. The <a href="/plan/">{planPrice} eight-week plan</a> is for holds of {limits.maxBaseline} seconds or more, and the free <a href="/deadhang-progressions/">levels guide</a> shows what comes next.
          </p>
        )}
      </div>
    </div>
  );
}
