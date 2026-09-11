import { useState } from 'react';
import { compareHang } from '../lib/hang-comparison.mjs';

export default function HangCalculator() {
  const [hold, setHold] = useState('');
  const [target, setTarget] = useState('60');
  const [previous, setPrevious] = useState('');
  const [result, setResult] = useState<ReturnType<typeof compareHang> | null>(null);
  const [error, setError] = useState('');
  function calculate(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!hold.trim() || !target.trim()) throw new Error('Enter your hold time and a target.');
      setResult(compareHang(Number(hold), Number(target), previous.trim() ? Number(previous) : null));
      setError('');
    } catch (e) { setResult(null); setError((e as Error).message); }
  }
  return <div className="hang-calculator">
    <form onSubmit={calculate}>
      <div className="field-grid">
        <label htmlFor="calc-time">Your hold, seconds<input id="calc-time" type="number" min="0" max="3600" step="0.1" required value={hold} onChange={e => {setHold(e.target.value); setResult(null);}} inputMode="decimal" /></label>
        <label htmlFor="calc-target">Your target, seconds<input id="calc-target" type="number" min="1" max="3600" step="0.1" required value={target} onChange={e => {setTarget(e.target.value); setResult(null);}} inputMode="decimal" /></label>
        <label htmlFor="calc-previous">Previous hold, seconds <span className="optional">Optional</span><input id="calc-previous" type="number" min="0.1" max="3600" step="0.1" value={previous} onChange={e => {setPrevious(e.target.value); setResult(null);}} inputMode="decimal" /></label>
      </div>
      <p className="small-copy">60 seconds is an editable personal target, not an age norm or a fitness requirement. Compare holds with the same assistance, bar and grip.</p>
      <button className="dh-btn" type="submit">Compare my hold</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
    <div id="calc-result" aria-live="polite" aria-atomic="true">
      {result ? <div className="calculator-result">
        <p className="dh-eyebrow">Against your own target</p>
        <div className="result-number">{result.percent}<span>%</span></div>
        <p>{result.remaining > 0 ? `${result.remaining} seconds between this hold and your target.` : 'This hold meets or exceeds your target.'}</p>
        {result.difference !== null && <p>{result.difference > 0 ? '+' : ''}{result.difference} seconds ({result.change! > 0 ? '+' : ''}{result.change}%) compared with your previous hold.</p>}
        <p className="small-copy">This is a personal comparison. It is not a population percentile or a medical assessment.</p>
        <a className="text-link" href="/training-log/">Time a session and record your progress →</a>
      </div> : <p className="calculator-empty">Enter a hold to see your target progress. Your entries stay on this page and are not saved.</p>}
    </div>
  </div>;
}
