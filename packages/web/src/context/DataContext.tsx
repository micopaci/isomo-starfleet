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
  obstruction: number;
  alignmentAz: number | null;
  alignmentEl: number | null;
  down: number;
  up: number;
  uptime: number;
  rain: number;
  laptops: number;
  serial: string;
  kitId: string | null;
  lat_coord: number;
  lng_coord: number;
  spark: number[];
  pingDrop: number;
  agent: boolean;
  dataGb: number; // data consumed over the last 7 days (from portal usage sync)
  lastSeen: string | null;        // last telemetry seen (terminal or ping), ISO
  statusUpdatedAt: string | null; // when current_status last changed, ISO
  latestUsageDate: string | null; // date of most recent daily usage record
  billingCycleStart: string | null;
  accountId: string | null;
  serviceLineId: string | null;
  decommissionedAt: string | null;
  decommissionReason: string | null;
  sourceType: 'terminal' | 'retired_asset';
  replacementKitId: string | null;
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

export type Connectivity = 'online' | 'stale' | 'offline' | 'unknown';

export interface InventoryDevice {
  id: number;
  profile: string;
  hostname: string;
  serial: string;
  model: string;
  status: 'working' | 'broken' | 'ready' | 'decommissioned';
  connectivity: Connectivity;
  os: string;
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
  inactiveDishes: Dish[];
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
  const [inactiveDishes, setInactiveDishes] = useState<Dish[]>([]);
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
        // A terminal with a decommission date is inactive no matter what
        // current_status says — the status sync can re-seed current_status back
        // to Offline, but the decommission decision is sticky.
        const isDecommissioned = !!terminal?.decommissioned_at;
        // Cloud terminal status when present; otherwise derive from signal
        // freshness. With no telemetry at all we treat the dish as offline
        // (unreachable) rather than inventing a "degraded" state.
        const hasSignal = s.signal && s.signal.snr != null;
        const status: Status =
          isDecommissioned ? 'inactive' :
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
        const dataGb = consumedGb.slice(-7).reduce((sum: number, v: any) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
        const portalName = String(terminal?.nickname || '').trim();
        const displayName = portalName && !['disabled', 'dead'].includes(portalName.toLowerCase()) ? portalName : s.name;

        return {
          // Prefer the terminal's portal nickname, except for generic inactive
          // labels that hide the real site identity.
          name: displayName,
          campus: s.name || s.district || 'Unassigned',
          region: getRegionForDistrict(s.district),
          status,
          latency: Number(terminal?.latest_ping_latency_ms || 0),
          // 0 == "no data" by convention; callers render it as "—".
          // Never fabricate a placeholder SNR when there is no signal.
          snr: Number(s.signal?.snr ?? 0),
          obstruction: Number(s.signal?.obstruction_pct ?? 0),
          alignmentAz: s.signal?.boresight_azimuth_deg ?? null,
          alignmentEl: s.signal?.boresight_elevation_deg ?? null,
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
          dataGb,
          lastSeen: terminal?.latest_usage?.log_date || terminal?.last_seen_utc || terminal?.latest_ping?.last_seen_utc || null,
          statusUpdatedAt: terminal?.status_updated_at || null,
          latestUsageDate: terminal?.latest_usage?.log_date || null,
          billingCycleStart: terminal?.billing_cycle_start || null,
          accountId: terminal?.account_id || null,
          serviceLineId: terminal?.service_line_id || s.starlink_sn || null,
          decommissionedAt: terminal?.decommissioned_at || null,
          decommissionReason: terminal?.decommission_reason || null,
          kitId: terminal?.kit_id || s.kit_id || null,
          sourceType: 'terminal',
          replacementKitId: terminal?.replacement_kit_id || null,
        };
      }) : [];

      // 2b. Inactive (portal-suspended) terminals — kept SEPARATE from dishes.
      // /api/sites is site-centric (one active terminal per site), so disabled
      // service lines (dead/replaced kits) never surface there. Pull them from the
      // terminal-centric endpoint into their own list so the Starlinks page can
      // show them (Inactive tab) WITHOUT inflating Overview/Reports/Map totals,
      // which keep using the site-based `dishes` above.
      const seenLines = new Set<string>(
        Array.isArray(rawSites)
          ? rawSites.map((s: any) => s.starlink_terminal?.service_line_id).filter(Boolean)
          : []
      );
      const mappedInactive: Dish[] = [];
      try {
        const termRes = await fetch('/api/starlink-terminals', { headers });
        const termJson = await termRes.json();
        const terminals: any[] = Array.isArray(termJson?.terminals) ? termJson.terminals : [];
        for (const t of terminals) {
          // Decommissioned terminals live ONLY in the dedicated Decommissioned
          // view — never in the Starlinks fleet list (avoids duplication).
          if (t.decommissioned_at) continue;
          if (String(t.current_status || '').toLowerCase() !== 'inactive') continue;
          if (t.service_line_id && seenLines.has(t.service_line_id)) continue;
          const consumed = Array.isArray(t.usage_trend) ? t.usage_trend.map((u: any) => Number(u.consumed_gb)) : [];
          const spark = consumed.length > 0 ? consumed.slice(-10) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          while (spark.length < 10) spark.unshift(0);
          const inactiveDataGb = consumed.slice(-7).reduce((sum: number, v: any) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
          mappedInactive.push({
            name: t.nickname || t.site_name || t.service_line_id,
            campus: t.site_name || 'Unassigned',
            region: '—',
            status: 'inactive',
            latency: 0, snr: 0, obstruction: 0, alignmentAz: null, alignmentEl: null, down: 0, up: 0, uptime: 0, rain: 0, laptops: 0,
            serial: t.service_line_id,
            lat_coord: 0, lng_coord: 0,
            spark,
            pingDrop: 0,
            agent: false,
            dataGb: inactiveDataGb,
            lastSeen: t.latest_usage?.log_date || t.last_seen_utc || null,
            statusUpdatedAt: t.status_updated_at || null,
            latestUsageDate: t.latest_usage?.log_date || null,
            billingCycleStart: t.billing_cycle_start || null,
            accountId: t.account_id || null,
            serviceLineId: t.service_line_id || null,
            decommissionedAt: t.decommissioned_at || null,
            decommissionReason: t.decommission_reason || null,
            kitId: t.kit_id || null,
            sourceType: t.source_type === 'retired_asset' ? 'retired_asset' : 'terminal',
            replacementKitId: t.replacement_kit_id || null,
          });
        }
      } catch (err) {
        console.error('Failed to load inactive terminals:', err);
      }

      // 3. Fetch Devices (Inventory)
      const inventoryRes = await fetch('/api/devices', { headers });
      const rawInventory = await inventoryRes.json();

      const mappedInventory: InventoryDevice[] = Array.isArray(rawInventory) ? rawInventory.map((r: any) => {
        let status: 'working' | 'broken' | 'ready' | 'decommissioned' = 'working';
        const hs = r.hardware_status;
        if (hs === 'working_in_use' || hs === 'working_spare') status = 'working';
        else if (hs === 'intake_broken' || hs === 'in_repair') status = 'broken';
        else if (hs === 'ready_for_reissue' || hs === 'ready_to_reissue') status = 'ready';
        else if (hs === 'decommissioned') status = 'decommissioned';

        const lastSeenAt = r.last_seen ? new Date(r.last_seen).getTime() : null;
        const online = lastSeenAt != null && (Date.now() - lastSeenAt) <= ONLINE_WINDOW_MS;

        // Connectivity is the backend's freshness verdict (online/stale/offline/
        // unknown) and is independent of the hardware lifecycle status. A device
        // that simply hasn't checked in is "offline", never "decommissioned".
        const connRaw = String(r.status || '').toLowerCase();
        const connectivity: Connectivity =
          connRaw === 'online' || connRaw === 'stale' || connRaw === 'offline' ? connRaw : 'unknown';

        return {
          id: Number(r.id),
          profile: r.profile_number || `LAP-${String(r.id).padStart(3, '0')}`,
          hostname: r.hostname || '—',
          serial: r.windows_sn || '—',
          model: r.model || 'Unknown Device',
          status,
          connectivity,
          os: r.os_version || r.os || '—',
          assignee: r.user_principal_name || '—',
          lastIntake: r.intune_enrolled_at ? new Date(r.intune_enrolled_at).toISOString().split('T')[0] : '—',
          operator: r.site_name || '—',
          mismatch: mismatchIds.has(r.id),
          lastSeenAt,
          online,
        };
      }) : [];

      // Decommissioned dishes are excluded from the active fleet entirely — they
      // belong only in the Decommissioned view, not the Starlinks list / Overview
      // / Map / Reports (prevents the same dish appearing in two places).
      setDishes(mappedDishes.filter(d => !d.decommissionedAt));
      setInactiveDishes(mappedInactive);
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
    <DataContext.Provider value={{ dishes, inactiveDishes, alerts, inventory, intel, loading, refreshData }}>
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
