import { useEffect, useId, useRef, useState } from "react";
import {
  canResetSchedule,
  nextScheduledDate,
  parseProfile,
  serializeProfile,
  validateProfile,
  PROFILE_MAX_BYTES,
} from "../lib/training-profile.mjs";
import {
  deleteProfile,
  readProfile,
  saveProfile,
  subscribeProfile,
  type ProfileSnapshot,
} from "../lib/training-profile-store";
import type { JourneyDraft, TrainingProfile } from "../lib/training-types";

type Form = {
  version: 1;
  targetSeconds: string | number;
  assistance: string;
  startDate: string;
  weekdays: number[];
  windowWeeks: string | number;
  workSeconds: string | number;
  restSeconds: string | number;
  rounds: string | number;
  prepSeconds: string | number;
};

type Props = {
  draft?: JourneyDraft | null;
  onDraftConsumed?: () => void;
  onProfileChange: (profile: TrainingProfile | null) => void;
  onLoad: (profile: TrainingProfile, unsaved: boolean) => string;
  loadResult?: { requestId: string; accepted: boolean } | null;
  onSaved?: () => void;
};

const date = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const defaults = (): Form => ({
  version: 1,
  targetSeconds: 60,
  assistance: "unassisted",
  startDate: date(),
  weekdays: [1, 4],
  windowWeeks: 4,
  workSeconds: 30,
  restSeconds: 60,
  rounds: 3,
  prepSeconds: 5,
});

const formFromProfile = (profile: TrainingProfile): Form => ({
  ...profile,
  workSeconds: profile.session.workSeconds,
  restSeconds: profile.session.restSeconds,
  rounds: profile.session.rounds,
  prepSeconds: profile.session.prepSeconds,
});

function validatedProfile(form: Form) {
  return validateProfile({
    ...form,
    targetSeconds: Number(form.targetSeconds),
    windowWeeks: Number(form.windowWeeks),
    session: {
      mode: "simple",
      workSeconds: Number(form.workSeconds),
      restSeconds: Number(form.restSeconds),
      rounds: Number(form.rounds),
      prepSeconds: Number(form.prepSeconds),
    },
  });
}

function profilesMatch(form: Form, profile: TrainingProfile | null) {
  const candidate = validatedProfile(form);
  return !!candidate.ok && !!profile && serializeProfile(candidate.profile) === serializeProfile(profile);
}

function stateMessage(snapshot: ProfileSnapshot) {
  if (snapshot.state === "ready") return "Plan saved on this device.";
  if (snapshot.state === "empty") return "No saved plan. Changes stay unsaved until you choose Save plan.";
  return snapshot.error;
}

