import { useEffect, useId, useState } from "react";
import { progressFor } from "../lib/training-progress.mjs";
import type { TrainingProfile } from "../lib/training-types";

type Entry = { id: string; date: string; seconds: number; assistance: string; sets: number };
type Assistance = "unassisted" | "feet-supported";

export default function ProgressSummary({ entries, profile }: { entries: Entry[]; profile: TrainingProfile | null }) {
  const id = useId();
  const [assistance, setAssistance] = useState<Assistance>(profile?.assistance || "unassisted");
  const [windowDays, setWindowDays] = useState<30 | 90>(90);
  useEffect(() => {
    setAssistance(profile?.assistance || "unassisted");
  }, [profile?.assistance]);
  const target = profile?.assistance === assistance ? profile.targetSeconds : null;
  const progress = progressFor(entries, assistance, target, new Date(), windowDays);
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
            <p className="tw-note">Daily bests cover {progress.windowStart} through today. Compare holds using a similar bar and grip; the log does not record that setup.</p>
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
