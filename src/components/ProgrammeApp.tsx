import { useEffect, useId, useRef, useState } from "react";
import { signInBody, trustedRedirect } from "../lib/account-client.mjs";
import {
  PROGRAMME_ID, SESSION_NOTE_MAX, appendResultToDeviceLog, deviceLogMessage, jsonBody, newResultId, parseSetInputs,
  programmeErrorMessage, programmeRequest, requestCheckout, routeFor, setupForServer, setupToForm, shouldRefetch, suggestedHold, withKey,
} from "../lib/programme-client.mjs";
import { BAR_OPTION_LABELS, BAR_TYPES, GRIP_LABELS, GRIP_TYPES, LOAD_UNITS, MAX_LOAD, formatLocalDate, isCalendarDate, toLocalDateString } from "../lib/training-log.mjs";
import { buildTimerUrl } from "../lib/timer-preset.mjs";
import "../styles/programme.css";

type Phase = "loading" | "signedout" | "unavailable" | "error" | "ready";
type Setup = { bar: string; grip: string; chalk: string; load: string; loadUnit: string };

const label = (map: unknown, key: string) => (map as Record<string, string>)[key] ?? key;
const keyLabel = (key: string) => {
  const m = /^w(\d)s(\d)$/.exec(key);
  return m ? `Week ${m[1]}, session ${m[2]}` : key === "s0" ? "Start session" : key;
};
const secondsText = (sets: (number | null)[] | null) => (sets ? sets.map((n) => (n === null ? "not done" : `${n} s`)).join(", ") : "Not recorded");

function SetupGrid({ value, onChange, disabled, idPrefix }: { value: Setup; onChange: (next: Setup) => void; disabled: boolean; idPrefix: string }) {
  const set = (patch: Partial<Setup>) => onChange({ ...value, ...patch });
  return (
    <div className="prg-setup-grid">
      <div className="prg-field">
        <label htmlFor={`${idPrefix}-bar`}>Bar</label>
        <select id={`${idPrefix}-bar`} disabled={disabled} value={value.bar} onChange={(e) => set({ bar: e.target.value })}>
          <option value="">Not recorded</option>
          {BAR_TYPES.map((type: string) => <option key={type} value={type}>{label(BAR_OPTION_LABELS, type)}</option>)}
        </select>
      </div>
      <div className="prg-field">
        <label htmlFor={`${idPrefix}-grip`}>Grip</label>
        <select id={`${idPrefix}-grip`} disabled={disabled} value={value.grip} onChange={(e) => set({ grip: e.target.value })}>
          <option value="">Not recorded</option>
          {GRIP_TYPES.map((type: string) => <option key={type} value={type}>{label(GRIP_LABELS, type)}</option>)}
        </select>
      </div>
      <div className="prg-field">
        <label htmlFor={`${idPrefix}-chalk`}>Chalk</label>
        <select id={`${idPrefix}-chalk`} disabled={disabled} value={value.chalk} onChange={(e) => set({ chalk: e.target.value })}>
          <option value="">Not recorded</option>
          <option value="yes">Chalk</option>
          <option value="no">No chalk</option>
        </select>
      </div>
      <div className="prg-field">
        <label htmlFor={`${idPrefix}-load`}>Added load (optional)</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 5.5rem", gap: 8 }}>
          <input id={`${idPrefix}-load`} type="text" inputMode="decimal" autoComplete="off" maxLength={5} disabled={disabled} value={value.load} onChange={(e) => set({ load: e.target.value })} aria-describedby={`${idPrefix}-load-hint`} />
          <select aria-label="Load unit" disabled={disabled} value={value.loadUnit} onChange={(e) => set({ loadUnit: e.target.value })}>
            {LOAD_UNITS.map((unit: string) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </div>
        <span id={`${idPrefix}-load-hint`} className="prg-hint">Weight added on top of you, up to {MAX_LOAD}. Blank means none.</span>
      </div>
    </div>
  );
}

function SetInputs({ count, values, onChange, disabled, idPrefix }: { count: number; values: string[]; onChange: (next: string[]) => void; disabled: boolean; idPrefix: string }) {
  return (
    <div className="prg-sets">
      {Array.from({ length: count }, (_, i) => (
        <div className="prg-field" key={i}>
          <label htmlFor={`${idPrefix}-set-${i}`}>{count === 1 ? "Your hold (seconds)" : `Set ${i + 1} (seconds)`}</label>
          <input id={`${idPrefix}-set-${i}`} className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={disabled} value={values[i] ?? ""} onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))} />
        </div>
      ))}
    </div>
  );
}

function Instructions({ common }: { common: Record<string, string> }) {
  return (
    <details>
      <summary>How to set up, warm up and record</summary>
      {["setup", "warmup", "breathing", "getDown", "timerHowTo", "recordHowTo"].map((k) => (common?.[k] ? <p key={k}>{common[k]}</p> : null))}
    </details>
  );
}

