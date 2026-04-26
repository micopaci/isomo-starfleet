import { useState, useMemo } from 'react';
import { useDevices, formatRelativeTime } from '@starfleet/shared';
import { StatusChip } from './StatusChip';

type StatusFilter = 'all' | 'online' | 'offline' | 'stale' | 'unknown';

export function ComputersView() {
  const { devices, loading, error, refresh } = useDevices();
  const [q, setQ]                       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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
          !(device.manufacturer ?? '').toLowerCase().includes(t)
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
                <th>Role</th>
                <th>Manufacturer</th>
                <th>Status</th>
                <th>Last seen</th>
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
                  </td>
                  <td>
                    {device.site_name
                      ? <span>{device.site_name}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    <span
                      className="status-chip"
                      style={{
                        background: device.role === 'agent' ? 'var(--accent-soft)' : 'var(--mute-soft)',
                        color: device.role === 'agent' ? 'var(--accent-ink)' : 'var(--mute-c)',
                        borderColor: 'transparent',
                        fontSize: 11,
                        padding: '2px 7px',
                      }}
                    >
                      {device.role}
                    </span>
                  </td>
                  <td className="muted">{device.manufacturer ?? '—'}</td>
                  <td>
                    <DeviceStatusChip status={device.status} staleMin={device.stale_min} />
                  </td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {formatRelativeTime(device.last_seen)}
                  </td>
                  <td />
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">No devices match the current filter.</td>
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
