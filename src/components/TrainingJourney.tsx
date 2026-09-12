import { useCallback, useEffect, useRef, useState } from "react";
import HangTimer from "./HangTimer";
import GoalSetup from "./GoalSetup";
import TrainingWorkspace from "./TrainingWorkspace";
import ProgressSummary from "./ProgressSummary";
import { clearDraft, readDraft } from "../lib/journey-draft.mjs";
import { trackTrainingEvent, trackTrainingToolView } from "../scripts/training-events.js";
import type { TimerLoad, TrainingProfile } from "../lib/training-types";
export default function TrainingJourney() {
  const [draft, setDraft] = useState<any>(null),
    [draftNotice, setDraftNotice] = useState(""),
    [profile, setProfile] = useState<TrainingProfile | null>(null),
    [request, setRequest] = useState<TimerLoad | null>(null),
    [loadResult, setLoadResult] = useState<{ requestId: string; accepted: boolean } | null>(null),
    [entries, setEntries] = useState<any[]>([]),
    holdRef = useRef<() => void>(() => {});
  useEffect(() => {
    const d = readDraft();
    if (d.ok) {
      setDraft(d.draft);
    } else if (d.state !== "empty") {
      setDraftNotice(d.error || "Calculator handoff could not be read.");
    }
    trackTrainingToolView({ source: "workspace" });
  }, []);
  const load = useCallback((p: TrainingProfile) => {
    const requestId = crypto.randomUUID();
    setLoadResult(null);
    setRequest({
      requestId,
      config: {
        mode: p.session.mode,
        workSeconds: p.session.workSeconds,
        restSeconds: p.session.restSeconds,
        rounds: p.session.rounds,
        prepSeconds: p.session.prepSeconds,
      },
    });
    return requestId;
  }, []);
  const handleLoadResult = useCallback((result: { requestId: string; accepted: boolean }) => {
    setLoadResult(result);
    if (result.accepted)
      trackTrainingEvent("training_session_loaded", { source: "workspace" });
  }, []);
  const trackGoalSaved = useCallback(() => {
    trackTrainingEvent("training_goal_saved", { source: "workspace" });
  }, []);
  const trackTimerStarted = useCallback((mode: string) => {
    trackTrainingEvent("training_timer_started", { source: "workspace", mode });
  }, []);
  const trackTimerFinished = useCallback((mode: string) => {
    trackTrainingEvent("training_timer_finished", { source: "workspace", mode });
  }, []);
  const focusActualHold = useCallback(() => {
    holdRef.current();
  }, []);
  const trackManualEntrySaved = useCallback(() => {
    trackTrainingEvent("training_log_saved", { source: "workspace" });
  }, []);
  return (
    <div className="training-journey">
      <GoalSetup
        draft={draft}
        onDraftConsumed={() => {
          clearDraft();
          setDraft(null);
        }}
        onProfileChange={setProfile}
        onLoad={load}
        loadResult={loadResult}
        onSaved={trackGoalSaved}
      />
      {draftNotice && <p className="tw-note" role="status">{draftNotice}</p>}
      <HangTimer
        loadRequest={request}
        onLoadResult={handleLoadResult}
        onStart={trackTimerStarted}
        onFinished={trackTimerFinished}
        onResultReady={focusActualHold}
      />
      <TrainingWorkspace
        showTimer={false}
        onEntriesChange={setEntries}
        onManualEntrySaved={trackManualEntrySaved}
        registerActualFocus={(fn) => {
          holdRef.current = fn;
        }}
      />
      <ProgressSummary entries={entries} profile={profile} />
    </div>
  );
}
