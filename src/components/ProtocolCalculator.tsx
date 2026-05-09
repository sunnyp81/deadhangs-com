import { useState, useMemo } from 'react';

function Seg({ value, setValue, options, block = false }: {
  value: string; setValue: (v: string) => void;
  options: [string, string][]; block?: boolean;
}) {
  return (
    <div style={{
      display: block ? 'grid' : 'inline-flex',
      gridTemplateColumns: block ? `repeat(${options.length}, 1fr)` : undefined,
      marginTop: 6,
      background: 'var(--color-bg)',
      border: '1px solid var(--color-divider)',
      borderRadius: 'var(--radius-sm)',
      padding: 3, gap: 2,
    }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => setValue(v)}
          style={{
            border: 0, padding: '8px 12px', borderRadius: 4,
            background: v === value ? 'var(--color-primary)' : 'transparent',
            color: v === value ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.1em',
            textTransform: 'uppercase', cursor: 'pointer', fontWeight: 600,
            transition: 'all 160ms cubic-bezier(0.16,1,0.3,1)',
          }}>{l}</button>
      ))}
    </div>
  );
}

function Stat({ label, value, big = false }: { label: string; value: string | number; big?: boolean }) {
  return (
    <div>
      <div className="dh-eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div className="dh-mono" style={{
        fontSize: big ? 32 : 16, fontWeight: 600, color: 'var(--color-text)',
        marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

export default function ProtocolCalculator() {
  const [bw, setBw] = useState(75);
  const [unit, setUnit] = useState('kg');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('longevity');

  const protocol = useMemo(() => {
    const map: Record<string, { rounds: number; work: number; rest: number }> = {
      beginner: { rounds: 3, work: 15, rest: 90 },
      intermediate: { rounds: 4, work: 30, rest: 60 },
      advanced: { rounds: 5, work: 45, rest: 45 },
    };
    const goalMod: Record<string, { workMod: number; days: number }> = {
      longevity: { workMod: 0, days: 5 },
      grip: { workMod: 5, days: 6 },
      hypertrophy: { workMod: 10, days: 4 },
    };
    const base = map[level];
    const gm = goalMod[goal];
    const totalWeekly = (base.work + gm.workMod) * base.rounds * gm.days;
    const target = unit === 'kg' ? bw : Math.round(bw * 0.453592);
    return {
      rounds: base.rounds,
      work: base.work + gm.workMod,
      rest: base.rest,
      days: gm.days,
      weeklyVolume: totalWeekly,
      load: `${target} kg`,
      level, goal,
    };
  }, [bw, unit, level, goal]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 1fr) 1.2fr',
      gap: 24, padding: 28,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-divider)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div className="dh-eyebrow">Bodyweight</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="number" className="dh-input" value={bw}
              onChange={(e) => setBw(+e.target.value || 0)}
              style={{ flex: 1 }} />
            <Seg value={unit} setValue={setUnit} options={[['kg', 'kg'], ['lb', 'lb']]} />
          </div>
        </div>
        <div>
          <div className="dh-eyebrow">Experience</div>
          <Seg value={level} setValue={setLevel}
            options={[['beginner', 'Beg.'], ['intermediate', 'Int.'], ['advanced', 'Adv.']]} block />
        </div>
        <div>
          <div className="dh-eyebrow">Goal</div>
          <Seg value={goal} setValue={setGoal}
            options={[['longevity', 'Longevity'], ['grip', 'Grip'], ['hypertrophy', 'Mass']]} block />
        </div>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 14,
        padding: 22, background: 'var(--color-bg)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-divider)',
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <span className="dh-tag dh-tag-accent">YOUR PROTOCOL</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 16 }}>
          <Stat big label="Rounds" value={protocol.rounds} />
          <Stat big label="Work · sec" value={protocol.work} />
          <Stat big label="Rest · sec" value={protocol.rest} />
        </div>
        <hr className="dh-rule" style={{ margin: '6px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <Stat label="Frequency" value={`${protocol.days}× / wk`} />
          <Stat label="Wkly volume" value={`${protocol.weeklyVolume}s`} />
          <Stat label="Hang load" value={protocol.load} />
          <Stat label="Tier" value={protocol.level.toUpperCase()} />
        </div>
        <button className="dh-btn" style={{ marginTop: 8, justifyContent: 'center' }}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('loadProtocol', {
              detail: { work: protocol.work, rest: protocol.rest, rounds: protocol.rounds },
            }));
            document.getElementById('timer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}>
          Run This Protocol →
        </button>
      </div>
    </div>
  );
}