function SessionCard({ session, baselineSetup, common, busy, today, onSave }: {
  session: any; baselineSetup: any; common: Record<string, string>; busy: boolean; today: string;
  onSave: (payload: any, addToLog: boolean) => Promise<unknown>;
}) {
  const uid = useId();
  const [id] = useState(() => newResultId());
  const [sets, setSets] = useState<string[]>(() => Array.from({ length: session.sets }, () => ""));
  const [setup, setSetup] = useState<Setup>(() => setupToForm(baselineSetup));
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  const [addToLog, setAddToLog] = useState(false);
  const [problem, setProblem] = useState("");
  const rows = Array.from({ length: session.sets }, (_, i) => i + 1);
  const isTraining = session.kind === "training";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem("");
    const parsed = parseSetInputs(sets);
    if (parsed.error) { setProblem(programmeErrorMessage({ code: parsed.error })); return; }
    const server = setupForServer(setup);
    if (server.errors.length) { setProblem(server.errors[0]); return; }
    if (!isCalendarDate(date) || date < "2026-01-01" || date > today) { setProblem("Choose today or an earlier date this year."); return; }
    if (notes.trim().length > SESSION_NOTE_MAX) { setProblem(programmeErrorMessage({ code: "invalid_note" })); return; }
    await onSave({ id, sessionKey: session.key, sets: parsed.sets, setup: server.setup, notes: notes.trim(), localDate: date, assistance: session.assistance }, addToLog);
  }

  return (
    <section className="prg-card prg-stack" aria-labelledby={`${uid}-title`}>
      <div className="prg-session-meta">
        <p className="prg-small" style={{ margin: 0 }}>Next: {keyLabel(session.key)}</p>
        <h2 id={`${uid}-title`} style={{ margin: 0 }}>{session.title || keyLabel(session.key)}</h2>
        {session.focus && <p style={{ margin: 0 }}><strong>{session.focus}</strong></p>}
      </div>
      {session.cues.length > 0 && <ul className="prg-list">{session.cues.map((cue: string) => <li key={cue}>{cue}</li>)}</ul>}
      {isTraining ? (
        <div className="prg-table-wrap">
          <table>
            <caption className="prg-visually-hidden">Planned sets for this session</caption>
            <thead><tr><th scope="col">Set</th><th scope="col">Planned hold</th><th scope="col">Rest after</th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n}>
                  <th scope="row" className="prg-num">{n}</th>
                  <td><span className="prg-target">{session.targetSeconds}</span> <span className="prg-small">s</span></td>
                  <td className="prg-num">{n < session.sets && session.restSeconds ? `${session.restSeconds} s` : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>One best controlled hold, with no set target.{session.maxSuggestedSeconds ? <> If in doubt, keep it to <span className="prg-num">{session.maxSuggestedSeconds}</span> seconds or fewer.</> : null}</p>
      )}
      <p className="prg-small" style={{ margin: 0 }}>{session.assistance === "feet-supported" ? "Feet supported: use as much foot help as you need and note it." : "Unassisted."}</p>
      {session.gripOption === "neutral" && <p className="prg-small" style={{ margin: 0 }}>Optional this week: one session may use a neutral grip, with palms facing each other, if your bar has neutral handles. Record the grip you used.</p>}
      <div className="prg-actions"><a className="prg-btn-quiet" href={session.timerUrl} target="_blank" rel="noopener noreferrer">Open the timer with these settings</a></div>
      <Instructions common={common} />

      <form className="prg-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-rec`}>
        <h3 id={`${uid}-rec`}>Record what you actually held</h3>
        <SetInputs count={session.sets} values={sets} onChange={setSets} disabled={busy} idPrefix={uid} />
        <p className="prg-hint" style={{ margin: 0 }}>Whole seconds. Leave a set empty if you did not do it.</p>
        <SetupGrid value={setup} onChange={setSetup} disabled={busy} idPrefix={`${uid}-setup`} />
        <div className="prg-field">
          <label htmlFor={`${uid}-notes`}>Note (optional)</label>
          <textarea id={`${uid}-notes`} maxLength={SESSION_NOTE_MAX} disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className="prg-hint">{notes.length} of {SESSION_NOTE_MAX} characters</span>
        </div>
        <div className="prg-field">
          <label htmlFor={`${uid}-date`}>Date</label>
          <input id={`${uid}-date`} type="date" min="2026-01-01" max={today} disabled={busy} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <label className="prg-check" htmlFor={`${uid}-log`}>
          <input id={`${uid}-log`} type="checkbox" disabled={busy} checked={addToLog} onChange={(e) => setAddToLog(e.target.checked)} />
          <span>Also add this session to this device's training log</span>
        </label>
        {problem && <p className="prg-msg is-error" role="alert">{problem}</p>}
        <button type="submit" className="prg-btn" disabled={busy}>Save this session</button>
      </form>
    </section>
  );
}

