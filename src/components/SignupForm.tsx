import { useEffect, useId, useState } from 'react';
export default function SignupForm({ dark = false }: { dark?: boolean }) {
  const uid = useId();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [email, setEmail] = useState('');
  const [existing, setExisting] = useState(false);
  const [status, setStatus] = useState<'idle'|'loading'|'ok'|'error'>('idle');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'loading' || status === 'ok') return;
    setStatus('loading');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email}), signal:controller.signal });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error('Not registered');
      setExisting(body.existing === true);
      setStatus('ok');
    } catch { setStatus('error'); }
    finally { window.clearTimeout(timeout); }
  }
  return <div className="signup-form" data-dark={dark}>
    <p><a href="/training-programs/#print-plan">Open the free session planner now</a>. No email required.</p>
    <form onSubmit={submit}>
      <label htmlFor={uid}>Email address for optional training emails</label>
      <div className="signup-controls"><input id={uid} className="dh-input" type="email" name="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={!hydrated||status==='ok'||status==='loading'}/><button type="submit" className="dh-btn" disabled={!hydrated||status==='ok'||status==='loading'}>{status==='loading'?'Registering…':status==='ok'?'Request received':'Subscribe'}</button></div>
      <p className="small-copy">By subscribing, you ask to receive DeadHangs training emails. Unsubscribe in any received message. <a href="/privacy/">Privacy details</a>.</p>
      <p role="status">{status==='ok'?(existing?'This address is already on file. Your existing subscription preferences were left unchanged.':'Subscription registered. This confirms signup, not inbox delivery.'):status==='error'?'We could not register your subscription. Try again, or use the free planner above.':''}</p>
    </form>
  </div>;
}
