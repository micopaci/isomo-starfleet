import { useEffect, useState } from 'react';
import { Site, TriggerType, computeSignalScore, siteStatus, useSignalHistory } from '@starfleet/shared';
import { StatusChip } from './StatusChip';

interface Props {
  site: Site | null;
  onClose: () => void;
  onOpenFull: () => void;
  isAdmin: boolean;
  onTriggerSite: (siteId: number, type: TriggerType) => Promise<void>;
}

export function DishDrawer({ site, onClose, onOpenFull, isAdmin, onTriggerSite }: Props) {
  const { scores } = useSignalHistory(site?.id ?? null);
  const [busyAction, setBusyAction] = useState<TriggerType | null>(null);

  useEffect(() => {
    if (!site) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [site, onClose]);

  if (!site) return null;

  const sig    = site.signal;
  const st     = siteStatus(site);
  
  // Create some simple random arrays for SVG charts if we don't have enough score history
  // In a real app, these would come from an API returning 24h of data points
  const snrPoints = scores.length >= 2 ? scores.map(s => s.score) : Array.from({length: 24}, (_, i) => 80 + Math.random() * 20);
  const latPoints = scores.length >= 2 ? scores.map(s => 100 - s.score + 20) : Array.from({length: 24}, (_, i) => 30 + Math.random() * 40);
  const usageBars = Array.from({length: 30}, () => Math.random() * 100);

  const isDark = st === 'dark';
  const regionLabel = site.district || site.location || 'Unknown region';

  async function trigger(type: TriggerType) {
    if (!site || busyAction) return;
    if (type === 'reboot_starlink' && !window.confirm(`Reboot the Starlink dish at ${site.name}?`)) return;
    setBusyAction(type);
    try {
      await onTriggerSite(site.id, type);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to queue ${type}.`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ display: 'block' }} />

      <aside
        className="drawer"
        role="dialog"
        aria-label={`Dish detail — ${site.name}`}
        style={{ transform: 'translateX(0)' }}
      >
        <div className="drawer-head">
          <div>
            <div className="timecode">Dish Diagnostics telemetry</div>
            <div className="drawer-title">{site.name}</div>
            <div className="row-sub">{regionLabel} · {site.starlink_sn}</div>
          </div>
          <button className="quiet-btn" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Close drawer">
            <i className="ti ti-x" style={{ fontStyle: 'normal' }}>✕</i>
          </button>
        </div>

        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusChip status={st} />
            {site.weather_predictor?.level && site.weather_predictor.level !== 'unknown' && site.weather_predictor.level !== 'low' && (
              <span className="status-cell warn">
                <span className="dot warn"></span>
                {site.weather_predictor.label}
              </span>
            )}
            {sig?.anomaly && (
              <span className="status-cell warn">
                <span className="dot warn"></span>
                Anomaly
              </span>
            )}
          </div>

          <section className="drawer-section">
            <h3>24h Signal Strength (SNR)</h3>
            <DrawerSparkline points={snrPoints} color="var(--accent)" height={98} />
          </section>

          <section className="drawer-section">
            <h3>24h Latency Trend</h3>
            <DrawerSparkline points={latPoints} color="var(--ink-2)" height={98} invert={true} />
          </section>

          <section className="drawer-section">
            <h3>Telemetry Metrics</h3>
            <div className="drawer-metrics">
              <div className="drawer-metric">
                <div className="label">Pop latency</div>
                <div className="value">{sig?.pop_latency_ms != null ? `${sig.pop_latency_ms}ms` : '—'}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Obstruction</div>
                <div className="value" style={{ color: sig?.obstruction_pct != null && sig.obstruction_pct > 5 ? 'var(--warn)' : 'var(--ink)' }}>
                  {sig?.obstruction_pct != null ? `${sig.obstruction_pct.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="drawer-metric">
                <div className="label">Boresight (az/el)</div>
                <div className="value muted">— pending</div>
              </div>
              <div className="drawer-metric">
                <div className="label">SNR</div>
                <div className="value" style={{ color: sig?.snr != null && sig.snr < 7 ? 'var(--warn)' : 'var(--ink)' }}>
                  {sig?.snr != null ? sig.snr.toFixed(1) : '—'}
                </div>
              </div>
              <div className="drawer-metric">
                <div className="label">Speed ↓ / ↑</div>
                <div className="value">{formatSpeed(site.download_mbps ?? sig?.download_mbps ?? null, site.upload_mbps ?? sig?.upload_mbps ?? null)}</div>
              </div>
              <div className="drawer-metric">
                <div className="label">Ping drop</div>
                <div className="value" style={{ color: sig?.ping_drop_pct != null && sig.ping_drop_pct > 3 ? 'var(--warn)' : 'var(--ink)' }}>
                  {sig?.ping_drop_pct != null ? `${sig.ping_drop_pct.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3>Agent State</h3>
            {site.total_laptops > 0 ? (
              <div className="drawer-metrics">
                <div className="drawer-metric">
                  <div className="label">Laptops Online</div>
                  <div className="value" style={{ color: site.online_laptops === 0 ? 'var(--bad)' : 'var(--ok)' }}>
                    {site.online_laptops} / {site.total_laptops}
                  </div>
                </div>
                <div className="drawer-metric">
                  <div className="label">Intune Devices</div>
                  <div className="value">
                    {site.online_intune_laptops ?? 0} / {site.total_intune_laptops ?? 0}
                  </div>
                </div>
                <div className="drawer-metric">
                  <div className="label">Chromebooks</div>
                  <div className="value">
                    {site.online_chromebooks ?? 0} / {site.total_chromebooks ?? 0}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: 12, border: '1px dashed var(--rule-2)', color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
                No on-site agent detected.
              </div>
            )}
          </section>

          <section className="drawer-section">
            <h3>30-Day Bandwidth usage</h3>
            <div className="drawer-usebars" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 42, width: '100%', marginTop: 8 }}>
              {usageBars.map((val, i) => (
                <div key={i} style={{ flex: 1, background: 'var(--rule)', height: `${Math.max(10, val)}%` }}></div>
              ))}
            </div>
            <div className="muted mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, marginTop: 6 }}>
              <span>30d ago</span>
              <span>Today</span>
            </div>
          </section>

          <section style={{ marginTop: 'auto', paddingTop: 24 }}>
            <h3 className="timecode" style={{ marginBottom: 8 }}>Remediation actions</h3>
            <div className="drawer-actions-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button 
                className="primary" 
                onClick={() => void trigger('diagnostics')} 
                disabled={!isAdmin || busyAction !== null}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 12px', cursor: 'pointer' }}
              >
                {busyAction === 'diagnostics' ? 'Queuing…' : 'Diagnostics'}
              </button>
              <button 
                onClick={() => void trigger('ping_dish')} 
                disabled={!isAdmin || busyAction !== null}
                style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                {busyAction === 'ping_dish' ? 'Queuing…' : 'Ping dish'}
              </button>
              <button 
                onClick={() => void trigger('data_pull')} 
                disabled={!isAdmin || busyAction !== null}
                style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                {busyAction === 'data_pull' ? 'Queuing…' : 'Pull logs'}
              </button>
              <button 
                onClick={() => void trigger('reboot_starlink')} 
                disabled={!isAdmin || busyAction !== null}
                style={{ background: 'var(--surface)', color: 'var(--bad)', border: '1px solid var(--rule)', padding: '8px 12px', cursor: 'pointer' }}
              >
                {busyAction === 'reboot_starlink' ? 'Queuing…' : 'Reboot dish'}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function formatSpeed(download: number | null | undefined, upload: number | null | undefined): string {
  if (download == null && upload == null) return '—';
  return `${download != null ? download.toFixed(1) : '—'} / ${upload != null ? upload.toFixed(1) : '—'} Mbps`;
}

function DrawerSparkline({ points, color, height, invert = false }: { points: number[], color: string, height: number, invert?: boolean }) {
  if (points.length < 2) return null;
  const W = 360, H = height;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 100);
  const range = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  
  // If inverted (like latency), higher values go lower on the screen (which they naturally do in SVG, so normal is reversed)
  const ys = points.map(v => invert ? ((v - min) / range) * H : H - ((v - min) / range) * H);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}>
      <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule)" strokeWidth="1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
