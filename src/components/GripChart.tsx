import { useState, useEffect, useMemo } from 'react';

export default function GripChart({ width = 1100, height = 300 }: { width?: number; height?: number }) {
  const data = useMemo(() => {
    const days = 84;
    const arr: { day: number; val: number }[] = [];
    let v = 38;
    for (let i = 0; i < days; i++) {
      const trend = 0.08;
      const noise = Math.sin(i * 0.7) * 0.6 + (Math.random() - 0.5) * 0.4;
      v += trend + noise * 0.3;
      arr.push({ day: i, val: v });
    }
    return arr;
  }, []);

  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let r: number;
    let start: number;
    function step(t: number) {
      if (!start) start = t;
      const e = Math.min(1, (t - start) / 1400);
      setProgress(1 - Math.pow(1 - e, 3));
      if (e < 1) r = requestAnimationFrame(step);
    }
    r = requestAnimationFrame(step);
    return () => cancelAnimationFrame(r);
  }, []);

  const pad = { l: 48, r: 16, t: 16, b: 32 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const minV = 36, maxV = 50;
  const xAt = (i: number) => pad.l + (i / (data.length - 1)) * w;
  const yAt = (v: number) => pad.t + h - ((v - minV) / (maxV - minV)) * h;

  const visible = Math.floor(data.length * progress);
  const path = data.slice(0, visible).map((d, i) =>
    `${i === 0 ? 'M' : 'L'}${xAt(d.day).toFixed(1)},${yAt(d.val).toFixed(1)}`).join(' ');
  const areaPath = path && progress > 0
    ? `${path} L${xAt(Math.max(0, visible - 1))},${pad.t + h} L${xAt(0)},${pad.t + h} Z`
    : '';

  const last = data[Math.max(0, visible - 1)];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="dh-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[38, 42, 46, 50].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={pad.l + w} y1={yAt(v)} y2={yAt(v)}
            stroke="var(--color-divider)" strokeDasharray="2 4" strokeWidth="0.6" />
          <text x={pad.l - 8} y={yAt(v) + 4} textAnchor="end"
            fill="var(--color-text-faint)" fontFamily="var(--font-mono)" fontSize="10" letterSpacing=".08em">
            {v}<tspan opacity="0.6">kg</tspan>
          </text>
        </g>
      ))}
      {[0, 21, 42, 63, 83].map((d) => (
        <g key={d}>
          <line x1={xAt(d)} x2={xAt(d)} y1={pad.t + h} y2={pad.t + h + 4}
            stroke="var(--color-text-faint)" strokeWidth="0.6" />
          <text x={xAt(d)} y={pad.t + h + 18} textAnchor="middle"
            fill="var(--color-text-faint)" fontFamily="var(--font-mono)" fontSize="10" letterSpacing=".08em">
            W{Math.floor(d / 7) + 1}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="url(#dh-area)" />
      <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {last && progress > 0.05 && (
        <g>
          <circle cx={xAt(last.day)} cy={yAt(last.val)} r="4"
            fill="var(--color-bg)" stroke="var(--color-primary)" strokeWidth="2" />
          <g transform={`translate(${xAt(last.day) + 12}, ${yAt(last.val) - 18})`}>
            <rect x="0" y="0" width="84" height="32" rx="3"
              fill="var(--color-surface-2)" stroke="var(--color-primary)" strokeWidth="1" />
            <text x="8" y="13" fill="var(--color-text-muted)"
              fontFamily="var(--font-mono)" fontSize="9" letterSpacing=".12em">CURRENT</text>
            <text x="8" y="26" fill="var(--color-primary)"
              fontFamily="var(--font-mono)" fontSize="13" fontWeight="700">{last.val.toFixed(1)} kg</text>
          </g>
        </g>
      )}
    </svg>
  );
}
