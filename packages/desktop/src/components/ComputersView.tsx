import { useState, useMemo } from 'react';
import { StarfleetApi, useDevices, formatRelativeTime } from '@starfleet/shared';
import { StatusChip } from './StatusChip';
import { getBaseUrl, getStoredToken } from '../store/auth';

type StatusFilter = 'all' | 'online' | 'offline' | 'stale' | 'unknown';

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

  const counts = useMemo(() => ({
    all:     devices.length,
    online:  devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    stale:   devices.filter(d => d.status === 'stale').length,
    unknown: devices.filter(d => d.status === 'unknown').length,
  }), [devices]);

  const rows = useMemo(() => {
    return devices.filter(device => {
      if (statusFilter !== 'all' && device.status !== statusFilter) return false;
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
    return <div className="loading-state">Loading devices…</div>;
  }
  if (error) {
    return (
      <div className="error-state">
        Failed to load devices: {error}
        <button className="btn btn--sm" style={{ marginLeft: 10 }} onClick={refresh}>Retry</button>
      </div>
    );
  }

  async function syncIntune() {
    setSyncing(true);
    try {
      const result = await makeApi().syncIntuneDevices();
      alert(`Intune sync complete: ${result.upserted} of ${result.total} device${result.total === 1 ? '' : 's'} processed.`);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Intune sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="view">
      {/* Header */}
      <div className="view__header">
        <div>
          <div className="eyebrow">Endpoints</div>
          <h1 className="view__title">Computers</h1>
          <p className="view__lede">
            {counts.online} online · {counts.stale} stale · {counts.offline} offline · {counts.unknown} unknown
            {' · '}{devices.length} total devices managed by Intune
          </p>
        </div>
        <div className="view__actions">
          <div className="search-box">
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>⌕</span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Hostname, site, serial…"
              aria-label="Search devices"
            />
          </div>
          {isAdmin && (
            <button className="btn" onClick={() => void syncIntune()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Intune'}
            </button>
          )}
          <button className="btn" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="tbl-toolbar">
        <div className="seg">
          {(['all', 'online', 'stale', 'offline', 'unknown'] as StatusFilter[]).map(sf => (
            <button
              key={sf}
              className={`seg__btn${statusFilter === sf ? ' active' : ''}`}
              onClick={() => setStatusFilter(sf)}
            >
              {sf.charAt(0).toUpperCase() + sf.slice(1)}
              <span className="seg__count">{counts[sf]}</span>
            </button>
          ))}
        </div>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {sorted.length} of {devices.length}
        </span>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Site</th>
                <th>Manufacturer</th>
                <th>Storage</th>
                <th>Compliance</th>
                <th>Status</th>
                <th>Intune sync</th>
                <th>Agent seen</th>
                <th>Enrolled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map(device => (
                <tr
                  key={device.id}
                  className={
                    device.status === 'offline' ? 'row-offline'
                    : device.status === 'stale' ? 'row-stale'
                    : ''
                  }
                >
                  <td>
                    <div className="cell-primary">{device.hostname ?? <span className="muted">— no hostname —</span>}</div>
                    <div className="cell-mono">{device.windows_sn}</div>
                    {device.user_principal_name && (
                      <div className="cell-mono">{device.user_principal_name}</div>
                    )}
                  </td>
                  <td>
                    {device.site_name
                      ? <span>{device.site_name}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="muted">
                    <div>{device.manufacturer ?? '—'}</div>
                    {device.model && <div className="cell-mono">{device.model}</div>}
                  </td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {formatStorage(device.free_storage_bytes, device.total_storage_bytes)}
                  </td>
                  <td className="muted">{formatCompliance(device.compliance_state)}</td>
                  <td>
                    <DeviceStatusChip status={device.status} staleMin={device.stale_min} />
                  </td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {formatRelativeTime(device.intune_last_sync_at)}
                  </td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {formatRelativeTime(device.agent_last_seen_at)}
                  </td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {formatRelativeTime(device.intune_enrolled_at)}
                  </td>
                  <td />
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-state">No devices match the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 200 && (
          <div className="tbl-footer">Showing 200 of {sorted.length} · filter to narrow results</div>
        )}
        {devices.length === 0 && !loading && (
          <div className="empty-state">
            No devices found. Ensure the Starfleet server is reachable and devices are enrolled in Intune.
          </div>
        )}
      </div>
    </div>
  );
}

function formatStorage(free: number | null | undefined, total: number | null | undefined): string {
  if (free == null || total == null || total <= 0) return '—';
  return `${formatBytes(free)} / ${formatBytes(total)}`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

function formatCompliance(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// ── helpers ────────────────────────────────────────────────────────────────────

function DeviceStatusChip({
  status, staleMin,
}: {
  status: 'online' | 'offline' | 'stale' | 'unknown';
  staleMin?: number | null;
}) {
  if (status === 'online')  return <StatusChip status="online" />;
  if (status === 'offline') return <StatusChip status="dark" />;
  if (status === 'unknown') return <StatusChip status="standby" />;
  // stale
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusChip status="degraded" />
      {staleMin != null && (
        <span className="stale-mins">{staleMin}m ago</span>
      )}
    </span>
  );
}
