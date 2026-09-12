import { useState, useEffect, useRef, useMemo } from "react";
import { browserFeedbackAdapters, createFeedbackLifecycle } from "../lib/timer-feedback.mjs";
import { activeTestElapsed, isBusy, normalizeLegacyTimerConfig, validTimerLoad } from "../lib/timer-state.mjs";
import type { TimerConfig, TimerLoad, TimerRunState } from "../lib/training-types";
import { trackTrainingEvent, trackTrainingToolView } from "../scripts/training-events.js";

function fmtTime(s: number) {
  const seconds = Math.max(0, Math.ceil(s));
  const m = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function fmtTestTime(seconds: number) {
  const safe = Math.min(3600, Math.max(0, seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}
function beep(
  freq = 880,
  dur = 0.12,
  type: OscillatorType = "sine",
  vol = 0.06,
) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = ((window as any).__dhAudio ||= new Ctx());
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch {}
}

function Stepper({
  label,
  value,
  setValue,
  min,
  max,
  step = 1,
  unit = "",
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const btnStyle: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    transition: "background 160ms, color 160ms, transform 160ms",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".14em",
          color: "var(--color-text-muted)",
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => setValue(Math.max(min, value - step))}
          style={btnStyle}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          −
        </button>
        <span
          className="dh-mono"
          style={{
            minWidth: 36,
            textAlign: "center",
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          {value}
          {unit}
        </span>
        <button
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => setValue(Math.min(max, value + step))}
          style={btnStyle}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          +
        </button>
      </div>
    </div>
  );
}

function Seg({
  value,
  setValue,
  options,
}: {
  value: string;
  setValue: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--color-bg)",
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-sm)",
        padding: 3,
        gap: 2,
      }}
    >
      {options.map(([v, l]) => (
        <button
          key={v}
          aria-pressed={v === value}
          onClick={() => setValue(v)}
          style={{
            border: 0,
            padding: "8px 14px",
            borderRadius: 4,
            background: v === value ? "var(--color-primary)" : "transparent",
            color:
              v === value
                ? "var(--color-text-inverse)"
                : "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: ".1em",
            textTransform: "uppercase" as const,
            cursor: "pointer",
            fontWeight: 600,
            transition: "all 160ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function HangTimer({
  initialWork = 30,
  initialRest = 60,
  rounds: initialRounds = 3,
  loadRequest,
  onLoadResult,
  onStart,
  onFinished,
  onResultReady,
  onRunState,
  feedbackAdapters,
  analyticsSource,
}: {
  initialWork?: number;
  initialRest?: number;
  rounds?: number;
  loadRequest?: TimerLoad | null;
  onLoadResult?: (result: { requestId: string; accepted: boolean }) => void;
  onStart?: (mode: string) => void;
  onFinished?: (mode: string) => void;
  onResultReady?: () => void;
  onRunState?: (state: TimerRunState) => void;
  feedbackAdapters?: Parameters<typeof createFeedbackLifecycle>[0];
  analyticsSource?: "calculator" | "plans" | "workspace" | "home" | "shared" | "embed";
}) {
  const [hydrated, setHydrated] = useState(false);
  const deadline = useRef(0);
  const lastRemaining = useRef(initialWork);
  const [notice, setNotice] = useState("");
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (analyticsSource) trackTrainingToolView({ source: analyticsSource });
  }, [analyticsSource]);
  const [work, setWork] = useState(initialWork);
  const [rest, setRest] = useState(initialRest);
  const [rounds, setRounds] = useState(initialRounds);
  const [phase, setPhase] = useState<
    "idle" | "prep" | "work" | "rest" | "test" | "done"
  >("idle");
  const [round, setRound] = useState(1);
  const [t, setT] = useState(initialWork);
  const [running, setRunning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [mode, setMode] = useState<"simple" | "emom" | "ladder" | "test">(
    "simple",
  );
  const totalRef = useRef(initialWork);
  const [pulse, setPulse] = useState(false);
  const [totalHangTime, setTotalHangTime] = useState(0);
  const [prep, setPrep] = useState<0 | 5 | 10>(0);
  const seenRequest = useRef(new Set<string>());
  const testElapsed = useRef(0);
  const testRunStart = useRef<number | null>(null);
  const phaseRef = useRef<TimerRunState["phase"]>("idle");
  const [voiceOn, setVoiceOn] = useState(false);
  const [awakeRequested, setAwakeRequested] = useState(false);
  const [wakeStatus, setWakeStatus] = useState("off");
  const [wakeTouched, setWakeTouched] = useState(false);
  const feedbackRef = useRef<ReturnType<typeof createFeedbackLifecycle> | null>(null);

  phaseRef.current = phase;

  useEffect(() => {
    onRunState?.({ phase, running, mode });
  }, [mode, onRunState, phase, running]);

  useEffect(() => {
    const lifecycle = createFeedbackLifecycle(
      feedbackAdapters || browserFeedbackAdapters(),
      setWakeStatus,
    );
    feedbackRef.current = lifecycle;
    lifecycle.setWakeOptIn(awakeRequested);
    lifecycle.setRunning(running);
    return () => {
      lifecycle.dispose();
      if (feedbackRef.current === lifecycle) feedbackRef.current = null;
    };
  }, [feedbackAdapters]);

  useEffect(() => {
    feedbackRef.current?.setWakeOptIn(awakeRequested);
  }, [awakeRequested]);

  useEffect(() => {
    feedbackRef.current?.setRunning(running);
  }, [running]);

  useEffect(() => {
    const onPageHide = () => feedbackRef.current?.dispose();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      feedbackRef.current?.dispose();
    };
  }, []);

  function releaseFeedback() {
    feedbackRef.current?.stop();
  }

  function transitionCue(text: string, fallback: () => void) {
    feedbackRef.current?.cue(text, {
      voice: voiceOn,
      sound: soundOn,
      beep: fallback,
    });
  }

  function currentTestElapsed(now = performance.now()) {
    return activeTestElapsed(testElapsed.current, testRunStart.current, now);
  }

  function pauseTest() {
    const elapsed = currentTestElapsed();
    testElapsed.current = elapsed;
    testRunStart.current = null;
    setT(Math.floor(elapsed * 10) / 10);
    setRunning(false);
    releaseFeedback();
    return elapsed;
  }

  function finishTest() {
    const elapsed = running ? pauseTest() : testElapsed.current;
    releaseFeedback();
    const shown = Math.floor(elapsed * 10) / 10;
    setT(shown);
    setPhase("done");
    setRunning(false);
    transitionCue("Finish", () => beep(330, 0.3, "square", 0.08));
    if (shown < 1) {
      setNotice("Test stopped before one second. No hold was recorded.");
      return;
    }
    setNotice(`Test stopped at ${fmtTestTime(shown)}. Record only your actual hold.`);
  }

  const ladderWork = useMemo(() => {
    if (mode !== "ladder") return work;
    return Math.min(work + (round - 1) * 5, 120);
  }, [mode, work, round]);

  const currentWork = mode === "ladder" ? ladderWork : work;

  useEffect(() => {
    if (!running) return;
    let announcedSecond = Math.ceil(lastRemaining.current);
    function tick() {
      if (phase === "test") {
        const elapsed = currentTestElapsed();
        if (elapsed >= 3600) {
          testElapsed.current = 3600;
          testRunStart.current = null;
          setT(3600);
          setPhase("done");
          setRunning(false);
          releaseFeedback();
          transitionCue("Finish", () => beep(330, 0.3, "square", 0.08));
          setNotice(
            "Test stopped at 60:00.0, the 60-minute limit. Record only your actual hold.",
          );
          return;
        }
        setT(Math.floor(elapsed * 10) / 10);
        return;
      }
      const remaining = Math.max(
        0,
        (deadline.current - performance.now()) / 1000,
      );
      const elapsed = Math.max(0, lastRemaining.current - remaining);
      if (phase === "work") setTotalHangTime((h) => h + elapsed);
      lastRemaining.current = remaining;
      setT(remaining);
      const second = Math.ceil(remaining);
      if (second !== announcedSecond && second > 0 && second <= 3) {
        setPulse(true);
        if (soundOn) beep(660, 0.08);
      }
      announcedSecond = second;
      if (remaining > 0) return;
      clearInterval(id);
      setPulse(false);
      if (phase === "work" && round >= rounds) {
        setPhase("done");
        setRunning(false);
        setNotice(
          "Session complete. Record your actual holds in the training log; nothing was saved automatically.",
        );
        onFinished?.(mode);
        if (analyticsSource)
          trackTrainingEvent("training_timer_finished", {
            source: analyticsSource,
            mode,
          });
        releaseFeedback();
        transitionCue("Finish", () => beep(330, 0.3, "square", 0.08));
        return;
      }
      const nextSeconds =
        phase === "prep"
          ? mode === "test"
            ? 0
            : work
          : phase === "work"
            ? mode === "emom"
              ? 60 - currentWork
              : rest
            : mode === "ladder"
              ? Math.min(work + round * 5, 120)
              : work;
      totalRef.current = nextSeconds;
      lastRemaining.current = nextSeconds;
      deadline.current = performance.now() + nextSeconds * 1000;
      setT(nextSeconds);
      if (phase === "prep") {
        setPhase(mode === "test" ? "test" : "work");
        if (mode === "test") testRunStart.current = performance.now();
        transitionCue("Start", () => beep(880, 0.2, "square", 0.08));
      } else if (phase === "work") {
        setPhase("rest");
        transitionCue("Rest", () => beep(330, 0.3, "square", 0.08));
      } else {
        setPhase("work");
        setRound((r) => r + 1);
        transitionCue("Start", () => beep(880, 0.2, "square", 0.08));
      }
    }
    const id = window.setInterval(tick, 50);
    function onVisibility() {
      if (document.hidden) {
        pause();
        setNotice(
          "Timer paused because this page was hidden. Resume when you are ready.",
        );
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    running,
    phase,
    work,
    rest,
    round,
    rounds,
    soundOn,
    mode,
    currentWork,
    onFinished,
    onResultReady,
  ]);

  useEffect(() => {
    if (pulse) {
      const id = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(id);
    }
  }, [pulse]);

  function acknowledgeLoad(requestId: string, accepted: boolean) {
    onLoadResult?.({ requestId, accepted });
    window.dispatchEvent(
      new CustomEvent("loadProtocolResult", {
        detail: { requestId, accepted },
      }),
    );
  }

  function applyLoad(load: TimerLoad) {
    if (seenRequest.current.has(load.requestId)) return;
    seenRequest.current.add(load.requestId);
    if (!validTimerLoad(load)) {
      setNotice("Those session settings are not valid.");
      acknowledgeLoad(load.requestId, false);
      return;
    }
    if (isBusy(phaseRef.current)) {
      setNotice("Finish, reset or stop the current session before loading new settings.");
      acknowledgeLoad(load.requestId, false);
      return;
    }
    const config = load.config;
    setMode(config.mode);
    setWork(config.workSeconds);
    setRest(config.restSeconds);
    setRounds(config.rounds);
    setPrep(config.prepSeconds);
    setT(config.mode === "test" ? 0 : config.workSeconds);
    totalRef.current = config.workSeconds;
    setPhase("idle");
    setRound(1);
    setRunning(false);
    setTotalHangTime(0);
    testElapsed.current = 0;
    testRunStart.current = null;
    setNotice("Session settings loaded. Start when ready.");
    acknowledgeLoad(load.requestId, true);
  }

  useEffect(() => {
    if (loadRequest) applyLoad(loadRequest);
  }, [loadRequest]);

  useEffect(() => {
    function handleProtocol(event: Event) {
      const detail = (event as CustomEvent).detail;
      const supplied = detail?.config || {
        mode: detail?.mode || "simple",
        work: detail?.work,
        rest: detail?.rest,
        rounds: detail?.rounds,
        prep: detail?.prep,
      };
      const config = normalizeLegacyTimerConfig(supplied) as TimerConfig;
      const load: TimerLoad = {
        requestId: detail?.requestId || detail?.id || crypto.randomUUID(),
        config,
      };
      applyLoad(load);
    }
    window.addEventListener("loadProtocol", handleProtocol);
    return () => window.removeEventListener("loadProtocol", handleProtocol);
  }, []);

  function start() {
    if (!hydrated || document.hidden) return;
    if (phase === "test" && !running) {
      testRunStart.current = performance.now();
      setRunning(true);
      setNotice("");
      transitionCue("Resume", () => beep(880, 0.12, "square", 0.08));
      return;
    }
    const seconds =
      phase === "idle" || phase === "done"
        ? prep > 0
          ? prep
          : mode === "test"
            ? 0
            : work
        : t;
    deadline.current = performance.now() + seconds * 1000;
    lastRemaining.current = seconds;
    setNotice("");
    if (phase === "idle" || phase === "done") {
      setPhase(prep > 0 ? "prep" : mode === "test" ? "test" : "work");
      setRound(1);
      setT(seconds);
      totalRef.current = seconds;
      setTotalHangTime(0);
      testElapsed.current = 0;
      testRunStart.current = mode === "test" && prep === 0 ? performance.now() : null;
      transitionCue(prep > 0 ? "Get ready" : "Start", () =>
        beep(880, 0.2, "square", 0.08),
      );
      onStart?.(mode);
      if (analyticsSource)
        trackTrainingEvent("training_timer_started", {
          source: analyticsSource,
          mode,
        });
    } else {
      transitionCue("Resume", () => beep(880, 0.12, "square", 0.08));
    }
    setRunning(true);
  }
  function pause() {
    if (phase === "test") {
      if (running) pauseTest();
      return;
    }
    const remaining = Math.max(
      0,
      (deadline.current - performance.now()) / 1000,
    );
    const elapsed = Math.max(0, lastRemaining.current - remaining);
    if (phase === "work") setTotalHangTime((h) => h + elapsed);
    lastRemaining.current = remaining;
    setT(remaining);
    setRunning(false);
    releaseFeedback();
  }
  function reset() {
    releaseFeedback();
    setNotice("");
    setRunning(false);
    setPhase("idle");
    setRound(1);
    setT(mode === "test" ? 0 : work);
    totalRef.current = work;
    setTotalHangTime(0);
    testElapsed.current = 0;
    testRunStart.current = null;
  }

  const locked = !hydrated || isBusy(phase);
  const progress = mode === "test" ? t / 3600 : totalRef.current > 0 ? 1 - t / totalRef.current : 0;
  const display =
    phase === "idle" ? (mode === "test" ? 0 : work) : Math.max(0, t);
  const phaseLabel = {
    idle: "READY",
    prep: "GET READY",
    work: "HANG",
    rest: "REST",
    test: "TEST",
    done: "COMPLETE",
  }[phase];
  const phaseColor =
    phase === "rest"
      ? "var(--color-cool)"
      : phase === "done"
        ? "var(--color-text-muted)"
        : "var(--color-primary)";
  const isCountdown =
    (phase === "prep" || phase === "work" || phase === "rest") &&
    t <= 3 &&
    running;

  const dialSize = 320;
  const stroke = 8;
  const r = (dialSize - stroke) / 2;
  const C = 2 * Math.PI * r;

  const glowIntensity = phase === "work" && running ? 0.4 : 0;

  return (
    <div
      className="circular-timer"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        width: "100%",
        textAlign: "center",
      }}
    >
      {/* Mode selector */}
      <fieldset
        disabled={locked}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          border: 0,
          padding: 0,
          margin: 0,
        }}
      >
        <span className="dh-eyebrow" style={{ fontSize: 9 }}>
          MODE
        </span>
        <Seg
          value={mode}
          setValue={(v) => {
            setMode(v as typeof mode);
            reset();
            if (v === "emom" && work > 50) {
              setWork(50);
              setT(50);
              totalRef.current = 50;
            }
          }}
          options={[
            ["simple", "Simple"],
            ["emom", "EMOM"],
            ["ladder", "Ladder"],
            ["test", "Test"],
          ]}
        />
      </fieldset>

      {/* Phase + round indicator */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            letterSpacing: ".12em",
            fontWeight: 700,
            textTransform: "uppercase" as const,
            color: phaseColor,
            transition: "color 300ms",
            animation:
              phase === "work" && running
                ? "phaseGlow 2s ease-in-out infinite"
                : "none",
          }}
          aria-live="polite"
        >
          {mode === "test" ? phaseLabel : `${phaseLabel} · ROUND ${round}/${rounds}`}
        </div>
        {mode !== "test" && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Array.from({ length: rounds }, (_, i) => (
            <div
              key={i}
              style={{
                width:
                  i + 1 === round && (phase === "work" || phase === "rest")
                    ? 24
                    : 8,
                height: 8,
                borderRadius: 4,
                background:
                  i + 1 < round || phase === "done"
                    ? "var(--color-primary)"
                    : i + 1 === round && (phase === "work" || phase === "rest")
                      ? phaseColor
                      : "var(--color-divider)",
                transition: "width 400ms, background 400ms",
                opacity: i + 1 <= round || phase === "done" ? 1 : 0.4,
              }}
            />
          ))}
        </div>}
      </div>

      {/* Dial */}
      <div
        style={{
          position: "relative",
          width: "min(320px, 100%)",
          aspectRatio: "1",
          transition: "transform 300ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Glow behind dial */}
        {phase === "work" && running && (
          <div
            style={{
              position: "absolute",
              inset: -30,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(0,229,255,${glowIntensity}) 0%, transparent 70%)`,
              animation: "pulseGlow 2s ease-in-out infinite",
              pointerEvents: "none",
            }}
          />
        )}

        <svg
          aria-hidden="true"
          viewBox="0 0 320 320"
          width="100%"
          height="100%"
          style={{ display: "block", transform: "rotate(-90deg)" }}
        >
          <circle
            cx={dialSize / 2}
            cy={dialSize / 2}
            r={r}
            fill="none"
            stroke="var(--color-divider)"
            strokeWidth={stroke}
          />
          <circle
            cx={dialSize / 2}
            cy={dialSize / 2}
            r={r}
            fill="none"
            stroke={phaseColor}
            strokeWidth={stroke}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            strokeLinecap="round"
            style={{
              transition: "stroke-dashoffset 100ms linear, stroke 300ms",
              filter:
                running && phase === "work"
                  ? "drop-shadow(0 0 6px rgba(0,229,255,0.5))"
                  : "none",
            }}
          />
          {/* Dot at progress head */}
          {(phase === "work" || phase === "rest") && (
            <circle
              cx={dialSize / 2 + Math.cos(2 * Math.PI * progress) * r}
              cy={dialSize / 2 + Math.sin(2 * Math.PI * progress) * r}
              r={running ? 5 : 4}
              fill={phaseColor}
              style={{
                filter: running
                  ? `drop-shadow(0 0 4px ${phase === "work" ? "rgba(0,229,255,0.8)" : "rgba(64,184,255,0.8)"})`
                  : "none",
                transition: "r 200ms",
              }}
            />
          )}
        </svg>

        {/* Tick marks */}
        <svg
          aria-hidden="true"
          viewBox="0 0 320 320"
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const inner = r - (i % 5 === 0 ? 14 : 8);
            const outer = r - 2;
            const x1 = dialSize / 2 + Math.cos(a) * inner;
            const y1 = dialSize / 2 + Math.sin(a) * inner;
            const x2 = dialSize / 2 + Math.cos(a) * outer;
            const y2 = dialSize / 2 + Math.sin(a) * outer;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={
                  i % 5 === 0
                    ? "var(--color-text-muted)"
                    : "var(--color-divider)"
                }
                strokeWidth={i % 5 === 0 ? 1.2 : 0.6}
              />
            );
          })}
        </svg>

        {/* Center display */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="dh-mono"
            style={{
              fontSize: isCountdown ? 80 : 64,
              fontWeight: 600,
              color: isCountdown ? phaseColor : "var(--color-text)",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              transition:
                "font-size 200ms cubic-bezier(0.16,1,0.3,1), color 200ms",
              transform: pulse ? "scale(1.08)" : "scale(1)",
            }}
          >
            {phase === "test" || (phase === "done" && mode === "test")
              ? fmtTestTime(display)
              : fmtTime(display)}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".18em",
              color: "var(--color-text-faint)",
              marginTop: 8,
              textTransform: "uppercase" as const,
            }}
          >
            {phase === "rest"
              ? `next: hang ${mode === "ladder" ? Math.min(work + round * 5, 120) : work}s`
              : phase === "done" && mode !== "test"
                ? `${Math.round(totalHangTime)}s timer work`
                : phase === "done"
                  ? "Test complete. Record only an actual hold."
                : mode === "ladder"
                  ? `${currentWork}s → ${Math.min(currentWork + 5, 120)}s`
                  : mode === "test"
                    ? "Count up. Stop and record only the actual hold."
                    : mode === "emom"
                      ? `every ${currentWork + Math.max(10, 60 - currentWork)}s`
                      : `${work}s × ${rounds} rounds`}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div
        className="timer-controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "center",
          maxWidth: "100%",
        }}
      >
        {!running ? (
          <button
            disabled={!hydrated}
            className="dh-btn"
            onClick={start}
            style={{
              padding: "14px 28px",
              fontSize: 13,
              animation:
                phase === "idle"
                  ? "subtlePulse 3s ease-in-out infinite"
                  : "none",
            }}
          >
            {phase === "idle" ? "Start" : phase === "done" ? "Again" : "Resume"}
          </button>
        ) : (
          <button
            className="dh-btn dh-btn-ghost"
            onClick={pause}
            style={{ padding: "14px 28px", fontSize: 13 }}
          >
            Pause
          </button>
        )}
        <button
          disabled={!hydrated}
          className="dh-btn dh-btn-ghost"
          onClick={() => {
            if (mode !== "test") {
              reset();
              return;
            }
            if (phase === "prep") {
              reset();
              setNotice("Preparation cancelled. No hold was recorded.");
              return;
            }
            if (phase === "test") finishTest();
          }}
          style={{ padding: "14px 20px" }}
        >
          {mode === "test" ? "Stop" : "Reset"}
        </button>
        <button
          disabled={!hydrated}
          aria-label={soundOn ? "Mute timer" : "Unmute timer"}
          aria-pressed={soundOn}
          className="dh-btn dh-btn-ghost"
          onClick={() => {
            if (soundOn) feedbackRef.current?.cancelSpeech();
            setSoundOn(!soundOn);
          }}
          style={{ padding: "14px 14px", fontSize: 14, minWidth: 0 }}
          title={soundOn ? "Mute" : "Unmute"}
        >
          {soundOn ? "♪" : "✕"}
        </button>
        <label className="small-copy">
          <input
            type="checkbox"
            checked={voiceOn}
            onChange={(e) => {
              if (!e.target.checked) feedbackRef.current?.cancelSpeech();
              setVoiceOn(e.target.checked);
            }}
          />{" "}
          Voice
        </label>
        <label className="small-copy">
          <input
            type="checkbox"
            checked={awakeRequested}
            onChange={(e) => {
              setWakeTouched(true);
              setAwakeRequested(e.target.checked);
            }}
          />{" "}
          Keep screen awake
        </label>
      </div>

      {/* Settings grid */}
      {mode !== "test" && <fieldset
        disabled={locked}
        className="timer-settings"
        style={{
          border: 0,
          padding: 0,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          width: "100%",
          maxWidth: 780,
          margin: "0 auto",

          transition: "opacity 300ms",
        }}
      >
        <Stepper
          label="Hang"
          value={work}
          unit="s"
          setValue={(v) => {
            setWork(v);
            if (phase === "idle") {
              setT(v);
              totalRef.current = v;
            }
          }}
          min={5}
          max={mode === "emom" ? 50 : 120}
          step={5}
        />
        <Stepper
          label={mode === "emom" ? "Rest (auto)" : "Rest"}
          value={mode === "emom" ? 60 - work : rest}
          unit="s"
          setValue={setRest}
          min={mode === "emom" ? 60 - work : 10}
          max={mode === "emom" ? 60 - work : 300}
          step={10}
        />
        <Stepper
          label="Rounds"
          value={rounds}
          setValue={setRounds}
          min={1}
          max={10}
          step={1}
        />
      </fieldset>}
      <fieldset disabled={locked} style={{ border: 0 }}>
        <span className="dh-eyebrow" style={{ fontSize: 9 }}>
          PREPARATION
        </span>
        <Seg
          value={String(prep)}
          setValue={(v) => setPrep(Number(v) as 0 | 5 | 10)}
          options={[
            ["0", "None"],
            ["5", "5 sec"],
            ["10", "10 sec"],
          ]}
        />
      </fieldset>

      {/* Mode description */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".1em",
          color: "var(--color-text-faint)",
          textAlign: "center",
          maxWidth: 360,
          textTransform: "uppercase" as const,
          width: "100%",
        }}
      >
        {mode === "simple" && "Fixed hang and rest intervals each round"}
        {mode === "emom" &&
          "Every Minute On the Minute — rest fills the remaining time"}
        {mode === "ladder" && "Hang time increases +5s each round"}
      </div>

      <p className="small-copy" role="status">
        {notice ||
          (awakeRequested || wakeTouched
            ? {
                off: "Screen awake is off.",
                ready: "Screen-awake will be requested when the timer starts.",
                requested: "Requesting screen awake.",
                active: "Screen awake is active.",
                denied: "Screen-awake request was denied.",
                unsupported: "Screen awake is not supported by this browser.",
                released: "Screen awake was released by this device.",
              }[wakeStatus]
            : locked && hydrated
              ? "Reset to change session settings."
              : "")}
      </p>

      {/* Session stats (visible after completion) */}
      {phase === "done" && mode !== "test" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            padding: "16px 20px",
            width: "100%",
            maxWidth: dialSize + 80,
            background: "var(--color-surface)",
            border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-sm)",
            animation: "fadeInUp 500ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div className="dh-eyebrow" style={{ fontSize: 9 }}>
              Timer work
            </div>
            <div
              className="dh-mono"
              style={{
                fontSize: 22,
                fontWeight: 600,
                marginTop: 4,
                color: "var(--color-primary)",
              }}
            >
              {Math.round(totalHangTime)}s
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="dh-eyebrow" style={{ fontSize: 9 }}>
              Rounds
            </div>
            <div
              className="dh-mono"
              style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}
            >
              {rounds}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="dh-eyebrow" style={{ fontSize: 9 }}>
              Avg / Round
            </div>
            <div
              className="dh-mono"
              style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}
            >
              {Math.round(totalHangTime / rounds)}s
            </div>
          </div>
        </div>
      )}
      {phase === "done" && mode !== "test" && (
        <button
          type="button"
          className="dh-btn dh-btn-ghost"
          onClick={onResultReady}
        >
          Record actual holds
        </button>
      )}

      <style>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0.3); }
          50% { box-shadow: 0 0 0 8px rgba(0,229,255,0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .timer-settings { grid-template-columns: 1fr !important; max-width: 280px !important; }
        }
        @media (max-width: 360px) {
          .timer-controls { gap: 8px !important; }
          .timer-controls .small-copy { flex: 0 1 auto; }
        }
        @media (prefers-reduced-motion: reduce) {
          .circular-timer *, .circular-timer *::before, .circular-timer *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </div>
  );
}
