import { useState } from 'react';
import { StarfleetApi } from '@starfleet/shared';
import { login, getBaseUrl, saveBaseUrl } from '../store/auth';

interface Props { onLogin: () => void; }

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [baseUrl, setBaseUrl]   = useState(getBaseUrl());
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      saveBaseUrl(baseUrl);
      const tempApi = new StarfleetApi(baseUrl, () => '');
      const { token } = await tempApi.login(email, password);
      login(token, () => { logout(); window.location.reload(); });
      onLogin();
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function logout() { /* handled by auth store */ }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-icon">🛰</span>
          <h1>Starfleet Monitor</h1>
          <p>Isomo Fleet Management</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            Server URL
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://starfleet.yourdomain.com"
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@test.com"
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
