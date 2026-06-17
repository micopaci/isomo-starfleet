import type {
  Site, SiteDetail, DailyScore, LatencyReading, Device, UsageHistoryPoint,
  DailyUsageHistoryPoint, DailyUsageImportEntry, PortalSnapshotImportEntry,
  PortalSnapshotImportResult, PortalScraperRun, PortalScraperRunInput, TriggerType,
  SiteNote, SiteBiweeklyUsage, CreateSiteInput, UpdateSiteInput, Alert, AlertStatus,
  Student, SpaceWeatherReading,
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
  private getOperatorEmail?: () => string;

  constructor(
    baseUrl: string,
    getToken: () => string,
    onAuthError?: () => void,
    getOperatorEmail?: () => string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
    this.onAuthError = onAuthError;
    this.getOperatorEmail = getOperatorEmail;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const opEmail = this.getOperatorEmail?.() || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
    if (opEmail) {
      headers['x-operator-email'] = opEmail;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
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

  /** GET /api/sites/:id/usage/daily — daily portal totals plus managed/residual usage */
  getDailyUsageHistory(siteId: number, days = 31): Promise<DailyUsageHistoryPoint[]> {
    return this.request<DailyUsageHistoryPoint[]>(`/api/sites/${siteId}/usage/daily?days=${days}`);
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

  // ── Alerts ───────────────────────────────────────────────────────────────────

  /** GET /api/alerts — durable alert_events feed (status: open|acknowledged|resolved|all) */
  getAlerts(status: AlertStatus | 'all' = 'all', limit = 200): Promise<Alert[]> {
    return this.request<Alert[]>(`/api/alerts?status=${status}&limit=${limit}`);
  }

  /** POST /api/alerts/:id/ack — admin only, acknowledge an open alert */
  ackAlert(id: number): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/alerts/${id}/ack`, { method: 'POST' });
  }

  /** POST /api/alerts/:id/assign — admin only, set/clear the assignee (pass null to clear) */
  assignAlert(id: number, assignee: string | null): Promise<{ ok: boolean; assignee: string | null }> {
    return this.request<{ ok: boolean; assignee: string | null }>(`/api/alerts/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignee }),
    });
  }

  // ── Intel ──────────────────────────────────────────────────────────────────

  /** GET /api/intel/space-weather — last 24 NOAA K-index readings (newest first) */
  getSpaceWeather(): Promise<SpaceWeatherReading[]> {
    return this.request<SpaceWeatherReading[]>('/api/intel/space-weather');
  }

  // ── Students ───────────────────────────────────────────────────────────────

  /** GET /api/students — Circles roster, optionally scoped to one campus (site_id) */
  getStudents(siteId?: number, limit = 2000): Promise<Student[]> {
    const qs = siteId != null ? `?site_id=${siteId}&limit=${limit}` : `?limit=${limit}`;
    return this.request<Student[]>(`/api/students${qs}`);
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

  /** POST /api/usage/daily-import — admin only, direct daily Starlink portal totals */
  importDailyUsage(
    date: string,
    entries: DailyUsageImportEntry[],
    source = 'starlink_portal_scraper',
  ): Promise<{ ok: boolean; imported: number }> {
    return this.request<{ ok: boolean; imported: number }>('/api/usage/daily-import', {
      method: 'POST',
      body: JSON.stringify({ date, entries, source }),
    });
  }

  /** POST /api/usage/portal-snapshots — admin only, cumulative portal readings */
  importPortalSnapshots(
    snapshotDate: string,
    entries: PortalSnapshotImportEntry[],
    source = 'starlink_portal_scraper',
  ): Promise<{
    ok: boolean;
    imported_snapshots: number;
    imported_daily_totals: number;
    results: PortalSnapshotImportResult[];
  }> {
    return this.request<{
      ok: boolean;
      imported_snapshots: number;
      imported_daily_totals: number;
      results: PortalSnapshotImportResult[];
    }>('/api/usage/portal-snapshots', {
      method: 'POST',
      body: JSON.stringify({ snapshot_date: snapshotDate, entries, source }),
    });
  }

  /** POST /api/usage/portal-runs — admin only, record scraper start/finish status */
  recordPortalRun(run: PortalScraperRunInput): Promise<{ ok: boolean; run: PortalScraperRun }> {
    return this.request<{ ok: boolean; run: PortalScraperRun }>('/api/usage/portal-runs', {
      method: 'POST',
      body: JSON.stringify(run),
    });
  }

  /** GET /api/usage/portal-runs — admin only, latest scraper audit rows */
  getPortalRuns(limit = 30): Promise<PortalScraperRun[]> {
    return this.request<PortalScraperRun[]>(`/api/usage/portal-runs?limit=${limit}`);
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

  /** GET /api/export/site-usage-daily — admin only, raw daily portal totals */
  exportSiteUsageDailyCsv(from: string, to: string): Promise<string> {
    return this.requestText(`/api/export/site-usage-daily?from=${from}&to=${to}`);
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

  // ── Inventory & Intake ──────────────────────────────────────────────────────

  /** POST /api/inventory/onboard */
  onboardDevice(serialNumber: string): Promise<{ ok: boolean; device: Device }> {
    return this.request<{ ok: boolean; device: Device }>('/api/inventory/onboard', {
      method: 'POST',
      body: JSON.stringify({ serial_number: serialNumber }),
    });
  }

  /** POST /api/inventory/mark-state */
  markDeviceState(input: {
    deviceId: number;
    hardware_status: string;
    symptom_tags?: string[];
    repair_details?: string;
    client_transaction_uuid?: string;
  }): Promise<{ ok: boolean; device: Device }> {
    return this.request<{ ok: boolean; device: Device }>('/api/inventory/mark-state', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** POST /api/inventory/reassign */
  reassignDevice(input: {
    deviceId: number;
    assignee_email: string;
    assignee_type: 'student' | 'staff' | 'pool';
    site_id: number | null;
    client_transaction_uuid?: string;
  }): Promise<{ ok: boolean; device: Device }> {
    return this.request<{ ok: boolean; device: Device }>('/api/inventory/reassign', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** POST /api/inventory/sync */
  syncOfflineQueue(transactions: any[]): Promise<{
    ok: boolean;
    results: Array<{ transaction_uuid: string; status: 'success' | 'failed'; error?: string; note?: string }>;
  }> {
    return this.request<{
      ok: boolean;
      results: Array<{ transaction_uuid: string; status: 'success' | 'failed'; error?: string; note?: string }>;
    }>('/api/inventory/sync', {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    });
  }

  /** GET /api/inventory/devices/:deviceId/logs */
  getDeviceLifecycleLogs(deviceId: number): Promise<any[]> {
    return this.request<any[]>(`/api/inventory/devices/${deviceId}/logs`);
  }

  /** GET /api/inventory/devices/:deviceId/assignments */
  getDeviceAssignments(deviceId: number): Promise<any[]> {
    return this.request<any[]>(`/api/inventory/devices/${deviceId}/assignments`);
  }

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
