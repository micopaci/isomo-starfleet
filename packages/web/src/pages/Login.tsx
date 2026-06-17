import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const nav = useNavigate();
  const { refreshData } = useData();

  // Already authenticated — skip login form
  if (localStorage.getItem('sf_auth') === 'true') {
    nav('/overview', { replace: true });
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('sf_token', data.token);
        localStorage.setItem('sf_auth', 'true');
        refreshData();
        nav('/overview');
      } else {
        const data = await res.json();
        setErrorMsg(data.error || 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to authentication server');
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="panel" style={{ width: '100%', maxWidth: 420, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div
            className="sf-brand-mark"
            aria-hidden="true"
            style={{ width: 48, height: 48, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}
          >S</div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, margin: 0 }}>Starfleet</h1>
          <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', marginTop: 4 }}>Isomo Tech Operations</p>
        </div>

        {errorMsg && (
          <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0, textAlign: 'center' }}>
            {errorMsg}
          </p>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="sf-field-label">Email address</label>
            <input 
              type="email" 
              className="sf-input" 
              placeholder="operator@isomo.ac.rw" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required 
            />
          </div>
          <div>
            <label className="sf-field-label">Password</label>
            <input 
              type="password" 
              className="sf-input" 
              placeholder="••••••••" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
          </div>
          <button type="submit" className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '10px' }}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
