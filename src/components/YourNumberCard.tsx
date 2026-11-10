import { useEffect, useState } from "react";
import DialMark from "./DialMark";
import NextSessionChoices from "./NextSessionChoices";
import { trackFeature, trackNextSessionChosen } from "../scripts/training-events.js";
import { describeHold, parseAge, parseHold } from "../lib/your-number.mjs";
import { starterById } from "../lib/next-session.mjs";

const LEVEL_1 = starterById("level-1")!;

type Described = ReturnType<typeof describeHold>;

export default function YourNumberCard() {
  const [hydrated, setHydrated] = useState(false);
  const [hold, setHold] = useState("");
  const [sex, setSex] = useState("");
  const [age, setAge] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState<{ seconds: number; out: Described } | null>(null);

  useEffect(() => setHydrated(true), []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const h = parseHold(hold);
    if (!h.ok) {
      setShown(null);
      setError(h.error!);
      return;
    }
    const a = parseAge(age);
    if (!a.ok) {
      setShown(null);
      setError(a.error!);
      return;
    }
    setError("");
    setShown({ seconds: h.seconds!, out: describeHold(h.seconds!, { sex, age: a.age }) });
    trackFeature("your_number_compared");
  }

  return (
    <div className="hang-calculator yn-card">
      <p className="yn-title dh-eyebrow" id="yn-title"><DialMark size={24} className="yn-dial" /> Your number</p>
      <form action="/dead-hang-time-by-age/" method="post" onSubmit={submit} noValidate aria-labelledby="yn-title">
        <div className="field-grid">
          <label htmlFor="yn-hold">
            Your hold <span className="optional">seconds, or minutes:seconds</span>
            <input
              id="yn-hold"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              disabled={!hydrated}
              value={hold}
              onChange={(e) => {
                setHold(e.target.value);
                setShown(null);
              }}
              aria-describedby={error ? "yn-error" : undefined}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <label htmlFor="yn-sex">
            Reference values to show <span className="optional">Optional</span>
            <select
              id="yn-sex"
              disabled={!hydrated}
              value={sex}
              onChange={(e) => {
                setSex(e.target.value);
                setShown(null);
              }}
            >
              <option value="">Both sets</option>
              <option value="men">Men&rsquo;s</option>
              <option value="women">Women&rsquo;s</option>
            </select>
          </label>
          <label htmlFor="yn-age">
            Your age <span className="optional">Optional</span>
            <input
              id="yn-age"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={!hydrated}
              value={age}
              onChange={(e) => {
                setAge(e.target.value);
                setShown(null);
              }}
            />
          </label>
        </div>
        <p className="small-copy">
          Nothing is stored or sent. Age is never used to score your hold.
        </p>
        <p className="small-copy">
          Cannot hang yet?{" "}
          <a className="text-link" href={LEVEL_1.path} onClick={() => trackNextSessionChosen(LEVEL_1.choice)}>
            Open a supported Level 1 session
          </a>{" "}
          or start the <a className="text-link" href="/beginner-deadhang/#cant-hang-yet">beginner ladder</a>.
        </p>
        <button className="dh-btn" type="submit" disabled={!hydrated}>
          Show where my hold sits
        </button>
        {error && (
          <p className="form-error" id="yn-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div id="yn-result" aria-live="polite" aria-atomic="true">
        {shown && (
          <div className="calculator-result yn-result">
            <p className="yn-score">Your hold <strong>{shown.seconds} s</strong></p>
            <NextSessionChoices source="age_card" />
            <ul className="yn-lines">
              {shown.out.lines.map((line) => (
                <li key={`${line.kind}-${line.sex}`}>
                  <span className="yn-text"><span className="yn-chip">{line.label}</span> {line.text}</span>
                  <span className="yn-source">{line.source}</span>
                </li>
              ))}
            </ul>
            {shown.out.ageNote && <p className="small-copy">{shown.out.ageNote}</p>}
            <p className="small-copy">These are different groups, so this is a rough comparison and not a ranking.</p>
            <p className="yn-next">
              Want to keep this measurement?{" "}
              <a className="text-link" href={shown.out.logHref} onClick={() => trackFeature("your_number_log_link")}>
                Save this hold as a measured hold
              </a>{" "}
              (prefilled as a test hold, and saved only when you confirm there).
            </p>
            <p className="small-copy yn-pro">
              Holds you log stay on this device. A free account plus Pro keeps them on every device.{" "}
              <a className="text-link" href="/pro/" data-dh-source="your_number">See what Pro adds</a>
            </p>
            {shown.out.showLadder && (
              <p className="yn-next">
                Short holds are a normal place to start.{" "}
                <a className="text-link" href={shown.out.ladderHref}>
                  Start with the beginner ladder
                </a>
                .
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
