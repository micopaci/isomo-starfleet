export interface SignalSnapshot {
  ping_drop_pct?: number | null;
  obstruction_pct?: number | null;
  snr?: number | null;
  pop_latency_ms?: number | null;
  updatedAt?: string | null;
  confidence?: 'low' | 'medium' | 'high' | string | null;
  anomaly?: boolean | null;
}

export interface Device {
  id: number;
  site_id?: number | null;
  site_name?: string | null;
  hostname?: string | null;
  role?: string | null;
  status?: 'online' | 'stale' | 'offline' | string | null;
  last_seen?: string | null;
  stale_min?: number | null;
  manufacturer?: string | null;
  windows_sn?: string | null;
  intune_device_id?: string | null;
}

export interface DeviceHealth {
  battery_pct?: number | null;
  battery_health_pct?: number | null;
  disk_free_gb?: number | null;
  disk_total_gb?: number | null;
  ram_used_mb?: number | null;
  ram_total_mb?: number | null;
  recorded_at: string;
}

export interface Site {
  id: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  score?: number | null;
  score_7day_avg?: number | null;
  site_code?: string | null;
  site_type?: string | null;
  dishes_online?: number | null;
  dishes_total?: number | null;
  online_laptops?: number | null;
  total_laptops?: number | null;
  starlink_sn?: string | null;
  kit_id?: string | null;
  signal?: SignalSnapshot | null;
  devices: Device[];
  [key: string]: unknown;
}

export interface SiteDetail extends Site {}

export interface DailyScore {
  date: string;
  score: number;
}

export interface FleetSummary {
  total_sites: number;
  online_sites: number;
  degraded_sites: number;
  dark_sites: number;
  online_laptops: number;
  total_laptops: number;
}

export class StarfleetApi {
  constructor(baseUrl: string, getToken?: () => string, onAuthError?: () => void);
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  login(email: string, password: string): Promise<{ token: string }>;
  getSites(): Promise<Site[]>;
  getSite(siteId: number): Promise<SiteDetail>;
  getSignalHistory(siteId: number): Promise<DailyScore[]>;
  getDevices(status?: string): Promise<Device[]>;
  triggerScript(deviceId: number, scriptType: string): Promise<unknown>;
}

export class StarfleetWS {
  connect(url: string, token?: string): void;
  disconnect(): void;
}

export function setSharedApiClient(client: StarfleetApi | null): void;
export function setSharedWsClient(client: StarfleetWS | null): void;
export function computeSignalScore(input: SignalSnapshot): number;
export function predictCause(input: SignalSnapshot): string;
export function siteStatus(site: Site): 'online' | 'degraded' | 'dark';

export function useFleetSummary(): {
  sites: Site[];
  summary: FleetSummary | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

export function useSite(siteId: number): {
  site: SiteDetail | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

export function useSignalHistory(siteId: number): {
  scores: DailyScore[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