function ReviewCard({ review, busy, onDecide }: { review: any; busy: boolean; onDecide: (week: number, decision: "continue" | "repeat") => void }) {
  const words = review.words || {};
  return (
    <section className="prg-card prg-stack" aria-labelledby="prg-review-title">
      <h2 id="prg-review-title" style={{ margin: 0 }}>Week {review.week} review</h2>
      {words.intro && <p>{words.intro}</p>}
      <div className="prg-table-wrap">
        <table>
          <caption className="prg-visually-hidden">Planned against held, session by session</caption>
          <thead><tr><th scope="col">Session</th><th scope="col">Planned</th><th scope="col">Held, set by set</th></tr></thead>
          <tbody>
            {review.rows.map((row: any) => (
              <tr key={row.key}>
                <th scope="row">{keyLabel(row.key)}{row.localDate ? <span className="prg-hint" style={{ display: "block" }}>{formatLocalDate(row.localDate)}</span> : null}</th>
                <td className="prg-num">{row.targetSeconds === null ? "Best hold" : `${row.targetSeconds} s`}</td>
                <td className="prg-num">{secondsText(row.sets)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {review.suggestRepeat && <p className="prg-msg is-note">Most sessions this week missed the target by more than {review.repeatMissSeconds} seconds. The plan suggests repeating the week.</p>}
      {words.continueAdvice && <p>{words.continueAdvice}</p>}
      {words.repeatAdvice && <p>{words.repeatAdvice}</p>}
      <div className="prg-actions">
        <button type="button" className="prg-btn" disabled={busy} onClick={() => onDecide(review.week, "continue")}>Continue</button>
        <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => onDecide(review.week, "repeat")}>Repeat this week</button>
      </div>
      <p className="prg-small" style={{ margin: 0 }}>Repeating a week is a normal choice, not a failure.</p>
    </section>
  );
}

function FinalCard({ final, busy, onRestart }: { final: any; busy: boolean; onRestart: () => void }) {
  const words = final?.words || {};
  const goals = words.nextGoals || {};
  const diff = final?.difference;
  return (
    <section className="prg-card prg-stack" aria-labelledby="prg-final-title">
      <h2 id="prg-final-title" style={{ margin: 0 }}>You have finished the programme</h2>
      {words.intro && <p>{words.intro}</p>}
      {final ? (
        <>
          <div className="prg-cols">
            <div><p className="prg-small" style={{ margin: 0 }}>Start{final.startDate ? `, ${formatLocalDate(final.startDate)}` : ""}</p><p className="prg-target" style={{ margin: 0 }}>{final.start === null ? "Not recorded" : `${final.start} s`}</p></div>
            <div><p className="prg-small" style={{ margin: 0 }}>{final.kind === "check" ? "Unassisted check" : "Test day"}{final.endDate ? `, ${formatLocalDate(final.endDate)}` : ""}</p><p className="prg-target" style={{ margin: 0 }}>{final.end} s</p></div>
          </div>
          {final.comparable ? (
            <>
              <p>{words.comparable}</p>
              <p>Difference: <span className="prg-target">{diff > 0 ? "+" : ""}{diff} s</span></p>
            </>
          ) : <p>{words.notComparable} Not comparable.</p>}
        </>
      ) : <p>Your results are in the list below.</p>}
      <h3>What next</h3>
      <ul className="prg-list">
        {goals.maintain && <li>{goals.maintain}</li>}
        {goals.repeat34 && <li>{goals.repeat34} <a href="/4-week-program/">Open the free four-week guide</a>.</li>}
        {goals.plan8 && <li>{goals.plan8} <a href="/plan/">See the eight-week plan</a>.</li>}
        {goals.levels && <li>{goals.levels} <a href="/deadhang-progressions/">Open the levels guide</a>.</li>}
      </ul>
      <div className="prg-actions"><button type="button" className="prg-btn-quiet" disabled={busy} onClick={onRestart}>Start the programme again</button></div>
    </section>
  );
}

function Onboarding({ progress, busy, restart, onEnrol, onCancel }: { progress: any; busy: boolean; restart: boolean; onEnrol: (op: any) => Promise<unknown>; onCancel?: () => void }) {
  const uid = useId();
  const words = progress.onboarding || {};
  const limits = progress.limits || null;
  const [route, setRoute] = useState("");
  const [repeat, setRepeat] = useState("");
  const [longest, setLongest] = useState("");
  const [unassisted, setUnassisted] = useState("");
  const [setup, setSetup] = useState<Setup>({ bar: "", grip: "", chalk: "", load: "", loadUnit: "kg" });
  const [problem, setProblem] = useState("");
  const start = route && progress.startSession ? progress.startSession[route] : null;
  const timerUrl = start?.timerUrl || buildTimerUrl("", { config: { mode: "test" } });
  const longestNum = /^\d+$/.test(longest.trim()) ? Number(longest.trim()) : null;
  const suggestion = limits && longestNum ? suggestedHold(longestNum, limits) : null;
  const repeatNum = /^\d+$/.test(repeat.trim()) ? Number(repeat.trim()) : null;
  const outside = limits && repeatNum !== null && routeFor(repeatNum, limits) === "outside";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem("");
    if (!route) { setProblem("Choose the route that describes your hold today."); return; }
    const server = setupForServer(setup);
    if (server.errors.length) { setProblem(server.errors[0]); return; }
    const body: any = { op: "enrol", route, setup: server.setup, localDate: toLocalDateString() };
    if (route === "standard") {
      if (repeatNum === null) { setProblem(programmeErrorMessage({ code: "invalid_baseline" })); return; }
      if (limits) {
        const fit = routeFor(repeatNum, limits);
        if (fit === "supported") { setProblem(programmeErrorMessage({ code: "baseline_needs_supported" })); return; }
        if (fit === "outside") { setProblem(programmeErrorMessage({ code: "baseline_outside_range" })); return; }
      }
      body.baselineSeconds = repeatNum;
      if (longest.trim() !== "") {
        if (longestNum === null || longestNum < repeatNum) { setProblem(programmeErrorMessage({ code: "invalid_max_test" })); return; }
        body.maxTestSeconds = longestNum;
      }
    } else if (unassisted.trim() !== "") {
      if (!/^\d+$/.test(unassisted.trim())) { setProblem(programmeErrorMessage({ code: "baseline_not_supported_range" })); return; }
      body.unassistedSeconds = Number(unassisted.trim());
    }
    await onEnrol(body);
  }

  return (
    <section className="prg-card prg-stack" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} style={{ margin: 0 }}>{restart ? "Start the programme again" : "Start your programme"}</h2>
      <form className="prg-form" onSubmit={submit} noValidate>
        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="prg-label" style={{ fontWeight: 600, padding: 0, marginBottom: 6 }}>{words.routeQuestion || "Which describes your hold on a bar today?"}</legend>
          <label className="prg-check" htmlFor={`${uid}-r-standard`}>
            <input id={`${uid}-r-standard`} type="radio" name={`${uid}-route`} disabled={busy} checked={route === "standard"} onChange={() => setRoute("standard")} />
            <span>{words.standardRoute || "I can repeat three clean sets of about 5 seconds or more."}</span>
          </label>
          <label className="prg-check" htmlFor={`${uid}-r-supported`}>
            <input id={`${uid}-r-supported`} type="radio" name={`${uid}-route`} disabled={busy} checked={route === "supported"} onChange={() => setRoute("supported")} />
            <span>{words.supportedRoute || "I cannot yet hold about 5 seconds. I will use foot assistance."}</span>
          </label>
        </fieldset>
        {start && (
          <div className="prg-stack">
            <h3 style={{ margin: 0 }}>{start.title}</h3>
            {start.focus && <p style={{ margin: 0 }}><strong>{start.focus}</strong></p>}
            {start.cues?.length > 0 && <ul className="prg-list">{start.cues.map((cue: string) => <li key={cue}>{cue}</li>)}</ul>}
            <div className="prg-actions"><a className="prg-btn-quiet" href={timerUrl} target="_blank" rel="noopener noreferrer">Open the timer for the start test</a></div>
          </div>
        )}
        {route === "standard" && (
          <>
            {words.baselineHelp && <p className="prg-small" style={{ margin: 0 }}>{words.baselineHelp}</p>}
            <div className="prg-field">
              <label htmlFor={`${uid}-longest`}>Your longest hold from the start session (seconds, optional)</label>
              <input id={`${uid}-longest`} className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={busy} value={longest} onChange={(e) => setLongest(e.target.value)} />
            </div>
            {suggestion !== null && suggestion > 0 && <p className="prg-small" style={{ margin: 0 }}>A suggestion, not a setting: about <span className="prg-num">{suggestion}</span> seconds is {limits.baselinePercent}% of that hold. Enter the hold you can really repeat below.</p>}
            <div className="prg-field">
              <label htmlFor={`${uid}-repeat`}>The hold you can repeat for three clean sets (seconds)</label>
              <input id={`${uid}-repeat`} className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={busy} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </div>
            {outside && (
              <p className="prg-msg is-note">{words.outsideRange || "This programme starts below your level."} <a href="/plan/">The eight-week plan</a> or the <a href="/deadhang-progressions/">free levels guide</a> may suit you better.</p>
            )}
          </>
        )}
        {route === "supported" && (
          <div className="prg-field">
            <label htmlFor={`${uid}-unassisted`}>Your unassisted hold (seconds, optional)</label>
            <input id={`${uid}-unassisted`} className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={busy} value={unassisted} onChange={(e) => setUnassisted(e.target.value)} />
            <span className="prg-hint">Only if you tried one short unassisted hold. It is kept separate from supported holds.</span>
          </div>
        )}
        {route && (
          <>
            <h3 style={{ margin: 0 }}>Your setup</h3>
            <SetupGrid value={setup} onChange={setSetup} disabled={busy} idPrefix={`${uid}-setup`} />
            {words.setupHelp && <p className="prg-small" style={{ margin: 0 }}>{words.setupHelp}</p>}
            {words.scheduleHelp && <p className="prg-small" style={{ margin: 0 }}>{words.scheduleHelp}</p>}
          </>
        )}
        {problem && <p className="prg-msg is-error" role="alert">{problem}</p>}
        <div className="prg-actions">
          <button type="submit" className="prg-btn" disabled={busy || !route || !!outside}>Start the programme</button>
          {onCancel && <button type="button" className="prg-btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

function EditResult({ result, count, busy, onSave, onCancel }: { result: any; count: number; busy: boolean; onSave: (op: any) => Promise<unknown>; onCancel: () => void }) {
  const uid = useId();
  const [sets, setSets] = useState<string[]>(() => result.sets.map((n: number | null) => (n === null ? "" : String(n))));
  const [setup, setSetup] = useState<Setup>(() => setupToForm(result.setup));
  const [notes, setNotes] = useState<string>(result.notes || "");
  const [problem, setProblem] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem("");
    const parsed = parseSetInputs(sets);
    if (parsed.error) { setProblem(programmeErrorMessage({ code: parsed.error })); return; }
    const server = setupForServer(setup);
    if (server.errors.length) { setProblem(server.errors[0]); return; }
    await onSave({ op: "edit", id: result.id, sets: parsed.sets, setup: server.setup, notes: notes.trim() });
  }
  return (
    <form className="prg-form" onSubmit={submit} noValidate aria-label={`Edit ${keyLabel(result.sessionKey)}`}>
      <SetInputs count={count} values={sets} onChange={setSets} disabled={busy} idPrefix={uid} />
      <SetupGrid value={setup} onChange={setSetup} disabled={busy} idPrefix={`${uid}-setup`} />
      <div className="prg-field">
        <label htmlFor={`${uid}-notes`}>Note (optional)</label>
        <textarea id={`${uid}-notes`} maxLength={SESSION_NOTE_MAX} disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {problem && <p className="prg-msg is-error" role="alert">{problem}</p>}
      <div className="prg-actions">
        <button type="submit" className="prg-btn" disabled={busy}>Save changes</button>
        <button type="button" className="prg-btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ResultsList({ results, busy, readOnly, onEdit, onDiscard }: { results: any[]; busy: boolean; readOnly: boolean; onEdit?: (op: any) => Promise<unknown>; onDiscard?: (id: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState("");
  const [confirming, setConfirming] = useState("");
  const sorted = [...results].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  if (!sorted.length) return <p>No sessions recorded yet.</p>;
  return (
    <div>
      {sorted.map((r) => (
        <div className="prg-result prg-stack" key={r.id}>
          <div>
            <strong>{keyLabel(r.sessionKey)}</strong>{r.cycle > 0 ? <span className="prg-small"> (repeat {r.cycle})</span> : null}
            <span className="prg-small">, {formatLocalDate(r.localDate)}</span>
          </div>
          {editing === r.id && onEdit ? (
            <EditResult result={r} count={r.sets.length} busy={busy} onSave={async (op) => { if (await onEdit(op)) setEditing(""); }} onCancel={() => setEditing("")} />
          ) : (
            <>
              <div className="prg-result-sets">{r.sets.map((n: number | null) => (n === null ? "not done" : `${n} s`)).join("  ")}</div>
              <div className="prg-small">{r.planned?.targetSeconds ? `Planned ${r.planned.targetSeconds} s per set. ` : ""}{r.assistance === "feet-supported" ? "Feet supported. " : "Unassisted. "}{r.setup?.bar ? `${label(BAR_OPTION_LABELS, r.setup.bar)}. ` : ""}{r.setup?.grip ? `${label(GRIP_LABELS, r.setup.grip)} grip. ` : ""}{typeof r.setup?.chalk === "boolean" ? (r.setup.chalk ? "Chalk. " : "No chalk. ") : ""}{r.setup?.load ? `Added ${r.setup.load} ${r.setup.loadUnit}. ` : ""}</div>
              {r.notes ? <p style={{ margin: 0 }}>{r.notes}</p> : null}
              {!readOnly && (
                <div className="prg-actions">
                  <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => { setConfirming(""); setEditing(r.id); }}>Edit</button>
                  <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => setConfirming(r.id)}>Discard</button>
                </div>
              )}
              {confirming === r.id && onDiscard && (
                <div className="prg-confirm" role="group" aria-label="Confirm discard">
                  <p style={{ margin: "0 0 10px" }}>Discard this result? It is removed from your programme and cannot be saved again.</p>
                  <div className="prg-actions">
                    <button type="button" className="prg-btn" disabled={busy} onClick={async () => { if (await onDiscard(r.id)) setConfirming(""); }}>Discard result</button>
                    <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => setConfirming("")}>Keep it</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ProgrammeApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const generation = useRef(0);
  const sessionRef = useRef("");
  const buyRef = useRef(false);
  const started = useRef(false);

  const today = () => toLocalDateString();
  const progress = data?.progress;
  const key: string = data?.accountKey || "";

  async function loadState(): Promise<any> {
    const run = ++generation.current;
    try {
      const next: any = await programmeRequest(`/api/programme/state?programme=${PROGRAMME_ID}&today=${today()}`);
      if (run !== generation.current) return null;
      setData(next); setPhase("ready");
      return next;
    } catch (e: any) {
      if (run !== generation.current) return null;
      setData(null);
      if (e.status === 401) setPhase("signedout");
      else if (e.status === 503 || e.status === 404) setPhase("unavailable");
      else { setPhase("error"); setError(programmeErrorMessage(e)); }
      return null;
    }
  }

  function cleanUrl() {
    try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ }
  }

  async function settle(accountKey: string): Promise<string> {
    const res: any = await programmeRequest("/api/programme/settle", withKey(accountKey, jsonBody("POST", { sessionId: sessionRef.current })));
    return res.status;
  }

  async function startCheckout(accountKey: string) {
    const url = await requestCheckout(accountKey, "programme_app");
    window.location.assign(url);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    sessionRef.current = params.get("session_id") || "";
    const returning = params.get("purchase") === "complete" && sessionRef.current !== "";
    buyRef.current = params.get("buy") === "1";
    (async () => {
      let next = await loadState();
      if (!next) return;
      let pending = false;
      if (returning && !next.access.active) {
        try {
          const status = await settle(next.accountKey);
          pending = status === "pending";
          next = (await loadState()) || next;
        } catch (e: any) { setError(programmeErrorMessage(e)); pending = true; }
      }
      if (!pending && (returning || params.has("session_id") || params.has("purchase"))) { sessionRef.current = ""; cleanUrl(); }
      if (buyRef.current) {
        buyRef.current = false;
        cleanUrl();
        if (next.access.active) return;
        if (next.access.status === "pending") { setNotice("Your payment is already being confirmed. Do not pay again."); return; }
        if (!next.sales.open) { setNotice("The programme is not on sale yet. Nothing was charged. The sign-up page has the details."); return; }
        setBusy(true);
        try { await startCheckout(next.accountKey); return; } catch (e: any) { setError(programmeErrorMessage(e)); }
        setBusy(false);
      }
    })();
    return () => { generation.current += 1; };
  }, []);

  async function run(task: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try { await task(); return true; } catch (e: any) {
      if (e.status === 401) { generation.current += 1; setData(null); setPhase("signedout"); }
      else if (e.code === "account_changed") { generation.current += 1; setData(null); setPhase("error"); setError(programmeErrorMessage(e)); }
      else {
        setError(programmeErrorMessage(e));
        if (shouldRefetch(e)) await loadState();
      }
      return false;
    } finally { setBusy(false); }
  }

  async function op(body: any): Promise<any> {
    const res: any = await programmeRequest("/api/programme/progress", withKey(key, jsonBody("POST", { programme: PROGRAMME_ID, baseRevision: progress.revision, op: body, today: today() })));
    setData((d: any) => ({ ...d, progress: res.progress }));
    return res;
  }

  const signIn = () => run(async () => {
    const back = new URLSearchParams(window.location.search).get("buy") === "1" ? "/programme/app/?buy=1" : "/programme/app/";
    const result: any = await programmeRequest("/api/auth/sign-in/social", jsonBody("POST", signInBody(false, back)));
    window.location.assign(trustedRedirect(result.url, "google"));
  });
  const signOut = () => run(async () => {
    await programmeRequest("/api/auth/sign-out", jsonBody("POST", {}));
    generation.current += 1; setData(null); setPhase("signedout");
  });
  const checkAgain = () => run(async () => {
    if (sessionRef.current) {
      const status = await settle(key);
      const next = await loadState();
      if (status !== "pending" || next?.access?.active) { sessionRef.current = ""; cleanUrl(); }
      if (next && !next.access.active) setNotice(status === "pending" ? "Still being confirmed. Nothing is wrong yet. Check again in a minute." : "Your access has not started yet.");
    } else {
      const next = await loadState();
      if (next && !next.access.active) setNotice("Still being confirmed. Check again in a minute.");
    }
  });
  const buyNow = () => run(async () => { await startCheckout(key); });

  const record = (payload: any, addToLog: boolean) => run(async () => {
    const { assistance, ...body } = payload;
    await op({ op: "record", ...body });
    setEpoch((n) => n + 1);
    let text = "Session saved to your account.";
    if (addToLog) {
      const done = appendResultToDeviceLog({ storage: window.localStorage, date: payload.localDate, sets: payload.sets, assistance, setup: payload.setup }, today());
      text += done.ok ? " It was also added to this device's training log." : ` ${deviceLogMessage(done.reason)}`;
    }
    setNotice(text);
  });
  const decide = (week: number, decision: "continue" | "repeat") => run(async () => {
    await op({ op: "review", week, decision });
    setNotice(decision === "repeat" ? `Week ${week} will be repeated. Your earlier results are kept.` : `On to week ${week + 1}.`);
  });
  const enrol = (body: any) => run(async () => { await op(body); setRestarting(false); setEpoch((n) => n + 1); setNotice("Programme started."); });
  const edit = (body: any) => run(async () => { await op(body); setNotice("Result updated."); });
  const discard = (id: string) => run(async () => { await op({ op: "discard", id }); setEpoch((n) => n + 1); setNotice("Result discarded."); });
  const pause = () => run(async () => { await op({ op: "pause" }); setNotice("Paused. Your place is kept."); });
  const resume = () => run(async () => { await op({ op: "resume" }); setNotice("Resumed."); });

  const common: Record<string, string> = progress?.common || {};
  const messages = (
    <>
      <div className="prg-live" role="status" aria-live="polite">{notice}</div>
      {error && <p className="prg-msg is-error" role="alert">{error}</p>}
    </>
  );

  if (phase === "loading") {
    return <div className="prg-app prg-skeleton prg-card" aria-busy="true"><p role="status">Loading your programme.</p></div>;
  }
  if (phase === "unavailable") {
    return (
      <div className="prg-app prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Programme not available</h2>
        <p>The programme is not available right now. Nothing was changed.</p>
        <div className="prg-actions"><button type="button" className="prg-btn" disabled={busy} onClick={() => run(async () => { await loadState(); })}>Try again</button><a className="prg-btn-quiet" href="/programme/">About the programme</a></div>
        {messages}
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="prg-app prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Could not load your programme</h2>
        <p>Nothing was changed.</p>
        <div className="prg-actions"><button type="button" className="prg-btn" disabled={busy} onClick={() => { setError(""); setPhase("loading"); loadState(); }}>Try again</button></div>
        {messages}
      </div>
    );
  }
  if (phase === "signedout") {
    return (
      <div className="prg-app prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Sign in to open your programme</h2>
        <p>Your programme records are kept on your account, not on this device. Signing in is free and does not buy anything.</p>
        <div className="prg-actions"><button type="button" className="prg-btn prg-btn-google" disabled={busy} onClick={signIn}>Sign in with Google</button></div>
        <p className="prg-small">By continuing, you agree to the <a href="/terms/">terms</a> and acknowledge the <a href="/privacy/">privacy policy</a>.</p>
        <p className="prg-small">Want to know what it is first? <a href="/programme/">About the programme</a>.</p>
        {messages}
      </div>
    );
  }

  const access = data.access;
  const header = (
    <div className="prg-head">
      <p className="prg-small" style={{ margin: 0 }}>{data.name}</p>
      <button type="button" className="prg-btn-quiet" disabled={busy} onClick={signOut}>Sign out</button>
    </div>
  );

  if (!access.active) {
    const status = access.status;
    const readOnly = progress?.readOnly ? progress : null;
    return (
      <div className="prg-app prg-stack">
        {header}
        {status === "pending" && (
          <div className="prg-card prg-stack">
            <h2 style={{ margin: 0 }}>Your payment is being confirmed</h2>
            <p>Your access starts as soon as the payment is confirmed. Do not pay again.</p>
            <div className="prg-actions"><button type="button" className="prg-btn" disabled={busy} onClick={checkAgain}>Check again</button></div>
          </div>
        )}
        {(status === "refunded" || status === "disputed") && (
          <div className="prg-card prg-stack">
            <h2 style={{ margin: 0 }}>Access has ended</h2>
            <p>{status === "refunded" ? "This purchase was refunded, so the guided sessions are no longer open." : "This purchase is under dispute with the card provider, so the guided sessions are closed for now."} Your own records below are kept and you can download them from your account.</p>
            <div className="prg-actions"><a className="prg-btn-quiet" href="/account/">Open your account export</a></div>
            {readOnly && <ResultsList results={readOnly.results || []} busy={busy} readOnly />}
          </div>
        )}
        {status === "unverified" && (
          <div className="prg-card prg-stack">
            <h2 style={{ margin: 0 }}>Could not check your purchase</h2>
            <p>Your purchase could not be checked just now. Nothing was changed and nothing was charged.</p>
            <div className="prg-actions"><button type="button" className="prg-btn" disabled={busy} onClick={checkAgain}>Check again</button></div>
          </div>
        )}
        {status === "none" && (
          <div className="prg-card prg-stack">
            <h2 style={{ margin: 0 }}>You do not have this programme yet</h2>
            <p>Read what is in it and what it costs before you decide.</p>
            <div className="prg-actions">
              <a className="prg-btn" href="/programme/">See the programme</a>
              {data.sales?.open && <button type="button" className="prg-btn-quiet" disabled={busy} onClick={buyNow}>Buy for £29</button>}
            </div>
            {data.sales?.open && data.sales.test && <p className="prg-small">Checkout is in test mode, so no real payment is taken.</p>}
          </div>
        )}
        {messages}
      </div>
    );
  }

  const next = progress.next;
  const enrolled = progress.enrolled;
  const paused = enrolled && progress.status === "paused";
  return (
    <div className="prg-app prg-stack">
      {header}
      {messages}
      {!enrolled && <Onboarding key={`on-${epoch}`} progress={progress} busy={busy} restart={false} onEnrol={enrol} />}
      {enrolled && restarting && <Onboarding key={`re-${epoch}`} progress={progress} busy={busy} restart onEnrol={enrol} onCancel={() => setRestarting(false)} />}
      {enrolled && !restarting && paused && (
        <section className="prg-card prg-stack" aria-labelledby="prg-paused-title">
          <h2 id="prg-paused-title" style={{ margin: 0 }}>Paused</h2>
          <p>{common.pause || "Your place is kept."}</p>
          <div className="prg-actions"><button type="button" className="prg-btn" disabled={busy} onClick={resume}>Resume</button></div>
        </section>
      )}
      {enrolled && !restarting && !paused && next.type === "session" && (
        <SessionCard
          key={`${next.session.key}:${progress.weeks.find((w: any) => w.week === next.session.week)?.cycle ?? 0}:${epoch}`}
          session={next.session} baselineSetup={progress.baseline?.setup} common={common} busy={busy} today={today()} onSave={record}
        />
      )}
      {enrolled && !restarting && !paused && next.type === "review" && <ReviewCard review={next.review} busy={busy} onDecide={decide} />}
      {enrolled && !restarting && next.type === "final" && <FinalCard final={next.final} busy={busy} onRestart={() => { setRestarting(true); setEpoch((n) => n + 1); }} />}

      {enrolled && progress.restDay && (
        <p className="prg-msg is-note">Your last session was on {formatLocalDate(progress.restDay.lastDate)}. The plan asks for a rest day between sessions. This is advice only, so you can still record a session.</p>
      )}

      {enrolled && (
        <section className="prg-card prg-stack" aria-labelledby="prg-weeks-title">
          <h2 id="prg-weeks-title" style={{ margin: 0 }}>Your four weeks</h2>
          <div className="prg-weekgrid">
            {progress.weeks.map((w: any) => {
              const done = w.sessions.filter((s: any) => s.done).length;
              const current = next.type === "session" ? next.session.week === w.week : next.type === "review" ? next.review.week === w.week : false;
              return (
                <div className={`prg-weekcell${current ? " is-current" : ""}`} key={w.week}>
                  <div className="prg-small">Week {w.week}{current ? ", now" : ""}</div>
                  <div className="prg-num">{done} of {w.sessions.length}</div>
                  <div className="prg-small">sessions done{w.cycle > 0 ? `, repeat ${w.cycle}` : ""}</div>
                </div>
              );
            })}
          </div>
          {progress.status !== "completed" && (
            <div className="prg-actions">
              {paused ? <button type="button" className="prg-btn-quiet" disabled={busy} onClick={resume}>Resume</button> : <button type="button" className="prg-btn-quiet" disabled={busy} onClick={pause}>Pause the programme</button>}
            </div>
          )}
        </section>
      )}

      {enrolled && (
        <section className="prg-card" aria-labelledby="prg-results-title">
          <h2 id="prg-results-title">Your recorded results</h2>
          <ResultsList results={progress.results} busy={busy} readOnly={false} onEdit={edit} onDiscard={discard} />
        </section>
      )}

      <section className="prg-card prg-stack" aria-labelledby="prg-stop-title">
        <h2 id="prg-stop-title" style={{ margin: 0 }}>If something feels wrong</h2>
        {common.stopSigns && <p>{common.stopSigns}</p>}
        {common.painRoute && <p>{common.painRoute}</p>}
        <p className="prg-small" style={{ margin: 0 }}>More in the <a href="/deadhang-safety/">safety guide</a>.</p>
      </section>
    </div>
  );
}
