import { STARTER_SESSIONS } from "../lib/next-session.mjs";
import { trackNextSessionChosen } from "../scripts/training-events.js";
import type { ToolSource } from "../lib/training-types";
import "../styles/next-session.css";

export default function NextSessionChoices({ source }: { source: ToolSource }) {
  return (
    <details className="next-session">
      <summary className="dh-btn">Choose my next session <span aria-hidden="true">+</span></summary>
      <p className="small-copy">Choose a starting point you can manage under control. Check the timer settings, then start when ready.</p>
      <ul className="next-session-list">
        {STARTER_SESSIONS.map((starter) => (
          <li key={starter.id}>
            <a href={starter.path} className="next-session-choice" onClick={() => trackNextSessionChosen(starter.choice, { source })}>
              <span className="next-session-name">{starter.name}</span>
              <span className="next-session-dose">{starter.dose}</span>
              <span className="next-session-fit">{starter.fit}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="small-copy">Starting points from the <a className="text-link" href="/deadhang-progressions/">level guide</a>, based on common training practice. They are not tested prescriptions. Read the <a className="text-link" href="/deadhang-safety/#stop-and-step-down">stop rules</a>.</p>
    </details>
  );
}
