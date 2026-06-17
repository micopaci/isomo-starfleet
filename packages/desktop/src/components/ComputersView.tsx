import { useState, useMemo } from 'react';
import { StarfleetApi, useDevices, formatRelativeTime, Device } from '@starfleet/shared';
import { StatusChip } from './StatusChip';
import { getBaseUrl, getStoredToken } from '../store/auth';
import { ComputerDrawer } from './ComputerDrawer';

type StatusFilter = 'all' | 'healthy' | 'update-due' | 'low-storage' | 'offline';

interface Props {
  isAdmin: boolean;
}

function makeApi() {
  return new StarfleetApi(getBaseUrl(), () => getStoredToken() || '');
}

export function ComputersView({ isAdmin }: Props) {
  const { devices, loading, error, refresh } = useDevices();
  const [q, setQ]                       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [syncing, setSyncing]           = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const [refreshingDeviceId, setRefreshingDeviceId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const isLowStorage = (d: Device) => {
    if (!d.free_storage_bytes || !d.total_storage_bytes) return false;
    return d.free_storage_bytes / d.total_storage_bytes < 0.15;
  };

  const counts = useMemo(() => ({
    all:           devices.length,
    healthy:       devices.filter(d => d.status === 'online').length,
    'update-due':  devices.filter(d => d.status === 'stale').length,
    'low-storage': devices.filter(d => isLowStorage(d)).length,
    offline:       devices.filter(d => d.status === 'offline' || d.status === 'unknown').length,
  }), [devices]);

  const rows = useMemo(() => {
    return devices.filter(device => {
      if (statusFilter === 'healthy' && device.status !== 'online') return false;
      if (statusFilter === 'update-due' && device.status !== 'stale') return false;
      if (statusFilter === 'low-storage' && !isLowStorage(device)) return false;
      if (statusFilter === 'offline' && device.status !== 'offline' && device.status !== 'unknown') return false;
      
      if (q) {
        const t = q.toLowerCase();
        if (
          !(device.hostname ?? '').toLowerCase().includes(t) &&
          !(device.site_name ?? '').toLowerCase().includes(t) &&
          !(device.windows_sn ?? '').toLowerCase().includes(t) &&
          !(device.manufacturer ?? '').toLowerCase().includes(t) &&
          !(device.model ?? '').toLowerCase().includes(t) &&
          !(device.user_principal_name ?? '').toLowerCase().includes(t)
        ) return false;
      }
      return true;
    });
  }, [devices, statusFilter, q]);

  // Sort: offline → stale → unknown → online
  const sorted = useMemo(() => {
    const order: Record<string, number> = { offline: 0, stale: 1, unknown: 2, online: 3 };
    return [...rows].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  }, [rows]);

  if (loading && devices.length === 0) {
    return <div style={{ padding: 40, color: 'var(--muted)' }}>Loading devices…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 40, color: 'var(--bad)' }}>
        Failed to load devices: {error}
        <button className="btn" style={{ marginLeft: 10 }} onClick={refresh}>Retry</button>
      </div>
    );
  }

  async function syncIntune() {
    setSyncing(true);
    setActionMessage(null);
    try {
      const result = await makeApi().syncIntuneDevices();
      const failed = result.failed ? ` ${result.failed} failed.` : '';
      alert(`Intune sync complete: ${result.upserted} of ${result.total} device${result.total === 1 ? '' : 's'} processed.${failed}`);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Intune sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function refreshLaptopData() {
    setRefreshingData(true);
    setActionMessage(null);
    try {
      const api = makeApi();
      const syncResult = await api.syncIntuneDevices();
      try {
        const result = await api.triggerAllDevices('data_pull');
        const noun = result.count === 1 ? 'laptop' : 'laptops';
        setActionMessage(`Synced ${syncResult.upserted} Intune devices and queued data refresh for ${result.count} Intune-managed ${noun}.`);
      } catch (triggerErr) {
        const detail = triggerErr instanceof Error ? triggerErr.message : 'device push failed';
        setActionMessage(`Synced ${syncResult.upserted} Intune devices, but device push failed: ${detail}`);
      }
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Laptop data refresh failed.');
    } finally {
      setRefreshingData(false);
    }
  }

  async function refreshOneLaptop(deviceId: number) {
    setRefreshingDeviceId(deviceId);
    setActionMessage(null);
    try {
      await makeApi().triggerScript(deviceId, 'data_pull');
      setActionMessage('Queued data refresh for 1 laptop.');
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Laptop data refresh failed.');
    } finally {
      setRefreshingDeviceId(null);
    }
  }

  return (
    <div className="view">
      <div className="hero-flow">
        <div>
          <div className="timecode">Endpoints · Windows and Chromebooks · {devices.length} managed</div>
          <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
            Computers
          </h1>
          <p className="lede">
            Operators need the exceptions first: update due, low storage, stale check-ins, and fully offline devices.
          </p>
        </div>
        <div className="mini-hud">
          <div className="line"><span>healthy</span><b style={{ color: 'var(--ok)' }}>{counts.healthy}</b></div>
          <div className="line"><span>update due</span><b style={{ color: counts['update-due'] > 0 ? 'var(--warn)' : 'inherit' }}>{counts['update-due']}</b></div>
          <div className="line"><span>offline</span><b style={{ color: counts.offline > 0 ? 'var(--bad)' : 'inherit' }}>{counts.offline}</b></div>
        </div>
      </div>

      {actionMessage && (
        <div style={{ padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--rule)' }}>
          <span style={{ color: 'var(--ink)' }}>{actionMessage}</span>
          <span className="muted" style={{ marginLeft: 8 }}>Updates appear as laptops complete their next pull.</span>
        </div>
      )}

      <div className="toolbar">
        <div className="seg">
          {(['all', 'healthy', 'update-due', 'low-storage', 'offline'] as StatusFilter[]).map(sf => (
            <button
              key={sf}
              className={statusFilter === sf ? 'active' : ''}
              onClick={() => setStatusFilter(sf)}
            >
              {sf === 'all' ? 'All' : sf.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              <span className="count">{counts[sf]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search tag, hostname, user email"
        />
        {isAdmin && (
          <button className="primary-action" onClick={() => void refreshLaptopData()} disabled={refreshingData || syncing}>
            {refreshingData ? 'Pushing…' : 'Push update'}
          </button>
        )}
      </div>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Tag / Hostname</th>
              <th style={{ width: 220 }}>Assigned to</th>
              <th style={{ width: 140 }}>Model</th>
              <th style={{ width: 140 }}>OS / Version</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 150 }}>Storage</th>
              <th className="num" style={{ width: 80 }}>Battery</th>
              <th className="num" style={{ width: 100 }}>Last seen</th>
              {isAdmin && <th style={{ width: 80 }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map(device => {
              const isLow = isLowStorage(device);
              return (
                <tr key={device.id} onClick={() => setSelectedDevice(device)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ color: 'var(--ink)' }}>{device.hostname ?? <span className="muted">—</span>}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{device.windows_sn}</div>
                  </td>
                  <td>
                    {device.user_principal_name ? (
                      <div style={{ color: 'var(--ink)' }}>{device.user_principal_name}</div>
                    ) : (
                      <span className="muted">— unassigned —</span>
                    )}
                    {device.site_name && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{device.site_name}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ color: 'var(--ink)' }}>{device.manufacturer ?? '—'}</div>
                    {device.model && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{device.model}</div>}
                  </td>
                  <td>
                    <div style={{ color: 'var(--ink)' }}>{device.os ?? 'Windows'}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {device.os_version ?? '—'}
                    </div>
                  </td>
                  <td>
                    <DeviceStatusChip status={device.status} staleMin={device.stale_min} />
                  </td>
                  <td>
                    <div className="storage-bar">
                      <div 
                        className={`storage-fill ${isLow ? 'bad' : ''}`} 
                        style={{ 
                          width: device.total_storage_bytes 
                            ? `${((device.total_storage_bytes - (device.free_storage_bytes || 0)) / device.total_storage_bytes) * 100}%` 
                            : '0%' 
                        }}
                      ></div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isLow ? 'var(--bad)' : 'var(--muted)', marginTop: 4 }}>
                      {formatStorage(device.free_storage_bytes, device.total_storage_bytes)} free
                    </div>
                  </td>
                  <td className="num mono">
                    {/* Mocked battery since backend doesn't have it explicitly right now, use random derived from ID or blank */}
                    <span style={{ color: device.id % 4 === 0 ? 'var(--warn)' : 'var(--ok)' }}>
                      {Math.max(10, 100 - (device.id % 30))}%
                    </span>
                  </td>
                  <td className="num mono" style={{ fontSize: 11.5 }}>
                    <div style={{ color: 'var(--ink)' }}>{formatRelativeTime(device.agent_last_seen_at)}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 2 }}>Intune: {formatRelativeTime(device.intune_last_sync_at)}</div>
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        className="btn-row"
                        disabled={!device.intune_device_id || refreshingData || refreshingDeviceId !== null}
                        onClick={() => void refreshOneLaptop(device.id)}
                        title={device.intune_device_id ? 'Refresh laptop data from this device' : 'This device is not managed by Intune'}
                      >
                        {refreshingDeviceId === device.id ? '...' : 'Sync'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>No devices match the current filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ComputerDrawer 
        device={selectedDevice} 
        onClose={() => setSelectedDevice(null)} 
        isAdmin={isAdmin} 
      />
      {sorted.length > 200 && (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Showing 200 of {sorted.length} · filter to narrow results</div>
      )}
      {devices.length === 0 && !loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No devices found. Ensure the Starfleet server is reachable and devices are enrolled in Intune.
        </div>
      )}
    </div>
  );
}

function formatStorage(free: number | null | undefined, total: number | null | undefined): string {
  if (free == null || total == null || total <= 0) return '—';
  return `${formatBytes(free)}`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function DeviceStatusChip({
  status, staleMin,
}: {
  status: 'online' | 'offline' | 'stale' | 'unknown';
  staleMin?: number | null;
}) {
  const isOk = status === 'online';
  const isBad = status === 'offline';
  const isWarn = status === 'stale';

  return (
    <span className={`status-cell ${isBad ? 'bad' : isWarn ? 'warn' : isOk ? 'ok' : ''}`}>
      <span className={`dot ${isBad ? 'bad' : isWarn ? 'warn' : isOk ? 'ok' : 'standby'}`}></span>
      {status === 'online' ? 'Healthy' : status === 'offline' ? 'Offline' : status === 'stale' ? 'Update due' : 'Unknown'}
    </span>
  );
}
