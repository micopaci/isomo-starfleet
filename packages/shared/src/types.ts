// ─── Core DB-matching types ───────────────────────────────────────────────────

export interface Site {
  id: number;
  site_master_id?: number | null;
  name: string;
  starlink_sn: string;
  starlink_uuid?: string | null;
  kit_id: string | null;
  location: string | null;
  district?: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  /** From aggregation — null if no data yet */
  signal: SignalSummary | null;
  online_laptops: number;
  total_laptops: number;
  /** Latest daily score (Stage 2+) */
  score: number | null;
  cause: string | null;
  /** Stage 5: rolling 7-day average score */
  score_7day_avg: number | null;
}

export interface SignalSummary {
  snr: number | null;
  pop_latency_ms: number | null;
  obstruction_pct: number | null;
  ping_drop_pct: number | null;
  confidence: 'high' | 'low';
  spread_ms: number | null;
  updatedAt: string;
  /** Stage 5: data quality flag */
  data_quality: 'ok' | 'low_data' | null;
  /** Stage 5: anomaly detected (score dropped >20 pts vs 7-day avg) */
  anomaly: boolean | null;
  /** Stage 5: delta from 7-day average */
  anomaly_delta: number | null;
}

export interface Device {
  id: number;
  site_id: number | null;
  hostname: string | null;
  windows_sn: string;
  manufacturer: string | null;
  model?: string | null;
  intune_device_id: string | null;
  role: 'agent' | 'standard';
  last_seen: string | null;
  agent_last_seen_at?: string | null;
  intune_last_sync_at?: string | null;
  intune_enrolled_at?: string | null;
  site_name: string | null;
  os?: string | null;
  os_version?: string | null;
  compliance_state?: string | null;
  user_principal_name?: string | null;
  device_category?: string | null;
  free_storage_bytes?: number | null;
  total_storage_bytes?: number | null;
  disk_smart_status?: string | null;
  disk_smart_predict_failure?: boolean | null;
  disk_media_type?: string | null;
  /** Intune-first status: online within 9h, stale within 24h, then offline. */
  status: 'online' | 'offline' | 'stale' | 'unknown';
  /** Minutes since last Intune sync, falling back to agent heartbeat. */
  stale_min?: number | null;
  /** Last successful ingest write timestamp (any ingest endpoint). */
  last_ingest_ok_at?: string | null;
}

export interface SignalReading {
  id: number;
  site_id: number;
  device_id: number;
  recorded_at: string;
  pop_latency_ms: number | null;
  snr: number | null;
  obstruction_pct: number | null;
  ping_drop_pct: number | null;
  reporter_count: number;
  confidence: 'high' | 'low';
}

export interface LatencyReading {
  id?: number;
  device_id?: number;
  site_id?: number;
  recorded_at?: string;
  /** Daily aggregate from GET /api/sites/:id/latency */
  date?: string;
  p50_ms: number;
  p95_ms: number;
  spread_ms?: number | null;
  is_outlier?: boolean;
}

export interface DailyScore {
  id?: number;
  site_id?: number;
  date: string;
  score: number;
  cause: string;
  /** Stage 5 */
  data_quality?: 'ok' | 'low_data' | null;
  anomaly?: boolean | null;
  anomaly_delta?: number | null;
}

export interface DeviceHealth {
  id: number;
  device_id: number;
  recorded_at: string;
  battery_pct: number | null;
  battery_health_pct: number | null;
  disk_free_gb: number | null;
  disk_total_gb: number | null;
  disk_usage_pct?: number | null;
  disk_smart_status?: string | null;
  disk_smart_predict_failure?: boolean | null;
  disk_media_type?: string | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
}

export interface ScriptTrigger {
  id: number;
  device_id: number;
  triggered_by: string;
  type: TriggerType;
  triggered_at: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: string | null;
}

export type TriggerType =
  | 'location_refresh'
  | 'data_pull'
  | 'diagnostics'
  | 'ping_dish'
  | 'reboot_starlink';

export interface User {
  id: number;
  email: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

// ─── Composite / API response types ──────────────────────────────────────────

export interface SiteDetail extends Site {
  devices: Device[];
}

export interface UsageHistoryPoint {
  month: string;
  managed_mb: number;
  total_mb: number | null;
  unmanaged_est_mb: number | null;
  confidence: 'managed_only' | 'estimated_unmanaged';
}

export interface FleetSummary {
  sites: Site[];
  total_sites: number;
  online_sites: number;
  degraded_sites: number;
  dark_sites: number;
  total_laptops: number;
  online_laptops: number;
  /** Stage 5 */
  stale_devices: number;
  anomaly_sites: number;
}

// ─── WebSocket event payloads ─────────────────────────────────────────────────

export interface WsDeviceOnlineEvent {
  type: 'device_online';
  device_id: number;
  site_id: number;
}

export interface WsSignalUpdateEvent {
  type: 'signal_update';
  site_id: number;
  signal: SignalSummary;
}

/** Stage 5 — watchdog broadcasts stale device list every 10 min */
export interface WsStaleDevicesEvent {
  type: 'stale_devices';
  devices: Array<{
    device_id: number;
    site_id: number;
    hostname: string | null;
    stale_min: number;
  }>;
}

export type WsEvent = WsDeviceOnlineEvent | WsSignalUpdateEvent | WsStaleDevicesEvent;
