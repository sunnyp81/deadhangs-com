import { useEffect, useId, useMemo, useState } from "react";
import { parseStoredLog, STORAGE_KEY } from "../lib/training-log.mjs";
import { progressFor } from "../lib/training-progress.mjs";

type Entry = { id: string; date: string; seconds: number; assistance: "unassisted" | "feet-supported"; sets: number };
type Assistance = Entry["assistance"];

function readEntries(): Entry[] {
  try {
    const parsed = parseStoredLog(window.localStorage.getItem(STORAGE_KEY));
    return parsed.status === "ok" || parsed.status === "empty" ? parsed.entries : [];
  } catch {
    return [];
  }
}

export default function PracticeGraph() {
  const uid = useId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [windowDays, setWindowDays] = useState<30 | 90>(90);
  const [assistance, setAssistance] = useState<Assistance>("unassisted");
  const [revealed, setRevealed] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setEntries(readEntries());
    update();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) update();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("deadhangs:training-log-updated", update);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("deadhangs:training-log-updated", update);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const timer = window.setTimeout(() => setRevealed(true), 80);
    return () => window.clearTimeout(timer);
  }, [windowDays, assistance, entries.length]);

  const daily = useMemo(
    () => progressFor(entries, assistance, null, new Date(), windowDays).selectedWindow,
    [entries, assistance, windowDays],
  );
  const chart = useMemo(() => {
    const width = 920, height = 290, pad = { left: 46, right: 22, top: 18, bottom: 42 };
    const values = daily.map((entry) => entry.seconds);
    const min = Math.max(0, Math.floor((Math.min(...values, 10) - 5) / 5) * 5);
    const max = Math.max(15, Math.ceil((Math.max(...values, 15) + 5) / 5) * 5);
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const x = (index: number) => daily.length === 1 ? pad.left + plotWidth / 2 : pad.left + (index / (daily.length - 1)) * plotWidth;
    const y = (value: number) => pad.top + plotHeight - ((value - min) / Math.max(1, max - min)) * plotHeight;
    const path = daily.map((entry, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(entry.seconds).toFixed(1)}`).join(" ");
    const area = path ? `${path} L${x(daily.length - 1)},${pad.top + plotHeight} L${x(0)},${pad.top + plotHeight} Z` : "";
    return { width, height, pad, min, max, plotWidth, plotHeight, x, y, path, area };
  }, [daily]);
  const active = activeIndex === null ? daily.at(-1) : daily[activeIndex];
  const label = assistance === "feet-supported" ? "supported" : "unassisted";
  const ticks = [chart.min, Math.round((chart.min + chart.max) / 2), chart.max];

  return (
    <section className="practice-graph" aria-labelledby={`${uid}-title`}>
      <div className="practice-graph-heading">
        <div>
          <p className="dh-eyebrow">Live from your training log</p>
          <h2 id={`${uid}-title`} className="dh-display">Your practice trend.</h2>
          <p>Daily bests only. Compare the same assistance type before drawing a conclusion.</p>
        </div>
        <a className="text-link" href="/training-log/">Open full log →</a>
      </div>
      <div className="practice-graph-controls">
        <fieldset>
          <legend>Assistance</legend>
          {(["unassisted", "feet-supported"] as const).map((value) => (
            <label key={value}>
              <input type="radio" name={`${uid}-assistance`} checked={assistance === value} onChange={() => setAssistance(value)} />
              {value === "unassisted" ? "Unassisted" : "Supported"}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Window</legend>
          {[30, 90].map((value) => (
            <label key={value}>
              <input type="radio" name={`${uid}-window`} checked={windowDays === value} onChange={() => setWindowDays(value as 30 | 90)} />
              {value} days
            </label>
          ))}
        </fieldset>
      </div>
      {daily.length ? (
        <>
          <div className="practice-graph-canvas" role="group" aria-label={`${windowDays}-day ${label} hold-time graph`}>
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-labelledby={`${uid}-svg-title ${uid}-svg-desc`}>
              <title id={`${uid}-svg-title`}>Your {label} hold trend</title>
              <desc id={`${uid}-svg-desc`}>Daily best dead-hang holds in seconds from your on-device training log.</desc>
              <defs>
                <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity=".26" />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((tick) => <g key={tick}>
                <line x1={chart.pad.left} x2={chart.pad.left + chart.plotWidth} y1={chart.y(tick)} y2={chart.y(tick)} className="practice-graph-grid" />
                <text x={chart.pad.left - 10} y={chart.y(tick) + 4} textAnchor="end" className="practice-graph-axis">{tick}s</text>
              </g>)}
              <path className="practice-graph-area" d={chart.area} fill={`url(#${uid}-area)`} style={{ opacity: revealed ? 1 : 0 }} />
              <path className="practice-graph-line" d={chart.path} style={{ strokeDasharray: `${Math.max(1, chart.path.length * 1.45)}`, strokeDashoffset: revealed ? 0 : Math.max(1, chart.path.length * 1.45) }} />
              {daily.map((entry, index) => <circle key={entry.date} tabIndex={0} role="button" aria-label={`${entry.date}, ${entry.seconds} seconds`} className="practice-graph-point" cx={chart.x(index)} cy={chart.y(entry.seconds)} r={activeIndex === index ? 6 : 4} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => setActiveIndex(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveIndex(index); } }} />)}
              {active && <g aria-hidden="true" className="practice-graph-callout" transform={`translate(${Math.min(chart.x(activeIndex ?? daily.length - 1) + 12, chart.width - 116)}, ${Math.max(chart.y(active.seconds) - 42, 8)})`}>
                <rect width="104" height="34" rx="3" />
                <text x="8" y="13">{active.date}</text>
                <text x="8" y="27">{active.seconds}s daily best</text>
              </g>}
            </svg>
          </div>
          <p className="practice-graph-summary" aria-live="polite">{daily.length} recorded {daily.length === 1 ? "day" : "days"} in this view. Focus a point to inspect a day.</p>
        </>
      ) : (
        <div className="practice-graph-empty">
          <svg viewBox="0 0 920 180" aria-hidden="true"><path d="M34,136 C190,124 220,94 390,102 S670,54 886,40" /><circle cx="34" cy="136" r="4" /><circle cx="886" cy="40" r="4" /></svg>
          <p>No {label} holds in the last {windowDays} days yet.</p>
          <a href="/training-log/" className="dh-btn">Record your first hold</a>
        </div>
      )}
    </section>
  );
}
