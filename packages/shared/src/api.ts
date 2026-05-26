import type {
  Site, SiteDetail, DailyScore, LatencyReading, Device, UsageHistoryPoint, TriggerType,
  SiteNote, SiteBiweeklyUsage, CreateSiteInput, UpdateSiteInput,
} from './types';

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

  /** GET /api/sites/:id/usage — monthly usage graph points (managed + estimated unmanaged) */
  getUsageHistory(siteId: number, months = 6): Promise<UsageHistoryPoint[]> {
    return this.request<UsageHistoryPoint[]>(`/api/sites/${siteId}/usage?months=${months}`);
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

  /** POST /api/intune/sync — admin only, force a Microsoft Graph managedDevices sync */
  syncIntuneDevices(): Promise<{ ok: boolean; total: number; upserted: number; failed?: number }> {
    return this.request<{ ok: boolean; total: number; upserted: number; failed?: number }>('/api/intune/sync', {
      method: 'POST',
    });
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  /** POST /api/trigger — admin only, trigger Intune remediation script */
  triggerScript(deviceId: number, type: TriggerType): Promise<{ ok: boolean; trigger_id: number }> {
    return this.request<{ ok: boolean; trigger_id: number }>('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, type }),
    });
  }

  /** POST /api/trigger/site — admin only, trigger every Intune-managed device at a site */
  triggerSite(siteId: number, type: TriggerType): Promise<{ ok: boolean; count: number; trigger_ids: number[] }> {
    return this.request<{ ok: boolean; count: number; trigger_ids: number[] }>('/api/trigger/site', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, type }),
    });
  }

  /** POST /api/trigger/devices — admin only, trigger every Intune-managed laptop */
  triggerAllDevices(type: TriggerType): Promise<{ ok: boolean; count: number; trigger_ids: number[] }> {
    return this.request<{ ok: boolean; count: number; trigger_ids: number[] }>('/api/trigger/devices', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
  }

  /** POST /ingest/refresh-token — agent only, rotate site-scoped token */
  refreshAgentToken(deviceSn?: string): Promise<{ token: string; site_id: number; site_name: string | null; expires_in: string }> {
    return this.request<{ token: string; site_id: number; site_name: string | null; expires_in: string }>('/ingest/refresh-token', {
      method: 'POST',
      body: JSON.stringify({ device_sn: deviceSn }),
    });
  }

  /** POST /api/usage/monthly-import — admin only, import Starlink portal totals */
  importMonthlyUsage(
    month: string,
    entries: Array<{ site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number }>,
    source = 'starlink_portal_manual',
  ): Promise<{ ok: boolean; month: string; imported: number }> {
    return this.request<{ ok: boolean; month: string; imported: number }>('/api/usage/monthly-import', {
      method: 'POST',
      body: JSON.stringify({ month, entries, source }),
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

  /** GET /api/export/site-usage-monthly — admin only, raw monthly portal totals */
  exportSiteUsageMonthlyCsv(from: string, to: string): Promise<string> {
    return this.requestText(`/api/export/site-usage-monthly?from=${from}&to=${to}`);
  }

  // ── Site mutations (admin only) ────────────────────────────────────────────

  /** POST /api/sites — create a new site */
  createSite(input: CreateSiteInput): Promise<Site> {
    return this.request<Site>('/api/sites', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** PATCH /api/sites/:id — update editable metadata */
  updateSite(id: number, input: UpdateSiteInput): Promise<{ ok: boolean; site: Site }> {
    return this.request<{ ok: boolean; site: Site }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  // ── Site notes ────────────────────────────────────────────────────────────

  /** GET /api/sites/:id/notes */
  getSiteNotes(siteId: number, limit = 50): Promise<SiteNote[]> {
    return this.request<SiteNote[]>(`/api/sites/${siteId}/notes?limit=${limit}`);
  }

  /** POST /api/sites/:id/notes — admin only */
  addSiteNote(siteId: number, body: string): Promise<{ ok: boolean; note: SiteNote }> {
    return this.request<{ ok: boolean; note: SiteNote }>(`/api/sites/${siteId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /** DELETE /api/sites/:id/notes/:noteId — admin only */
  deleteSiteNote(siteId: number, noteId: number): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/sites/${siteId}/notes/${noteId}`, {
      method: 'DELETE',
    });
  }

  // ── Biweekly usage ────────────────────────────────────────────────────────

  /** GET /api/sites/:id/biweekly-usage */
  getBiweeklyUsage(siteId: number, limit = 12): Promise<SiteBiweeklyUsage[]> {
    return this.request<SiteBiweeklyUsage[]>(`/api/sites/${siteId}/biweekly-usage?limit=${limit}`);
  }

  /** POST /api/sites/:id/biweekly-usage — admin only, accepts GB or bytes */
  addBiweeklyUsage(
    siteId: number,
    entry: {
      period_start: string;
      period_end: string;
      bytes_down?: number;
      bytes_up?: number;
      gb_down?: number;
      gb_up?: number;
      gb_total?: number;
      notes?: string;
    },
  ): Promise<{ ok: boolean; entry: SiteBiweeklyUsage }> {
    return this.request<{ ok: boolean; entry: SiteBiweeklyUsage }>(
      `/api/sites/${siteId}/biweekly-usage`,
      { method: 'POST', body: JSON.stringify(entry) },
    );
  }

  /** DELETE /api/sites/:id/biweekly-usage/:entryId — admin only */
  deleteBiweeklyUsage(siteId: number, entryId: number): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/sites/${siteId}/biweekly-usage/${entryId}`, {
      method: 'DELETE',
    });
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
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
