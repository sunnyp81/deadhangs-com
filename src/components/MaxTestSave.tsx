import { useEffect, useId, useRef, useState } from "react";
import "../styles/training-workspace.css";
import SetupFields from "./SetupFields";
import { EMPTY_SETUP_FORM } from "../lib/training-log.mjs";
import { setupHasTags, trackFeature } from "../scripts/training-events.js";
import { readRememberedSetup, saveNewEntry } from "../lib/training-log-store";
import type { SetupForm } from "../lib/training-log-store";

/**
 * Shown after a max test. The measured time is prefilled and editable, the setup
 * defaults to the last one used, and nothing is saved until the user confirms.
 */
export default function MaxTestSave({ seconds, onSaved }: { seconds: number; onSaved?: () => void }) {
  const uid = useId();
  const [hold, setHold] = useState(String(seconds));
  const [setup, setSetup] = useState<SetupForm>({ ...EMPTY_SETUP_FORM } as SetupForm);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [onLogPage, setOnLogPage] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    setSetup(readRememberedSetup());
    setOnLogPage(window.location.pathname.startsWith("/training-log"));
    headingRef.current?.focus();
  }, []);

  function save() {
    const result = saveNewEntry({ seconds: hold, sets: "1", kind: "test", setup });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSaved(true);
    trackFeature("max_test_saved");
    if (setupHasTags(setup)) trackFeature("setup_saved_with_tags");
    setMessage("Saved to this device as a max test. It now appears in your log and graph.");
    onSaved?.();
  }

  if (dismissed) return <p className="small-copy" role="status">Not saved. Nothing was added to your log.</p>;

  return (
    <div className="training-workspace mt-save-wrap">
      <div className="tw-panel mt-save" role="group" aria-labelledby={`${uid}-title`}>
        <h3 id={`${uid}-title`} ref={headingRef} tabIndex={-1} className="tw-panel-title">Save this max test</h3>
        {saved ? (
          <>
            <p className="tw-status" role="status">{message}</p>
            {!onLogPage && <a className="text-link" href="/training-log/">Open your log</a>}
          </>
        ) : (
          <>
            <p className="tw-note">The timer measured the hold. Correct the time if you came off the bar before you stopped it, then save. It is logged for today.</p>
            <div className="tw-field">
              <label htmlFor={`${uid}-hold`}>Hold to record (seconds)</label>
              <input
                id={`${uid}-hold`} className="dh-input" type="number" inputMode="numeric" min={1} max={3600} step={1}
                value={hold} onChange={(e) => setHold(e.target.value)}
              />
            </div>
            <SetupFields value={setup} onChange={setSetup} showEnded idPrefix={`${uid}-s`} />
            {message && <p className="tw-error" role="alert">{message}</p>}
            <div className="tw-controls">
              <button type="button" className="dh-btn" onClick={save}>Save test to this device</button>
              <button type="button" className="dh-btn dh-btn-ghost" onClick={() => setDismissed(true)}>Do not save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
