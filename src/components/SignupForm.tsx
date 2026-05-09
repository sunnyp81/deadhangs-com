import { useState } from 'react';

export default function SignupForm({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) setSubmitted(true); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="dh-input" type="email" placeholder="you@email.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          style={{
            background: dark ? 'rgba(0,0,0,0.15)' : 'var(--color-surface)',
            border: dark ? '1px solid rgba(0,0,0,0.3)' : '1px solid var(--color-border)',
            color: dark ? 'var(--color-text-inverse)' : 'var(--color-text)',
            flex: 1,
          }} />
        <button type="submit" className="dh-btn" style={{
          background: dark ? 'var(--color-text-inverse)' : 'var(--color-primary)',
          color: dark ? 'var(--color-primary)' : 'var(--color-text-inverse)',
          border: 'none',
        }}>{submitted ? '✓ Sent' : 'Send protocol'}</button>
      </div>
      <div className="dh-mono" style={{ fontSize: 10, opacity: 0.7, letterSpacing: '.12em' }}>
        ONE EMAIL · NO SPAM · UNSUBSCRIBE ANYTIME
      </div>
    </form>
  );
}
