import { useEffect, useId, useState } from "react";
import { useMemo } from "react";
import { filterBySetup, listSetups } from "../lib/training-log.mjs";
import { progressFor } from "../lib/training-progress.mjs";
import type { LogEntry, TrainingProfile } from "../lib/training-types";

type Entry = LogEntry;
type Assistance = "unassisted" | "feet-supported";

export default function ProgressSummary({ entries, profile }: { entries: Entry[]; profile: TrainingProfile | null }) {
  const id = useId();
  const [assistance, setAssistance] = useState<Assistance>(profile?.assistance || "unassisted");
  const [windowDays, setWindowDays] = useState<30 | 90>(90);
  const [setupKey, setSetupKey] = useState("all");
  useEffect(() => {
    setAssistance(profile?.assistance || "unassisted");
  }, [profile?.assistance]);
  const target = profile?.assistance === assistance ? profile.targetSeconds : null;
  const setups = useMemo(() => listSetups(entries, assistance) as { key: string; label: string; count: number }[], [entries, assistance]);
  const activeSetup = setupKey !== "all" && setups.some((group) => group.key === setupKey) ? setupKey : "all";
  const progress = progressFor(filterBySetup(entries, activeSetup), assistance, target, new Date(), windowDays);
  const assistanceLabel = assistance === "feet-supported" ? "supported" : "unassisted";

  return (
    <section className="training-workspace" aria-labelledby={`${id}-title`}>
      <div className="tw-panel">
        <h2 id={`${id}-title`} className="tw-panel-title">Comparable progress</h2>
        <div className="tw-settings-grid">
          <fieldset className="tw-settings">
            <legend className="tw-legend">Compare assistance</legend>
            <label><input type="radio" name={`${id}-assistance`} checked={assistance === "unassisted"} onChange={() => setAssistance("unassisted")} /> Unassisted</label>{" "}
            <label><input type="radio" name={`${id}-assistance`} checked={assistance === "feet-supported"} onChange={() => setAssistance("feet-supported")} /> Supported</label>
          </fieldset>
          <fieldset className="tw-settings">
            <legend className="tw-legend">Calendar window</legend>
            <label><input type="radio" name={`${id}-window`} checked={windowDays === 30} onChange={() => setWindowDays(30)} /> Last 30 days</label>{" "}
            <label><input type="radio" name={`${id}-window`} checked={windowDays === 90} onChange={() => setWindowDays(90)} /> Last 90 days</label>
          </fieldset>
          <div className="tw-field">
            <label htmlFor={`${id}-setup`}>Compare setup</label>
            <select id={`${id}-setup`} className="dh-input" value={activeSetup} onChange={(event) => setSetupKey(event.target.value)}>
              <option value="all">All {assistanceLabel} setups</option>
              {setups.map((group) => <option key={group.key} value={group.key}>{group.label} ({group.count})</option>)}
            </select>
          </div>
        </div>
        {!progress.daily.length ? (
          <p className="tw-empty">No comparable {assistanceLabel} entries yet. Save an actual hold to start a record.</p>
        ) : (
          <>
            <div className="tw-bests">
              <div className="tw-best"><span>Latest recorded hold</span><strong className="tw-best-value">{progress.latest?.seconds}s</strong></div>
              <div className="tw-best"><span>All-time best</span><strong className="tw-best-value">{progress.allTimeBest}s</strong></div>
              <div className="tw-best"><span>Recorded practice days this week</span><strong className="tw-best-value">{progress.practiceDaysThisWeek}</strong></div>
              <div className="tw-best"><span>Recorded change in this window</span><strong className="tw-best-value">{progress.windowChange === null ? "Need two dates" : `${progress.windowChange >= 0 ? "+" : ""}${progress.windowChange}s`}</strong></div>
            </div>
            {progress.targetSeconds && progress.latest && (
              <div className="tw-goal" aria-label={`Goal comparison: latest ${progress.latest.seconds} seconds of ${progress.targetSeconds} seconds`}>
                <span>Goal comparison: {progress.latest.seconds}s / {progress.targetSeconds}s</span>
                <div className="tw-goal-track" aria-hidden="true"><div className="tw-goal-fill" style={{ width: `${progress.visualTargetPercent}%` }} /></div>
              </div>
            )}
            <p className="tw-note">Daily bests cover {progress.windowStart} through today. {activeSetup === "all" ? "Choose a setup to compare holds on the same bar, grip, chalk and load." : "Showing one setup only."} Compared only with your own holds.</p>
            <div className="tw-table-wrap" tabIndex={0} aria-label="Scrollable progress table">
              <table className="tw-table">
                <caption>Daily best {assistanceLabel} holds in the last {windowDays} calendar days</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Daily best</th></tr></thead>
                <tbody>{progress.selectedWindow.map((entry) => <tr key={entry.date}><td>{entry.date}</td><td>{entry.seconds}s</td></tr>)}</tbody>
              </table>
            </div>
            {!progress.selectedWindow.length && <p className="tw-empty">No comparable entries fall within this calendar window.</p>}
          </>
        )}
      </div>
    </section>
  );
}
