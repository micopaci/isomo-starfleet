import { useState } from 'react';
import { Device, TriggerType, downloadCsv } from '@starfleet/shared';
import { getBaseUrl, getStoredToken } from '../store/auth';
import { StarfleetApi } from '@starfleet/shared';

type DeviceFilter = 'all' | 'online' | 'offline' | 'stale' | 'unknown';

interface Props {
  devices: Device[];
  siteId: number;
  isAdmin: boolean;
  onTrigger: (deviceId: number, type: TriggerType) => Promise<void>;
  onTriggerAll: () => Promise<void>;
}

function makeApi() {
  const token = getStoredToken() ?? '';
  return new StarfleetApi(getBaseUrl(), () => token);
}

export function LaptopTable({ devices, siteId, isAdmin, onTrigger, onTriggerAll }: Props) {
  const [filter,       setFilter]      = useState<DeviceFilter>('all');
  const [exporting,    setExporting]   = useState(false);
  const [exportType,   setExportType]  = useState<'signal' | 'latency'>('signal');

  const visible = devices.filter(d => {
    if (filter === 'online')  return d.status === 'online';
    if (filter === 'offline') return d.status === 'offline';
    if (filter === 'stale')   return d.status === 'stale';
    if (filter === 'unknown') return d.status === 'unknown';
    return true;
  });

  const staleCount = devices.filter(d => d.status === 'stale').length;

  const filters: DeviceFilter[] = ['all', 'online', 'stale', 'offline', 'unknown'];

  async function handleExport(type: 'signal' | 'latency') {
    setExporting(true);
    setExportType(type);
    try {
      const api  = makeApi();
      const to   = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
      const csv  = type === 'signal'
        ? await api.exportSignalCsv(siteId, from, to)
        : await api.exportLatencyCsv(siteId, from, to);
      downloadCsv(csv, `site-${siteId}-${type}-${from}-${to}.csv`);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card laptop-table-card">
      <div className="card-header">
        <h3>
          💻 Laptops
          {staleCount > 0 && (
            <span className="badge badge-warn" style={{ marginLeft: 8 }}>
              ⚠ {staleCount} stale
            </span>
          )}
        </h3>
        <div className="filter-row">
          {filters.map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''} ${f === 'stale' && staleCount > 0 ? 'filter-btn-warn' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'stale'
                ? `Stale${staleCount > 0 ? ` (${staleCount})` : ''}`
                : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="header-actions">
          {isAdmin && (
            <>
              <button className="btn-secondary" onClick={() => void onTriggerAll()}>
                ⬇ Pull all
              </button>
              <div className="export-group">
                <button
                  className="btn-ghost"
                  disabled={exporting}
                  onClick={() => handleExport('signal')}
                  title="Export 30-day signal CSV"
                >
                  {exporting && exportType === 'signal' ? '…' : '↓'} Signal CSV
                </button>
                <button
                  className="btn-ghost"
                  disabled={exporting}
                  onClick={() => handleExport('latency')}
                  title="Export 30-day latency CSV"
                >
                  {exporting && exportType === 'latency' ? '…' : '↓'} Latency CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        <table className="laptop-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Last seen</th>
              <th>P50</th>
              <th>P95</th>
              <th>Battery</th>
              <th>Disk free</th>
              <th>SMART</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(d => (
              <tr
                key={d.id}
                className={
                  d.status === 'offline' ? 'row-offline' :
                  d.status === 'stale'   ? 'row-stale'   : ''
                }
              >
                <td className="device-name">{d.hostname ?? d.windows_sn}</td>
                <td>
                  <span className={`status-dot status-${d.status}`} />
                  {d.status}
                  {d.status === 'stale' && d.stale_min != null && (
                    <span className="stale-mins"> ({d.stale_min}m ago)</span>
                  )}
                </td>
                <td className="muted">
                  {d.last_seen ? relativeTime(d.last_seen) : '—'}
                </td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>{formatStorage(d.free_storage_bytes, d.total_storage_bytes)}</td>
                <td>{formatSmart(d.disk_smart_status, d.disk_smart_predict_failure, d.disk_media_type)}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-ghost"
                      onClick={() => void onTrigger(d.id, 'data_pull')}
                      title="Pull data from this device"
                    >
                      ⬇
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="muted text-center">
                  No devices match this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatStorage(free: number | null | undefined, total: number | null | undefined): string {
  if (free == null || total == null || total <= 0) return '—';
  return `${(free / 1024 / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatSmart(
  status: string | null | undefined,
  predictFailure: boolean | null | undefined,
  mediaType: string | null | undefined,
): string {
  if (predictFailure) return 'Predict fail';
  if (status || mediaType) return [status, mediaType].filter(Boolean).join(' · ');
  return '—';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
