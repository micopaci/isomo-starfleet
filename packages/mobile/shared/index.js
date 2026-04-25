const React = require('react');

const { useCallback, useEffect, useState } = React;

let sharedApiClient = null;
let sharedWsClient = null;

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSite(raw) {
  const site = raw || {};
  return {
    ...site,
    id: Number(site.id),
    name: site.name || `Site ${site.id}`,
    lat: toNumber(site.lat),
    lng: toNumber(site.lng),
    score: toNumber(site.score),
    score_7day_avg: toNumber(site.score_7day_avg),
    signal: site.signal
      ? {
          ...site.signal,
          ping_drop_pct: toNumber(site.signal.ping_drop_pct),
          obstruction_pct: toNumber(site.signal.obstruction_pct),
          snr: toNumber(site.signal.snr),
          pop_latency_ms: toNumber(site.signal.pop_latency_ms),
        }
      : null,
    devices: Array.isArray(site.devices) ? site.devices : [],
  };
}

function computeSignalScore(input) {
  const pingDrop = toNumber(input && input.ping_drop_pct);
  const obstruction = toNumber(input && input.obstruction_pct);
  const snr = toNumber(input && input.snr);
  const latency = toNumber(input && input.pop_latency_ms);

  let score = 100;
  if (pingDrop != null) score -= clamp(pingDrop * 2.5, 0, 55);
  if (obstruction != null) score -= clamp(obstruction * 1.2, 0, 35);
  if (snr != null) score += clamp((snr - 8) * 2.5, -30, 20);
  if (latency != null) score -= clamp((latency - 40) / 3, 0, 35);
  return Math.round(clamp(score, 0, 100));
}

function predictCause(input) {
  const pingDrop = toNumber(input && input.ping_drop_pct);
  const obstruction = toNumber(input && input.obstruction_pct);
  const snr = toNumber(input && input.snr);
  const latency = toNumber(input && input.pop_latency_ms);

  if (obstruction != null && obstruction >= 10) return 'Likely dish obstruction (trees/buildings)';
  if (pingDrop != null && pingDrop >= 3) return 'Packet loss is elevated on the link';
  if (snr != null && snr < 8) return 'Low signal-to-noise ratio';
  if (latency != null && latency > 120) return 'High backhaul latency to PoP';
  if (latency != null && latency > 70) return 'Moderate network congestion';
  return 'Signal looks stable';
}

function siteStatus(site) {
  const score =
    toNumber(site && site.score) ??
    toNumber(site && site.score_7day_avg) ??
    ((site && site.signal) ? computeSignalScore(site.signal) : null);
  if (score == null) return 'dark';
  if (score >= 80) return 'online';
  if (score >= 40) return 'degraded';
  return 'dark';
}

function summarizeSites(sites) {
  let onlineSites = 0;
  let degradedSites = 0;
  let darkSites = 0;
  let onlineLaptops = 0;
  let totalLaptops = 0;

  for (const site of sites) {
    const status = siteStatus(site);
    if (status === 'online') onlineSites += 1;
    else if (status === 'degraded') degradedSites += 1;
    else darkSites += 1;

    const onlineCount = toNumber(site.online_laptops);
    if (onlineCount != null) {
      onlineLaptops += onlineCount;
    } else if (Array.isArray(site.devices)) {
      onlineLaptops += site.devices.filter((d) => {
        if (!d || !d.last_seen) return false;
        const seen = new Date(d.last_seen).getTime();
        return Number.isFinite(seen) && Date.now() - seen < 10 * 60 * 1000;
      }).length;
    }

    const totalCount = toNumber(site.total_laptops);
    if (totalCount != null) totalLaptops += totalCount;
    else if (Array.isArray(site.devices)) totalLaptops += site.devices.length;
  }

  return {
    total_sites: sites.length,
    online_sites: onlineSites,
    degraded_sites: degradedSites,
    dark_sites: darkSites,
    online_laptops: onlineLaptops,
    total_laptops: totalLaptops,
  };
}

