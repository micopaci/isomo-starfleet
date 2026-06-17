import React, { createContext, useContext, useState, useEffect } from 'react';

// Mapped types matching mockData structure but loaded with real data
export type Status = 'online' | 'degraded' | 'offline' | 'inactive';

export interface Dish {
  name: string;
  campus: string;
  region: string;
  status: Status;
  latency: number;
  snr: number;
  down: number;
  up: number;
  uptime: number;
  rain: number;
  laptops: number;
  serial: string;
  lat_coord: number;
  lng_coord: number;
  spark: number[];
  pingDrop: number;
  agent: boolean;
}

export interface Alert {
  id: string;
  sev: 'critical' | 'warning' | 'inventory' | 'info';
  time: string;
  msg: string;
  meta: string;
  open: boolean;
  ageDays: number;
  profile_number?: string;
}

export interface InventoryDevice {
  id: number;
  profile: string;
  serial: string;
  model: string;
  status: 'working' | 'broken' | 'ready' | 'decommissioned';
  assignee: string;
  lastIntake: string;
  operator: string;
  mismatch: boolean;
  hoursOnline?: number;
  lastSeenAt: number | null;
  online: boolean;
}

export interface Intel {
  kpIndex: number | null;
  kpLabel: string | null;
  satCount: number | null;
}

interface DataContextType {
  dishes: Dish[];
  alerts: Alert[];
  inventory: InventoryDevice[];
  intel: Intel;
  loading: boolean;
  refreshData: () => Promise<void>;
}

// Devices that checked in within this window count as "online / reporting".
// Matches the backend watchdog "healthy" threshold (72h).
const ONLINE_WINDOW_MS = 72 * 60 * 60 * 1000;

function kpConditionLabel(kp: number): string {
  if (kp >= 5) return 'storm';
  if (kp >= 4) return 'unsettled';
  return 'quiet';
}

const DataContext = createContext<DataContextType | undefined>(undefined);

