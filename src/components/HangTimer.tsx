import { useState, useEffect, useRef } from 'react';

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function beep(freq = 880, dur = 0.12, type: OscillatorType = 'sine', vol = 0.06) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = ((window as any).__dhAudio ||= new Ctx());
    if (ctx.state === 'suspended') ctx.resume();
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

function Stepper({ label, value, setValue, min, max, step = 1 }: {
  label: string; value: number; setValue: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  const btnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)',
    background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
    fontSize: 14, lineHeight: 1, padding: 0,
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', border: '1px solid var(--color-divider)',
      borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setValue(Math.max(min, value - step))} style={btnStyle}>−</button>
        <span className="dh-mono" style={{ minWidth: 28, textAlign: 'center', fontWeight: 600 }}>{value}</span>
        <button onClick={() => setValue(Math.min(max, value + step))} style={btnStyle}>+</button>
      </div>
    </div>
  );
}

export default function HangTimer({ initialWork = 30, initialRest = 60, rounds = 3 }: {
  initialWork?: number; initialRest?: number; rounds?: number;
}) {
  const [work, setWork] = useState(initialWork);
  const [rest, setRest] = useState(initialRest);
  const [phase, setPhase] = useState<'idle' | 'work' | 'rest' | 'done'>('idle');
  const [round, setRound] = useState(1);
  const [t, setT] = useState(initialWork);
  const [running, setRunning] = useState(false);
  const totalRef = useRef(initialWork);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setT(prev => {
        const next = prev - 0.1;
        if (next <= 3.05 && next > 2.95) beep(660, 0.08);
        if (next <= 2.05 && next > 1.95) beep(660, 0.08);
        if (next <= 1.05 && next > 0.95) beep(660, 0.08);
        if (next <= 0) {
          if (phase === 'work') {
            beep(330, 0.3, 'square', 0.08);
            if (round >= rounds) {
              setPhase('done');
              setRunning(false);
              return 0;
            }
            setPhase('rest');
            totalRef.current = rest;
            return rest;
          } else if (phase === 'rest') {
            beep(880, 0.25, 'square', 0.08);
            setPhase('work');
            setRound(r => r + 1);
            totalRef.current = work;
            return work;
          }
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [running, phase, work, rest, round, rounds]);

  function start() {
    if (phase === 'idle' || phase === 'done') {
      setPhase('work');
      setRound(1);
      setT(work);
      totalRef.current = work;
      beep(880, 0.2, 'square', 0.08);
    }
    setRunning(true);
  }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false);
    setPhase('idle');
    setRound(1);
    setT(work);
    totalRef.current = work;
  }

  const progress = totalRef.current > 0 ? 1 - t / totalRef.current : 0;
  const display = phase === 'idle' ? work : Math.max(0, t);
  const phaseLabel = { idle: 'READY', work: 'HANG', rest: 'REST', done: 'COMPLETE' }[phase];
  const phaseColor = phase === 'rest' ? 'var(--color-cool)' : phase === 'done' ? 'var(--color-text-muted)' : 'var(--color-primary)';

  const dialSize = 320;
  const stroke = 8;
  const r = (dialSize - stroke) / 2;
  const C = 2 * Math.PI * r;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', maxWidth: dialSize + 80,
      }}>
        <div className="dh-eyebrow">PHASE</div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em',
          color: phaseColor, fontWeight: 600,
        }}>{phaseLabel} · ROUND {round}/{rounds}</div>
      </div>
      <div style={{ position: 'relative', width: dialSize, height: dialSize }}>
        <svg width={dialSize} height={dialSize} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
          <circle cx={dialSize / 2} cy={dialSize / 2} r={r} fill="none"
            stroke="var(--color-divider)" strokeWidth={stroke} />
          <circle cx={dialSize / 2} cy={dialSize / 2} r={r} fill="none"
            stroke={phaseColor} strokeWidth={stroke}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            strokeLinecap="butt"
            style={{ transition: 'stroke-dashoffset 100ms linear, stroke 200ms' }} />
        </svg>
        <svg width={dialSize} height={dialSize} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const inner = r - (i % 5 === 0 ? 14 : 8);
            const outer = r - 2;
            const x1 = dialSize / 2 + Math.cos(a) * inner;
            const y1 = dialSize / 2 + Math.sin(a) * inner;
            const x2 = dialSize / 2 + Math.cos(a) * outer;
            const y2 = dialSize / 2 + Math.sin(a) * outer;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={i % 5 === 0 ? 'var(--color-text-muted)' : 'var(--color-divider)'}
              strokeWidth={i % 5 === 0 ? 1.2 : 0.6} />;
          })}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="dh-mono" style={{ fontSize: 64, fontWeight: 600,
            color: 'var(--color-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {fmtTime(display)}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.18em',
            color: 'var(--color-text-faint)', marginTop: 6, textTransform: 'uppercase' }}>
            {phase === 'rest' ? `next: hang ${work}s` : phase === 'done' ? 'session logged' : `target ${work}s × ${rounds}`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {!running ? (
          <button className="dh-btn" onClick={start}>
            {phase === 'idle' ? '▶ Start' : phase === 'done' ? '↻ Repeat' : '▶ Resume'}
          </button>
        ) : (
          <button className="dh-btn dh-btn-ghost" onClick={pause}>❚❚ Pause</button>
        )}
        <button className="dh-btn dh-btn-ghost" onClick={reset}>Reset</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: dialSize + 80 }}>
        <Stepper label="Work · sec" value={work} setValue={(v) => { setWork(v); if (phase === 'idle') { setT(v); totalRef.current = v; } }} min={5} max={120} step={5} />
        <Stepper label="Rest · sec" value={rest} setValue={setRest} min={10} max={300} step={10} />
      </div>
    </div>
  );
}
