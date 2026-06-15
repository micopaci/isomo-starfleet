import { useEffect } from 'react';
import { Device, formatRelativeTime } from '@starfleet/shared';

interface Props {
  device: Device | null;
  onClose: () => void;
  isAdmin: boolean;
}

export function ComputerDrawer({ device, onClose, isAdmin }: Props) {
  useEffect(() => {
    if (!device) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [device, onClose]);

  if (!device) return null;

  const isStale = device.status === 'stale';
  const isOffline = device.status === 'offline';
  const isUnknown = device.status === 'unknown';
  
  let statusTone = 'ok';
  let statusText = 'Healthy';
  if (isOffline) { statusTone = 'bad'; statusText = 'Offline'; }
  else if (isStale) { statusTone = 'warn'; statusText = 'Update due'; }
  else if (isUnknown) { statusTone = 'muted'; statusText = 'Unknown'; }

  const isLowStorage = device.free_storage_bytes && device.total_storage_bytes 
    ? device.free_storage_bytes / device.total_storage_bytes < 0.15 
    : false;

  const freeStorageGB = device.free_storage_bytes ? (device.free_storage_bytes / 1e9).toFixed(1) : '—';
  const totalStorageGB = device.total_storage_bytes ? (device.total_storage_bytes / 1e9).toFixed(1) : '—';

  // Mock battery
  const batteryPct = device.battery_health_pct ?? device.battery_pct ?? Math.max(10, 100 - (device.id % 30));
  const lastSeen = device.agent_last_seen_at ?? device.intune_last_sync_at ?? device.last_seen;

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ display: 'block' }} />

      <aside
        className="drawer"
        role="dialog"
        aria-label={`Computer detail — ${device.hostname}`}
        style={{ transform: 'translateX(0)' }}
      >
        <div className="drawer-head">
          <div>
            <div className="timecode">Endpoint Telemetry</div>
            <div className="drawer-title">{device.hostname || device.windows_sn || 'Unknown Device'}</div>
            <div className="row-sub">{device.user_principal_name || 'Unassigned'}</div>
          </div>
          <button className="quiet-btn" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Close drawer">
            <i className="ti ti-x" style={{ fontStyle: 'normal' }}>✕</i>
          </button>
        </div>

        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={`status-cell ${statusTone}`}>
              <span className={`dot ${statusTone}`}></span>
              {statusText}
            </span>
            {isLowStorage && (
              <span className="status-cell bad">
                <span className="dot bad"></span>
                Low storage
              </span>
            )}
            <span className="status-cell muted" style={{ fontFamily: 'var(--font-mono)' }}>
              Last seen: {lastSeen ? formatRelativeTime(lastSeen) : 'Never'}
            </span>
          </div>

          <section className="drawer-section">
            <h3>Device Specifications</h3>
            <div className="drawer-metrics">
              <div className="drawer-metric">
                <div className="label">Manufacturer</div>
                <div className="value">{device.manufacturer || '—'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Model</div>
                <div className="value">{device.model || '—'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Serial number</div>
                <div className="value mono">{device.windows_sn || '—'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">OS</div>
                <div className="value">{device.os || 'Windows'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Version</div>
                <div className="value mono">{device.os_version || '—'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Location</div>
                <div className="value">{device.site_name || '—'}</div>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3>Health &amp; Usage</h3>
            <div className="drawer-metrics">
              <div className="drawer-metric">
                <div className="label">Storage</div>
                <div className="value" style={{ color: isLowStorage ? 'var(--bad)' : 'var(--ink)' }}>
                  {freeStorageGB} GB free
                  <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>of {totalStorageGB} GB</span>
                </div>
              </div>
              <div className="drawer-metric">
                <div className="label">Battery Health</div>
                <div className="value" style={{ color: batteryPct < 20 ? 'var(--bad)' : 'var(--ok)' }}>
                  {batteryPct}%
                </div>
              </div>
              <div className="drawer-metric">
                <div className="label">Intune sync</div>
                <div className="value">{device.intune_last_sync_at ? new Date(device.intune_last_sync_at).toLocaleDateString() : '—'}</div>
              </div>
            </div>
          </section>

          <section style={{ marginTop: 'auto', paddingTop: 24 }}>
            <h3 className="timecode" style={{ marginBottom: 8 }}>Endpoint actions</h3>
            <div className="drawer-actions-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button 
                className="primary" 
                onClick={() => alert('Pushing update to endpoint')}
                disabled={!isAdmin}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 12px', cursor: 'pointer' }}
              >
                Push OS Update
              </button>
              <button 
                onClick={() => alert('Sending ping to endpoint')}
                disabled={!isAdmin}
                style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                Ping Device
              </button>
              <button 
                onClick={() => alert('Requesting remote access session')}
                disabled={!isAdmin}
                style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                Remote Access
              </button>
              <button 
                onClick={() => alert('Locking device...')}
                disabled={!isAdmin}
                style={{ background: 'var(--surface)', color: 'var(--bad)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                Lock Device
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
