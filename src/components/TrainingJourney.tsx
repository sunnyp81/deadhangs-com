import { useCallback, useEffect, useRef, useState } from "react";
import HangTimer from "./HangTimer";
import GoalSetup from "./GoalSetup";
import TrainingWorkspace from "./TrainingWorkspace";
import ProgressSummary from "./ProgressSummary";
import { clearDraft, readDraft } from "../lib/journey-draft.mjs";
import { parseTimerParams } from "../lib/timer-preset.mjs";
import { parseSessionParam, starterTimerLoad } from "../lib/next-session.mjs";
import { trackFeature, trackTrainingEvent, trackTrainingToolView } from "../scripts/training-events.js";
import type { TimerLoad, TrainingProfile } from "../lib/training-types";
export default function TrainingJourney() {
  const [draft, setDraft] = useState<any>(null),
    [draftNotice, setDraftNotice] = useState(""),
    [profile, setProfile] = useState<TrainingProfile | null>(null),
    [request, setRequest] = useState<TimerLoad | null>(null),
    [loadResult, setLoadResult] = useState<{ requestId: string; accepted: boolean } | null>(null),
    [entries, setEntries] = useState<any[]>([]),
    [planOpen, setPlanOpen] = useState(false),
    [starter, setStarter] = useState<ReturnType<typeof parseSessionParam>>(null),
    [acceptedPlan, setAcceptedPlan] = useState<{ requestId: string; assistance: string } | null>(null),
    holdRef = useRef<() => void>(() => {}),
    pendingPlanRef = useRef<{ requestId: string; assistance: string } | null>(null),
    starterRequestRef = useRef<string | null>(null);
  useEffect(() => {
    const d = readDraft();
    if (d.ok) {
      setDraft(d.draft);
      setPlanOpen(true);
    } else if (d.state !== "empty") {
      setDraftNotice(d.error || "Calculator handoff could not be read.");
    }
    trackTrainingToolView({ source: "workspace" });
    // ?session=level-N opens a starter for review. Nothing starts until the user taps Start.
    const chosen = parseSessionParam(window.location.search);
    const chosenLoad = starterTimerLoad(chosen);
    const preset = chosenLoad ? null : parseTimerParams(window.location.search);
    if (chosen && chosenLoad) {
      const requestId = crypto.randomUUID();
      starterRequestRef.current = requestId;
      setStarter(chosen);
      setRequest({ requestId, ...chosenLoad } as TimerLoad);
    } else if (preset) {
      setRequest({ requestId: crypto.randomUUID(), ...preset });
      trackFeature("preset_link_opened");
    }
  }, []);
  const load = useCallback((p: TrainingProfile) => {
    const requestId = crypto.randomUUID();
    setLoadResult(null);
    pendingPlanRef.current = { requestId, assistance: p.assistance };
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
    // A starter arriving from the by-age card is the reliable arrival count for next_session_chosen.
    if (result.accepted) {
      if (pendingPlanRef.current?.requestId === result.requestId) {
        setStarter(null);
        setAcceptedPlan(pendingPlanRef.current);
        pendingPlanRef.current = null;
      }
      trackTrainingEvent("training_session_loaded", {
        source: result.requestId === starterRequestRef.current ? "chosen_session" : "workspace",
      });
    }
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
      <section className="today-session" aria-labelledby="today-session-title">
        <h2 id="today-session-title">Today&rsquo;s session</h2>
        {draftNotice && <p className="tw-note" role="status">{draftNotice}</p>}
        {starter && (
          <div className="chosen-session" role="region" aria-labelledby="chosen-session-title">
            <p className="chosen-session-name" id="chosen-session-title">{starter.name}</p>
            <p className="small-copy">
              {starter.how}{" "}<a className="text-link" href="/deadhang-safety/#stop-and-step-down">Stop rules</a>.
            </p>
          </div>
        )}
        <HangTimer
          loadRequest={request}
          onLoadResult={handleLoadResult}
          onStart={trackTimerStarted}
          onFinished={trackTimerFinished}
          onResultReady={focusActualHold}
          onTestSaved={trackManualEntrySaved}
        />
        {starter && <p className="small-copy">Review the intervals, then tap Start when ready. After training, record the holds you actually did below. Cannot hang yet? Use the <a className="text-link" href="/beginner-deadhang/#cant-hang-yet">beginner ladder</a>.</p>}
      </section>
      <TrainingWorkspace
        showTimer={false}
        proNudges
        funnelSource={starter ? "chosen_session" : "workspace"}
        acceptedPlan={acceptedPlan}
        onEntriesChange={setEntries}
        onManualEntrySaved={trackManualEntrySaved}
        registerActualFocus={(fn) => {
          holdRef.current = fn;
        }}
      />
      <details
        className="plan-disclosure"
        open={planOpen}
        onToggle={(event) => setPlanOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Plan future sessions</summary>
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
      </details>
      <ProgressSummary entries={entries} profile={profile} proNudges />
    </div>
  );
}
