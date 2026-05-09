import { useState } from 'react';

export default function SignupForm({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? 'ok' : 'error');
    } catch {
      setStatus('error');
    }
  }

  const label = { idle: 'Send protocol', loading: 'Sending...', ok: 'Check your inbox', error: 'Try again' }[status];

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="dh-input" type="email" placeholder="you@email.com" required
          value={email} onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'ok'}
          style={{
            background: dark ? 'rgba(0,0,0,0.15)' : 'var(--color-surface)',
            border: dark ? '1px solid rgba(0,0,0,0.3)' : '1px solid var(--color-border)',
            color: dark ? 'var(--color-text-inverse)' : 'var(--color-text)',
            flex: 1,
          }} />
        <button type="submit" className="dh-btn" disabled={status === 'ok' || status === 'loading'}
          style={{
            background: dark ? 'var(--color-text-inverse)' : 'var(--color-primary)',
            color: dark ? 'var(--color-primary)' : 'var(--color-text-inverse)',
            border: 'none',
            opacity: status === 'loading' ? 0.7 : 1,
          }}>{label}</button>
      </div>
      <div className="dh-mono" style={{ fontSize: 10, opacity: 0.7, letterSpacing: '.12em' }}>
        12-WEEK PROTOCOL · NO SPAM · UNSUBSCRIBE ANYTIME
      </div>
    </form>
  );
}
