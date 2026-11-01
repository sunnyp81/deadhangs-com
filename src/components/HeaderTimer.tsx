import { useEffect, useRef, useState } from "react";
import {
  HEADER_HOLD_SECONDS,
  clock,
  elapsedSeconds,
  isFinished,
  logHref,
  remainingWhole,
  ringFraction,
} from "../lib/header-timer.mjs";
import { trackTrainingEvent } from "../scripts/training-events.js";

type Phase = "ready" | "running" | "stopped" | "done";

const SIZE = 72;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const TICKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
  const inner = R - (i % 3 === 0 ? 10 : 7);
  const outer = R - 3.5;
  return {
    i,
    major: i % 3 === 0,
    x1: SIZE / 2 + Math.cos(a) * inner,
    y1: SIZE / 2 + Math.sin(a) * inner,
    x2: SIZE / 2 + Math.cos(a) * outer,
    y2: SIZE / 2 + Math.sin(a) * outer,
  };
});

export default function HeaderTimer() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [announce, setAnnounce] = useState("");
  const startRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clear = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => clear, []);

  function start() {
    clear();
    startRef.current = Date.now();
    setElapsed(0);
    setPhase("running");
    setAnnounce(`Timer started. ${HEADER_HOLD_SECONDS} seconds.`);
    trackTrainingEvent("feature_used", { feature: "header_timer_started", source: "article_header" } as never);
    timerRef.current = window.setInterval(() => {
      const e = elapsedSeconds(startRef.current, Date.now());
      setElapsed(e);
      if (isFinished(e)) {
        clear();
        setPhase("done");
        setAnnounce(`Done. ${HEADER_HOLD_SECONDS} second hold finished.`);
      }
    }, 100);
  }

  function stop() {
    clear();
    const e = elapsedSeconds(startRef.current, Date.now());
    setElapsed(e);
    setPhase("stopped");
    setAnnounce(`Stopped after ${Math.floor(e)} seconds.`);
  }

  const running = phase === "running";
  const finished = phase === "done";
  const stopped = phase === "stopped";
  // Reduced motion is handled in CSS: the arc keeps its transition only when motion is allowed.
  const fraction = phase === "ready" ? 1 : ringFraction(elapsed);
  const href = logHref(elapsed);
  const digits = finished ? "Done" : clock(phase === "ready" ? HEADER_HOLD_SECONDS : remainingWhole(elapsed));

  return (
    <div className="ht" data-phase={phase}>
      <svg className="ht-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-border)" strokeWidth={STROKE} />
        {TICKS.map((t) => (
          <line key={t.i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--color-text-muted)" strokeWidth={t.major ? 2 : 1.3} />
        ))}
        <circle
          className="ht-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ opacity: fraction > 0 ? 1 : 0 }}
        />
        <text className={finished ? "ht-digits ht-done" : "ht-digits"} x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="var(--color-text)">
          {digits}
        </text>
      </svg>
      <div className="ht-side">
        <div className="ht-row">
          {running ? (
            <button type="button" className="ht-btn ht-btn-ghost" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="ht-btn" onClick={start} aria-label={phase === "ready" ? `Start ${HEADER_HOLD_SECONDS} second timer` : `Start ${HEADER_HOLD_SECONDS} second timer again`}>
              {finished || stopped ? "Again" : "Start"}
            </button>
          )}
          {(finished || stopped) && href && (
            <a className="ht-log" href={href}>
              Log this hold
            </a>
          )}
        </div>
        <a className="ht-full" href="/training-log/">
          Full timer and log
        </a>
      </div>
      <p className="ht-sr" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