class StarfleetApi {
  constructor(baseUrl, getToken, onAuthError) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.getToken = typeof getToken === 'function' ? getToken : () => '';
    this.onAuthError = typeof onAuthError === 'function' ? onAuthError : () => {};
  }

  toUrl(path) {
    const p = String(path || '');
    if (/^https?:\/\//i.test(p)) return p;
    return `${this.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
  }

  async request(path, options) {
    const method = (options && options.method) || 'GET';
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...((options && options.headers) || {}),
    };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(this.toUrl(path), {
      method,
      headers,
      body: options && options.body != null ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      this.onAuthError();
      throw new Error('Unauthorized');
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        (payload && (payload.detail || payload.message || payload.error)) ||
        `${response.status} ${response.statusText}`.trim();
      if (String(path).includes('/auth/login')) {
        console.warn('[StarfleetApi] Login request failed', {
          path,
          status: response.status,
          message: String(message || ''),
        });
      }
      const error = new Error(String(message || 'Request failed'));
      error.status = response.status;
      error.path = path;
      throw error;
    }

    return payload;
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  extractToken(payload) {
    if (payload == null) return null;
    if (typeof payload === 'string') return payload || null;
    if (typeof payload !== 'object') return null;
    if (typeof payload.token === 'string' && payload.token) return payload.token;
    if (typeof payload.access_token === 'string' && payload.access_token) return payload.access_token;
    if (typeof payload.jwt === 'string' && payload.jwt) return payload.jwt;
    if (payload.data && typeof payload.data === 'object') {
      if (typeof payload.data.token === 'string' && payload.data.token) return payload.data.token;
      if (typeof payload.data.access_token === 'string' && payload.data.access_token) return payload.data.access_token;
    }
    return null;
  }

  async login(email, password) {
    const identifier = String(email || '').trim();
    const secret = String(password || '');
    const attempts = [
      { path: '/auth/login', body: { email: identifier, password: secret } },
      { path: '/auth/login', body: { username: identifier, password: secret } },
      { path: '/api/auth/login', body: { email: identifier, password: secret } },
      { path: '/api/auth/login', body: { username: identifier, password: secret } },
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const response = await this.post(attempt.path, attempt.body);
        const token = this.extractToken(response);
        if (token) return { token };
        lastError = new Error('Login response missing token');
      } catch (error) {
        const status = error && error.status;
        if (status === 401 || status === 403) {
          // Credential/auth failure on canonical endpoint should surface directly.
          if (attempt.path === '/auth/login' && Object.prototype.hasOwnProperty.call(attempt.body, 'email')) {
            throw error;
          }
          lastError = error;
          continue;
        }
        // Only try legacy fallback endpoint when canonical path is unavailable.
        if (attempt.path === '/auth/login' && (status === 404 || status === 405)) {
          lastError = error;
          continue;
        }
        if (attempt.path.startsWith('/api/') && (status === 404 || status === 405)) {
          lastError = error;
          continue;
        }
        lastError = error;
        throw error;
      }
    }
    throw lastError || new Error('Login failed');
  }

  getSites() {
    return this.get('/api/sites');
  }

  getSite(siteId) {
    return this.get(`/api/sites/${siteId}`);
  }

  getSignalHistory(siteId) {
    return this.get(`/api/sites/${siteId}/signal-history`);
  }

  getDevices(status) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.get(`/api/devices${q}`);
  }

  triggerScript(deviceId, scriptType) {
    return this.post(`/api/devices/${deviceId}/scripts/${scriptType}`);
  }
}

class StarfleetWS {
  connect(url, token) {
    this.disconnect();
    const wsUrl = token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
    if (typeof WebSocket !== 'function') return;
    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      this.socket = null;
    }
  }

  disconnect() {
    try {
      this.socket && this.socket.close && this.socket.close();
    } catch {
      // noop
    } finally {
      this.socket = null;
    }
  }
}

function setSharedApiClient(client) {
  sharedApiClient = client;
}

function setSharedWsClient(client) {
  sharedWsClient = client;
}

function useFleetSummary() {
  const [sites, setSites] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!sharedApiClient) {
      setLoading(false);
      setError('Not connected');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rawSites = await sharedApiClient.getSites();
      const normalized = Array.isArray(rawSites) ? rawSites.map(normalizeSite) : [];
      setSites(normalized);
      setSummary(summarizeSites(normalized));
    } catch (e) {
      setError((e && e.message) || 'Failed to load sites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sites, summary, loading, error, refresh };
}

function useSite(siteId) {
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!sharedApiClient) {
      setLoading(false);
      setError('Not connected');
      return;
    }
    setLoading(true);
    setError('');
    try {
      let data;
      if (typeof sharedApiClient.getSite === 'function') {
        data = await sharedApiClient.getSite(siteId);
      } else {
        const sites = await sharedApiClient.getSites();
        data = Array.isArray(sites) ? sites.find((s) => Number(s.id) === Number(siteId)) : null;
      }
      setSite(data ? normalizeSite(data) : null);
    } catch (e) {
      setError((e && e.message) || 'Failed to load site');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { site, loading, error, refresh };
}

function useSignalHistory(siteId) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!sharedApiClient) {
      setLoading(false);
      setError('Not connected');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await sharedApiClient.getSignalHistory(siteId);
      const rows = Array.isArray(data) ? data : [];
      setScores(
        rows
          .map((row, index) => ({
            date: row.date || row.day || row.ts || `D${index + 1}`,
            score: clamp(toNumber(row.score) || 0, 0, 100),
          }))
          .slice(-30),
      );
    } catch (e) {
      setError((e && e.message) || 'Failed to load signal history');
      setScores([]);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { scores, loading, error, refresh };
}

module.exports = {
  StarfleetApi,
  StarfleetWS,
  computeSignalScore,
  predictCause,
  setSharedApiClient,
  setSharedWsClient,
  sharedWsClient,
  siteStatus,
  useFleetSummary,
  useSignalHistory,
  useSite,
};
