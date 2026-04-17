import { useState, useEffect, useCallback } from 'react';
import type {
  Site, SiteDetail, DailyScore, LatencyReading, FleetSummary, Device,
  WsStaleDevicesEvent,
} from './types';
import type { StarfleetApi } from './api';
import type { StarfleetWS } from './ws-client';
import { siteStatus } from './utils';

// ─── Context helpers — apps provide api + ws via these refs ───────────────────
// (Avoids React Context dependency — works in React Native too)

let _api: StarfleetApi | null = null;
let _ws: StarfleetWS | null = null;

export function setSharedApiClient(api: StarfleetApi): void { _api = api; }
export function setSharedWsClient(ws: StarfleetWS): void   { _ws  = ws;  }

function useApi(): StarfleetApi {
  if (!_api) throw new Error('StarfleetApi not initialised — call setSharedApiClient first');
  return _api;
}

// ─── useFleetSummary ──────────────────────────────────────────────────────────

export function useFleetSummary(): {
  sites: Site[];
  summary: FleetSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const api = useApi();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleCount, setStaleCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSites();
      setSites(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Live: on device_online or signal_update refresh the sites list
  useEffect(() => {
    if (!_ws) return;
    const unsub1 = _ws.on('device_online', () => { load(); });
    const unsub2 = _ws.on('signal_update', (evt) => {
      setSites(prev => prev.map(s =>
        s.id === evt.site_id ? { ...s, signal: evt.signal } : s,
      ));
    });
    // Stage 5: watchdog broadcasts stale device count
    const unsub3 = _ws.on('stale_devices', (evt: WsStaleDevicesEvent) => {
      setStaleCount(evt.devices.length);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [load]);

  const summary: FleetSummary | null = sites.length === 0 ? null : {
    sites,
    total_sites:    sites.length,
    online_sites:   sites.filter(s => siteStatus(s) === 'online').length,
    degraded_sites: sites.filter(s => siteStatus(s) === 'degraded').length,
    dark_sites:     sites.filter(s => siteStatus(s) === 'dark').length,
    total_laptops:  sites.reduce((a, s) => a + s.total_laptops, 0),
    online_laptops: sites.reduce((a, s) => a + s.online_laptops, 0),
    stale_devices:  staleCount,
    anomaly_sites:  sites.filter(s => {
      const sig = s.signal;
      return sig?.anomaly === true;
    }).length,
  };

  return { sites, summary, loading, error, refresh: load };
}

// ─── useSite ──────────────────────────────────────────────────────────────────

export function useSite(id: number | null): {
  site: SiteDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const api = useApi();
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (id == null) { setSite(null); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSite(id);
      setSite(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => { load(); }, [load]);

  // Live signal updates for this site
  useEffect(() => {
    if (!_ws || id == null) return;
    const unsub = _ws.on('signal_update', (evt) => {
      if (evt.site_id === id) {
        setSite(prev => prev ? { ...prev, signal: evt.signal } : prev);
      }
    });
    return unsub;
  }, [id]);

  // Live stale device updates — mark devices as stale without full reload
  useEffect(() => {
    if (!_ws || id == null) return;
    const unsub = _ws.on('stale_devices', (evt: WsStaleDevicesEvent) => {
      setSite(prev => {
        if (!prev) return prev;
        const staleIds = new Set(evt.devices.map(d => d.device_id));
        const staleMins = new Map(evt.devices.map(d => [d.device_id, d.stale_min]));
        return {
          ...prev,
          devices: prev.devices.map(d => staleIds.has(d.id)
            ? { ...d, status: 'stale' as const, stale_min: staleMins.get(d.id) ?? null }
            : d
          ),
        };
      });
    });
    return unsub;
  }, [id]);

  return { site, loading, error, refresh: load };
}

// ─── useSignalHistory ─────────────────────────────────────────────────────────

export function useSignalHistory(siteId: number | null): {
  scores: DailyScore[];
  loading: boolean;
  hasAnomalies: boolean;
  hasLowData: boolean;
} {
  const api = useApi();
  const [scores, setScores] = useState<DailyScore[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (siteId == null) { setScores([]); return; }
    setLoading(true);
    api.getSignalHistory(siteId)
      .then(setScores)
      .catch(() => setScores([]))
      .finally(() => setLoading(false));
  }, [api, siteId]);

  const hasAnomalies = scores.some(s => s.anomaly === true);
  const hasLowData   = scores.some(s => s.data_quality === 'low_data');

  return { scores, loading, hasAnomalies, hasLowData };
}

// ─── useLatencyHistory ────────────────────────────────────────────────────────

export function useLatencyHistory(siteId: number | null): {
  readings: LatencyReading[];
  loading: boolean;
} {
  const api = useApi();
  const [readings, setReadings] = useState<LatencyReading[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (siteId == null) { setReadings([]); return; }
    setLoading(true);
    api.getLatencyHistory(siteId)
      .then(setReadings)
      .catch(() => setReadings([]))
      .finally(() => setLoading(false));
  }, [api, siteId]);

  return { readings, loading };
}

// ─── useStaleDevices ──────────────────────────────────────────────────────────
// Real-time stale device list, fed by watchdog WS broadcast + initial API poll.

export function useStaleDevices(): {
  devices: Device[];
  loading: boolean;
  refresh: () => void;
} {
  const api = useApi();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDevices('stale');
      setDevices(data);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Update from WS push (avoids polling)
  useEffect(() => {
    if (!_ws) return;
    const unsub = _ws.on('stale_devices', (evt: WsStaleDevicesEvent) => {
      // Map WS payload to Device shape (partial — only what watchdog provides)
      setDevices(evt.devices.map(d => ({
        id:               d.device_id,
        site_id:          d.site_id,
        hostname:         d.hostname,
        windows_sn:       '',
        manufacturer:     null,
        intune_device_id: null,
        role:             'standard' as const,
        last_seen:        null,
        site_name:        null,
        status:           'stale' as const,
        stale_min:        d.stale_min,
      })));
    });
    return unsub;
  }, []);

  return { devices, loading, refresh: load };
}