function getRegionForDistrict(district: string | null): string {
  if (!district) return 'Central';
  const d = district.trim().toLowerCase();
  if (['gasabo', 'kicukiro', 'nyarugenge'].includes(d)) return 'Central';
  if (['burera', 'gakenke', 'gicumbi', 'musanze', 'rulindo'].includes(d)) return 'Northern';
  if (['gisagara', 'huye', 'kamonyi', 'muhanga', 'nyagabihu', 'nyamagabe', 'nyanza', 'nyaruguru', 'ruhango'].includes(d)) return 'Southern';
  if (['bugesera', 'gatsibo', 'kayonza', 'kirehe', 'ngoma', 'nyagatare', 'rwamagana'].includes(d)) return 'Eastern';
  if (['karongi', 'ngororero', 'nyabihu', 'nyamasheke', 'rubavu', 'rusizi', 'rutsiro'].includes(d)) return 'Western';
  return 'Central';
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [inventory, setInventory] = useState<InventoryDevice[]>([]);
  const [intel, setIntel] = useState<Intel>({ kpIndex: null, kpLabel: null, satCount: null });
  const [loading, setLoading] = useState(true);

  const refreshIntel = async (headers: Record<string, string>) => {
    // Best-effort; each call has its own timeout so a slow/hanging endpoint
    // (satellites does live propagation) never affects the rest of the HUD.
    const fetchJson = async (url: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    let kpIndex: number | null = null;
    try {
      const kpRows = await fetchJson('/api/intel/space-weather');
      if (Array.isArray(kpRows) && kpRows.length > 0) kpIndex = Number(kpRows[0].k_index);
    } catch { /* leave Kp null */ }
    setIntel(prev => ({ ...prev, kpIndex, kpLabel: kpIndex != null ? kpConditionLabel(kpIndex) : null }));

    try {
      const satJson = await fetchJson('/api/intel/satellites');
      const satCount = typeof satJson?.count === 'number'
        ? satJson.count
        : Array.isArray(satJson?.satellites) ? satJson.satellites.length : null;
      setIntel(prev => ({ ...prev, satCount }));
    } catch { /* leave satCount null */ }
  };

  const refreshData = async () => {
    const token = localStorage.getItem('sf_token');
    if (!token) return;

    try {
      const headers = { Authorization: `Bearer ${token}` };

      // 1. Fetch Alerts
      const alertsRes = await fetch('/api/alerts', { headers });
      if (alertsRes.status === 401) {
        localStorage.removeItem('sf_token');
        localStorage.removeItem('sf_auth');
        window.location.replace('/login');
        return;
      }
      const rawAlerts = await alertsRes.json();
      
      const mappedAlerts: Alert[] = Array.isArray(rawAlerts) ? rawAlerts.map((a: any) => ({
        id: a.id,
        sev: a.category === 'inventory' ? 'inventory' : a.severity,
        msg: a.message,
        meta: a.title,
        time: new Date(a.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ageDays: Math.floor((Date.now() - new Date(a.detected_at).getTime()) / 86400000),
        open: a.status === 'open',
        profile_number: a.metadata?.profile_number
      })) : [];

      const mismatchIds = new Set<number>(
        rawAlerts && Array.isArray(rawAlerts) 
          ? rawAlerts.filter((a: any) => a.category === 'inventory' && a.status === 'open').map((a: any) => Number(a.source_id))
          : []
      );

      // 2. Fetch Sites
      const sitesRes = await fetch('/api/sites', { headers });
      const rawSites = await sitesRes.json();
      
      const mappedDishes: Dish[] = Array.isArray(rawSites) ? rawSites.map((s: any) => {
        const terminal = s.starlink_terminal;
        const statusVal = terminal?.current_status?.toLowerCase();
        // Cloud terminal status when present; otherwise derive from signal
        // freshness. With no telemetry at all we treat the dish as offline
        // (unreachable) rather than inventing a "degraded" state.
        const hasSignal = s.signal && s.signal.snr != null;
        const status: Status =
          statusVal === 'inactive' ? 'inactive' :
          statusVal === 'online' ? 'online' :
          statusVal === 'offline' ? 'offline' :
          statusVal === 'degraded' ? 'degraded' :
          hasSignal ? 'online' : 'offline';

        const consumedGb = terminal?.usage_trend?.map((t: any) => Number(t.consumed_gb)) || [];
        const spark = consumedGb.length > 0 ? consumedGb.slice(-10) : [0,0,0,0,0,0,0,0,0,0];
        while (spark.length < 10) {
          spark.unshift(0);
        }

        return {
          name: s.name,
          campus: s.district || 'Unassigned',
          region: getRegionForDistrict(s.district),
          status,
          latency: Number(terminal?.latest_ping_latency_ms || 0),
          // 0 == "no data" by convention; callers render it as "—".
          // Never fabricate a placeholder SNR when there is no signal.
          snr: Number(s.signal?.snr ?? 0),
          down: Number(s.download_mbps || 0),
          up: Number(s.upload_mbps || 0),
          uptime: Number(s.uptime_pct ?? 0),
          rain: Number(s.weather?.rainfall_mm || 0),
          laptops: Number(s.total_laptops || 0),
          serial: s.starlink_sn,
          lat_coord: Number(s.lat || 0),
          lng_coord: Number(s.lng || 0),
          spark,
          pingDrop: Number(terminal?.latest_ping_drop_pct || 0),
          agent: s.total_laptops > 0,
        };
      }) : [];

      // 3. Fetch Devices (Inventory)
      const inventoryRes = await fetch('/api/inventory', { headers });
      const rawInventory = await inventoryRes.json();

      const mappedInventory: InventoryDevice[] = Array.isArray(rawInventory) ? rawInventory.map((r: any) => {
        let status: 'working' | 'broken' | 'ready' | 'decommissioned' = 'working';
        const hs = r.hardware_status;
        if (hs === 'working_in_use' || hs === 'working_spare') status = 'working';
        else if (hs === 'intake_broken' || hs === 'in_repair') status = 'broken';
        else if (hs === 'ready_to_reissue') status = 'ready';
        else if (hs === 'decommissioned') status = 'decommissioned';

        const lastSeenAt = r.last_seen_at ? new Date(r.last_seen_at).getTime() : null;
        const online = lastSeenAt != null && (Date.now() - lastSeenAt) <= ONLINE_WINDOW_MS;

        return {
          id: Number(r.id),
          profile: r.profile_number || `LAP-${String(r.id).padStart(3, '0')}`,
          serial: r.serial_number || '—',
          model: r.model || 'Unknown Laptop',
          status,
          assignee: r.assignee_email || '—',
          lastIntake: r.last_action_at ? new Date(r.last_action_at).toISOString().split('T')[0] : '—',
          operator: r.last_operator || '—',
          mismatch: mismatchIds.has(r.id),
          lastSeenAt,
          online,
        };
      }) : [];

      setDishes(mappedDishes);
      setAlerts(mappedAlerts);
      setInventory(mappedInventory);

      // 4. Fetch space-weather (Kp) + visible satellites for the mini HUD.
      //    Fire-and-forget: the satellites endpoint runs live SGP4 propagation
      //    and can be slow, so it must never block (or stall) the main load.
      void refreshIntel(headers);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const isAuth = localStorage.getItem('sf_auth') === 'true';
    if (isAuth) {
      refreshData();
    } else {
      setLoading(false);
    }
  }, []);

  return (
    <DataContext.Provider value={{ dishes, alerts, inventory, intel, loading, refreshData }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