export default function GoalSetup({
  draft,
  onDraftConsumed,
  onProfileChange,
  onLoad,
  loadResult,
  onSaved,
}: Props) {
  const id = useId();
  const [form, setForm] = useState<Form>(defaults);
  const [persisted, setPersisted] = useState<ProfileSnapshot>({
    raw: null,
    profile: null,
    state: "loading",
    error: "",
  });
  const [remote, setRemote] = useState<ProfileSnapshot | null>(null);
  const [resettingSchedule, setResettingSchedule] = useState(false);
  const [draftVisible, setDraftVisible] = useState(Boolean(draft));
  const [proposalAssistance, setProposalAssistance] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    profile: TrainingProfile;
    snapshot: string | null;
  } | null>(null);
  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const [state, setState] = useState("Loading plan…");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef(form);
  const persistedRef = useRef(persisted);
  const dirtyRef = useRef(false);

  formRef.current = form;
  persistedRef.current = persisted;
  dirtyRef.current = !profilesMatch(form, persisted.profile);

  function applySnapshot(snapshot: ProfileSnapshot) {
    setPersisted(snapshot);
    setRemote(null);
    setResettingSchedule(false);
    setState(stateMessage(snapshot));
    setError("");
    if (snapshot.profile) {
      const next = formFromProfile(snapshot.profile);
      setForm(next);
      formRef.current = next;
      onProfileChange(snapshot.profile);
    } else {
      onProfileChange(null);
    }
  }

  useEffect(() => {
    applySnapshot(readProfile());
    return subscribeProfile(() => {
      const incoming = readProfile();
      if (dirtyRef.current) {
        setRemote(incoming);
        setState("Saved plan changed in another tab. Your unsaved edits are still here for review.");
        return;
      }
      applySnapshot(incoming);
    });
  }, []);

  useEffect(() => {
    if (draft) setDraftVisible(true);
  }, [draft]);

  useEffect(() => {
    if (!loadResult || loadResult.requestId !== pendingLoadId) return;
    setState(
      loadResult.accepted
        ? "Session settings loaded. Start when ready."
        : "The timer refused this load request. Finish or reset the current session, then try again.",
    );
    setPendingLoadId(null);
  }, [loadResult, pendingLoadId]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function update(key: keyof Form, value: Form[keyof Form]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleWeekday(day: number) {
    setForm((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day],
    }));
  }

  function consumeDraft(message: string) {
    setDraftVisible(false);
    onDraftConsumed?.();
    setState(message);
  }

  function applyDraft() {
    if (!draft || !proposalAssistance) {
      setError("Choose assistance before applying this proposed goal.");
      return;
    }
    setForm((current) => ({
      ...current,
      targetSeconds: Math.ceil(draft.targetSeconds),
      assistance: proposalAssistance,
    }));
    setError("");
    consumeDraft("Calculator proposal applied. It is unsaved until you choose Save plan.");
  }

  async function save(useRemoteSnapshot = false) {
    const candidate = validatedProfile(form);
    if (!candidate.ok) {
      setError(candidate.error || "Check the plan settings.");
      return;
    }
    if (
      (persisted.raw === null || resettingSchedule) &&
      !canResetSchedule(form.startDate)
    ) {
      setError("Choose today or a future date when creating or resetting a schedule.");
      return;
    }
    if (
      (persisted.state === "corrupt" || persisted.state === "unsupported") &&
      !confirm(
        "This replaces unreadable saved plan settings. Download a recovery copy first if needed. Continue?",
      )
    )
      return;
    if (
      useRemoteSnapshot &&
      !confirm("Replace the reviewed newer saved plan with these unsaved edits?")
    )
      return;
    const expectedRaw = useRemoteSnapshot ? remote?.raw : persisted.raw;
    if (useRemoteSnapshot && !remote) return;
    const result = await saveProfile(
      candidate.profile as TrainingProfile,
      expectedRaw ?? null,
    );
    if (!result.ok) {
      if (result.reason === "conflict") {
        setRemote(result.snapshot);
        setState("Saved plan changed again. Review it before replacing it.");
      } else {
        setError("Browser storage is unavailable. Your settings are not saved.");
      }
      return;
    }
    applySnapshot(result.snapshot);
    onSaved?.();
  }

  function load() {
    const candidate = validatedProfile(form);
    if (!candidate.ok) {
      setError(candidate.error || "Check the plan settings.");
      return;
    }
    const unsaved = !profilesMatch(form, persisted.profile);
    setPendingLoadId(onLoad(candidate.profile as TrainingProfile, unsaved));
    setState(
      unsaved
        ? "Load request sent from unsaved settings. Waiting for the timer to confirm it."
        : "Load request sent from saved settings. Waiting for the timer to confirm it.",
    );
  }

  async function remove() {
    if (!confirm("Delete only the saved plan? Your training log will stay untouched.")) return;
    const result = await deleteProfile(persisted.raw);
    if (!result.ok) {
      setError("The saved plan changed or storage is unavailable. Review it before deleting.");
      return;
    }
    applySnapshot(result.snapshot);
    setState("Saved plan deleted. Your training log was not changed.");
  }

  async function readImport(file?: File) {
    try {
      if (!file) return;
      if (file.size > PROFILE_MAX_BYTES) {
        setError("Choose a settings file smaller than 4 KB.");
        return;
      }
      const parsed = parseProfile(await file.text());
      if (!parsed.ok || !parsed.profile) {
        setError(parsed.error || "Settings could not be read.");
        return;
      }
      setPendingImport({
        profile: parsed.profile as TrainingProfile,
        snapshot: persistedRef.current.raw,
      });
      setError("");
      setState("Imported settings are ready for review. Nothing has changed yet.");
    } catch {
      setError("Settings could not be read. Nothing has changed.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function applyImport() {
    if (!pendingImport) return;
    if (
      (persisted.state === "corrupt" || persisted.state === "unsupported") &&
      !confirm(
        "This replaces unreadable saved plan settings. Download a recovery copy first if needed. Continue?",
      )
    )
      return;
    const result = await saveProfile(pendingImport.profile, pendingImport.snapshot);
    if (!result.ok) {
      setPendingImport(null);
      if (result.reason === "conflict") {
        setRemote(result.snapshot);
        setState("Saved plan changed while the import was reviewed. Nothing was imported.");
      } else {
        setError("Settings were not imported because browser storage is unavailable.");
      }
      return;
    }
    setPendingImport(null);
    applySnapshot(result.snapshot);
    setState("Reviewed settings imported and saved.");
  }

  function download(name: string, contents: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  const candidate = validatedProfile(form);
  const unsaved = !profilesMatch(form, persisted.profile);

  return (
    <section className="training-workspace" aria-labelledby={`${id}-title`}>
      <div className="tw-panel">
        <h2 id={`${id}-title`} className="tw-panel-title">
          Goal and session setup
        </h2>
        <p className="tw-note">
          Save a plan only if you want it on this device. Loading a session never
          starts the timer or records a hold.
        </p>

        {draft && draftVisible && (
          <section className="tw-warning" aria-label="Calculator proposal">
            <p>
              Calculator proposal: {Math.ceil(draft.targetSeconds)} seconds,
              based on a {draft.holdSeconds}-second hold. This is context only;
              it will not create a log entry.
            </p>
            <fieldset className="tw-settings">
              <legend className="tw-legend">Choose assistance for this goal</legend>
              <label>
                <input
                  type="radio"
                  name={`${id}-proposal-assistance`}
                  checked={proposalAssistance === "unassisted"}
                  onChange={() => setProposalAssistance("unassisted")}
                />{" "}
                Unassisted
              </label>{" "}
              <label>
                <input
                  type="radio"
                  name={`${id}-proposal-assistance`}
                  checked={proposalAssistance === "feet-supported"}
                  onChange={() => setProposalAssistance("feet-supported")}
                />{" "}
                Supported
              </label>
            </fieldset>
            <div className="tw-controls">
              <button type="button" className="dh-btn" onClick={applyDraft}>
                Apply proposed goal
              </button>
              <button
                type="button"
                className="dh-btn dh-btn-ghost"
                onClick={() => consumeDraft("Calculator proposal dismissed. Existing settings are unchanged.")}
              >
                Dismiss proposal
              </button>
            </div>
          </section>
        )}

        <div className="tw-settings-grid" aria-describedby={error ? `${id}-error` : undefined}>
          <label className="tw-field">
            Target seconds
            <input
              className="dh-input"
              value={form.targetSeconds}
              min="1"
              max="3600"
              type="number"
              onChange={(event) => update("targetSeconds", event.target.value)}
            />
          </label>
          <fieldset className="tw-settings">
            <legend className="tw-legend">Assistance</legend>
            <label>
              <input
                type="radio"
                name={`${id}-assistance`}
                checked={form.assistance === "unassisted"}
                onChange={() => update("assistance", "unassisted")}
              />{" "}
              Unassisted
            </label>{" "}
            <label>
              <input
                type="radio"
                name={`${id}-assistance`}
                checked={form.assistance === "feet-supported"}
                onChange={() => update("assistance", "feet-supported")}
              />{" "}
              Supported
            </label>
          </fieldset>
          <label className="tw-field">
            Start date
            <input
              className="dh-input"
              type="date"
              value={form.startDate}
              disabled={persisted.raw !== null && !resettingSchedule}
              onChange={(event) => update("startDate", event.target.value)}
            />
          </label>
          <label className="tw-field">
            Plan length
            <select
              className="dh-input"
              value={form.windowWeeks}
              disabled={persisted.raw !== null && !resettingSchedule}
              onChange={(event) => update("windowWeeks", event.target.value)}
            >
              <option value="4">4 weeks</option>
              <option value="8">8 weeks</option>
              <option value="12">12 weeks</option>
            </select>
          </label>
        </div>
        <fieldset className="tw-settings">
          <legend className="tw-legend">Practice days</legend>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={form.weekdays.includes(index + 1)}
                onChange={() => toggleWeekday(index + 1)}
              />{" "}
              {label}{" "}
            </label>
          ))}
        </fieldset>
        <div className="tw-settings-grid">
          <label className="tw-field">
            Hang seconds
            <input className="dh-input" type="number" min="5" max="120" value={form.workSeconds} onChange={(event) => update("workSeconds", event.target.value)} />
          </label>
          <label className="tw-field">
            Rest seconds
            <input className="dh-input" type="number" min="10" max="300" value={form.restSeconds} onChange={(event) => update("restSeconds", event.target.value)} />
          </label>
          <label className="tw-field">
            Rounds
            <input className="dh-input" type="number" min="1" max="10" value={form.rounds} onChange={(event) => update("rounds", event.target.value)} />
          </label>
          <label className="tw-field">
            Preparation
            <select className="dh-input" value={form.prepSeconds} onChange={(event) => update("prepSeconds", event.target.value)}>
              <option value="0">No countdown</option>
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
            </select>
          </label>
        </div>

        <p className="tw-status" role="status">
          {state} {candidate.ok && `Next planned date: ${nextScheduledDate(candidate.profile) || "none in this window"}.`}
        </p>
        {unsaved && candidate.ok && <p className="tw-note">These settings are unsaved.</p>}
        {error && <p ref={errorRef} id={`${id}-error`} className="tw-error" role="alert" tabIndex={-1}>{error}</p>}
        {(persisted.state === "corrupt" || persisted.state === "unsupported") && (
          <p className="tw-error">Saved plan data was left untouched. Download it before explicitly replacing it.</p>
        )}
        {remote && (
          <div className="tw-warning">
            <p>A newer saved plan is available. Your current edits have not been replaced.</p>
            <div className="tw-controls">
              <button type="button" className="tw-link" onClick={() => applySnapshot(remote)}>Reload saved plan</button>
              <button type="button" className="tw-link" onClick={() => save(true)}>Replace with my reviewed edits</button>
            </div>
          </div>
        )}
        {pendingImport && (
          <div className="tw-warning">
            <p>Review imported settings before saving: {pendingImport.profile.targetSeconds}s target, {pendingImport.profile.assistance}, {pendingImport.profile.session.workSeconds}s hang, {pendingImport.profile.session.restSeconds}s rest, {pendingImport.profile.session.rounds} rounds.</p>
            <div className="tw-controls">
              <button type="button" className="dh-btn" onClick={applyImport}>Apply imported settings</button>
              <button type="button" className="dh-btn dh-btn-ghost" onClick={() => { setPendingImport(null); setState("Import cancelled. Nothing has changed."); }}>Cancel import</button>
            </div>
          </div>
        )}

        <div className="tw-controls">
          {persisted.raw !== null && !resettingSchedule && (
            <button type="button" className="tw-link" onClick={() => { setResettingSchedule(true); update("startDate", date()); }}>
              Reset schedule
            </button>
          )}
          <button type="button" className="dh-btn" onClick={() => save()}>Save plan</button>
          <button type="button" className="dh-btn dh-btn-ghost" onClick={load}>Load session</button>
          <button type="button" className="tw-link" disabled={!persisted.profile} onClick={() => persisted.profile && download("deadhangs-training-plan.json", serializeProfile(persisted.profile))}>
            Export saved settings
          </button>
          {(persisted.state === "corrupt" || persisted.state === "unsupported") && persisted.raw !== null && (
            <button type="button" className="tw-link" onClick={() => download("deadhangs-plan-recovery.json", persisted.raw!)}>Download recovery copy</button>
          )}
          <button type="button" className="tw-link" onClick={() => fileRef.current?.click()}>Import settings</button>
          <input ref={fileRef} id={`${id}-import`} className="tw-visually-hidden" type="file" aria-label="Import settings file" accept="application/json" onChange={(event) => { void readImport(event.target.files?.[0]); }} />
          {persisted.raw !== null && <button type="button" className="tw-link tw-link-danger" onClick={remove}>Delete plan</button>}
        </div>
      </div>
    </section>
  );
}
