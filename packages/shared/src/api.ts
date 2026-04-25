import type { Site, SiteDetail, DailyScore, LatencyReading, Device } from './types';

export class PermissionError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'PermissionError';
  }
}

export class StarfleetApi {
  private baseUrl: string;
  private getToken: () => string;
  private onAuthError?: () => void;

  constructor(
    baseUrl: string,
    getToken: () => string,
    onAuthError?: () => void,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
    this.onAuthError = onAuthError;
  }

  private normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...options.headers,
      },
    });

    if (res.status === 401) {
      this.onAuthError?.();
      throw new Error('Unauthorized');
    }
    if (res.status === 403) {
      throw new PermissionError();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  /** Fetch raw text (used for CSV downloads) */
  private async requestText(path: string): Promise<string> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    });

    if (res.status === 401) { this.onAuthError?.(); throw new Error('Unauthorized'); }
    if (res.status === 403) { throw new PermissionError(); }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `HTTP ${res.status}`);
    }

    return res.text();
  }

  /** Generic GET helper for app-specific endpoints not modeled below. */
  get<T>(path: string): Promise<T> {
    return this.request<T>(this.normalizePath(path));
  }

  /** Generic POST helper for app-specific endpoints not modeled below. */
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(this.normalizePath(path), {
      method: 'POST',
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  // ── Sites ──────────────────────────────────────────────────────────────────

  /** GET /api/sites — all sites with current signal, laptop counts, and score */
  getSites(): Promise<Site[]> {
    return this.request<Site[]>('/api/sites');
  }

  /** GET /api/sites/:id — site detail + current signal + device list */
  getSite(id: number): Promise<SiteDetail> {
    return this.request<SiteDetail>(`/api/sites/${id}`);
  }

  /** GET /api/sites/:id/signal — last 14 days of daily scores with anomaly fields */
  getSignalHistory(siteId: number): Promise<DailyScore[]> {
    return this.request<DailyScore[]>(`/api/sites/${siteId}/signal`);
  }

  /** GET /api/sites/:id/latency — daily P50/P95 aggregates for last 14 days */
  getLatencyHistory(siteId: number): Promise<LatencyReading[]> {
    return this.request<LatencyReading[]>(`/api/sites/${siteId}/latency`);
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  /**
   * GET /api/devices — all devices with status
   * @param filter  optional 'stale' to return only stale devices (Stage 5)
   */
  getDevices(filter?: 'stale'): Promise<Device[]> {
    const qs = filter ? `?filter=${filter}` : '';
    return this.request<Device[]>(`/api/devices${qs}`);
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  /** POST /api/trigger — admin only, trigger Intune remediation script */
  triggerScript(deviceId: number, type: string): Promise<{ trigger_id: number }> {
    return this.request<{ trigger_id: number }>('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, type }),
    });
  }

  // ── CSV Export (admin only) ────────────────────────────────────────────────

  /**
   * GET /api/export/signal — download signal CSV for a site and date range.
   * Returns the raw CSV text. Caller is responsible for triggering a download.
   */
  exportSignalCsv(siteId: number, from: string, to: string): Promise<string> {
    return this.requestText(
      `/api/export/signal?site_id=${siteId}&from=${from}&to=${to}`,
    );
  }

  /**
   * GET /api/export/latency — download latency CSV for a site and date range.
   */
  exportLatencyCsv(siteId: number, from: string, to: string): Promise<string> {
    return this.requestText(
      `/api/export/latency?site_id=${siteId}&from=${from}&to=${to}`,
    );
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  /** POST /auth/login */
  login(email: string, password: string): Promise<{ token: string }> {
    return this.request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }
}

// ── Utility: trigger browser download from CSV string ────────────────────────

export function downloadCsv(csv: string, filename: string): void {
  const g = globalThis as any;
  if (!g.URL?.createObjectURL || !g.document?.createElement) return;

  const blob = new Blob([csv], { type: 'text/csv', lastModified: Date.now() });
  const url  = g.URL.createObjectURL(blob);
  const a    = g.document.createElement('a');
  a.href     = url;
  a.download = filename;
  g.document.body.appendChild(a);
  a.click();
  g.document.body.removeChild(a);
  g.URL.revokeObjectURL(url);
}
