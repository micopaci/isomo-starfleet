import { useState, useMemo } from 'react';
import { Site, siteStatus } from '@starfleet/shared';
import { StatusChip } from './StatusChip';

// ─── Alert shape — synthesized from live site data ────────────────────────────
interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  meta: string;
  siteId: number;
  siteName: string;
  acked: boolean;
  ts: string;
}

function synthesizeAlerts(sites: Site[]): Alert[] {
  const alerts: Alert[] = [];

  for (const site of sites) {
    const st = siteStatus(site);
    const sig = site.signal;

    if (st === 'dark') {
      alerts.push({
        id: `dark-${site.id}`,
        severity: 'critical',
        message: `${site.name} is unreachable — site has gone dark`,
        meta: `All ${site.total_laptops} devices offline · Starlink SN ${site.starlink_sn}`,
        siteId: site.id,
        siteName: site.name,
        acked: false,
        ts: sig?.updatedAt ? formatTs(sig.updatedAt) : 'Unknown',
      });
    }

    if (st === 'degraded' && site.online_laptops > 0) {
      const cause = sig?.confidence === 'low'
        ? 'Low confidence signal data'
        : sig
          ? buildCause(sig.ping_drop_pct, sig.obstruction_pct, sig.snr, sig.pop_latency_ms)
          : 'Signal quality below threshold';

      alerts.push({
        id: `degraded-${site.id}`,
        severity: 'warning',
        message: `${site.name} has a degraded Starlink connection`,
        meta: `${cause} · ${site.online_laptops}/${site.total_laptops} laptops online`,
        siteId: site.id,
        siteName: site.name,
        acked: false,
        ts: sig?.updatedAt ? formatTs(sig.updatedAt) : 'Unknown',
      });
    }

    if (sig?.anomaly === true) {
      const delta = sig.anomaly_delta;
      alerts.push({
        id: `anomaly-${site.id}`,
        severity: 'warning',
        message: `Signal anomaly detected at ${site.name}`,
        meta: `Score dropped ${delta != null ? Math.abs(delta) + 'pt' : 'significantly'} vs 7-day average`,
        siteId: site.id,
        siteName: site.name,
        acked: false,
        ts: sig.updatedAt ? formatTs(sig.updatedAt) : 'Unknown',
      });
    }

    if (sig?.data_quality === 'low_data') {
      alerts.push({
        id: `lowdata-${site.id}`,
        severity: 'info',
        message: `Insufficient signal data at ${site.name}`,
        meta: `Score confidence is low — fewer than expected readings in the window`,
        siteId: site.id,
        siteName: site.name,
        acked: false,
        ts: sig.updatedAt ? formatTs(sig.updatedAt) : 'Unknown',
      });
    }
  }

  // Sort: critical first, then warning, then info
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

function buildCause(
  pingDrop: number | null,
  obstruction: number | null,
  snr: number | null,
  latency: number | null,
): string {
  if ((obstruction ?? 0) > 5) return 'Physical obstruction likely';
  if ((pingDrop ?? 0) > 5)    return 'High packet loss';
  if ((snr ?? 9.5) < 7)       return 'RF interference';
  if ((latency ?? 35) > 100)  return 'High latency';
  return 'Degraded signal quality';
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMin = Math.floor((now - d.getTime()) / 60_000);
    if (diffMin < 1)  return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString('en-RW', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type AlertFilter = 'open' | 'critical' | 'warning' | 'info' | 'all';

interface Props {
  sites: Site[];
  onSelectSite: (id: number) => void;
}

export function AlertsView({ sites, onSelectSite }: Props) {
  const [filter, setFilter] = useState<AlertFilter>('open');
  // Track local acks (id → acked)
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  const base = useMemo(() => synthesizeAlerts(sites), [sites]);
  const alerts = useMemo(() =>
    base.map(a => ({ ...a, acked: acked[a.id] ?? false })),
    [base, acked],
  );

  const counts = {
    open:     alerts.filter(a => !a.acked).length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning:  alerts.filter(a => a.severity === 'warning').length,
    info:     alerts.filter(a => a.severity === 'info').length,
    all:      alerts.length,
  };

  const rows = useMemo(() => {
    if (filter === 'open')     return alerts.filter(a => !a.acked);
    if (filter === 'critical') return alerts.filter(a => a.severity === 'critical');
    if (filter === 'warning')  return alerts.filter(a => a.severity === 'warning');
    if (filter === 'info')     return alerts.filter(a => a.severity === 'info');
    return alerts;
  }, [alerts, filter]);

  function ack(id: string) {
    setAcked(prev => ({ ...prev, [id]: true }));
  }

  return (
    <div className="view">
      {/* Header */}
      <div className="view__header">
        <div>
          <div className="eyebrow">Triage</div>
          <h1 className="view__title">
            {counts.open > 0 ? `${counts.open} alert${counts.open !== 1 ? 's' : ''} open.` : 'All clear.'}
          </h1>
          <p className="view__lede">
            Alerts are derived from live fleet data — dark and degraded sites, signal anomalies, and data quality issues.
          </p>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="tbl-toolbar">
        <div className="seg">
          {(['open', 'critical', 'warning', 'info', 'all'] as AlertFilter[]).map(f => (
            <button
              key={f}
              className={`seg__btn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="seg__count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      <div className="card">
        <ul className="alerts-list">
          {rows.map(alert => (
            <li
              key={alert.id}
              className={`alert-row${alert.acked ? ' acked' : ''}`}
            >
              {/* Severity badge + time */}
              <div className="alert-sev">
                <span className={`sev-badge ${alert.severity}`}>
                  {alert.severity}
                </span>
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {alert.ts}
                </span>
              </div>

              {/* Message + meta */}
              <div>
                <div className="alert-msg">{alert.message}</div>
                <div className="alert-meta">{alert.meta}</div>
              </div>

              {/* Actions */}
              <div className="alert-actions">
                {alert.acked ? (
                  <span
                    className="status-chip mute"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    Acknowledged
                  </span>
                ) : (
                  <>
                    <button
                      className="btn btn--sm"
                      onClick={() => onSelectSite(alert.siteId)}
                    >
                      View site
                    </button>
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => ack(alert.id)}
                    >
                      Acknowledge
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}

          {rows.length === 0 && (
            <li style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {filter === 'open'
                ? 'Nothing here. Inbox zero — all sites nominal.'
                : `No ${filter} alerts.`}
            </li>
          )}
        </ul>
      </div>

      {/* Summary footer */}
      {alerts.length > 0 && (
        <div style={{
          fontSize: 12,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          padding: '0 4px',
        }}>
          {counts.critical > 0 && <span style={{ color: 'var(--bad)', marginRight: 12 }}>● {counts.critical} critical</span>}
          {counts.warning > 0  && <span style={{ color: 'var(--warn)', marginRight: 12 }}>● {counts.warning} warning</span>}
          {counts.info > 0     && <span style={{ marginRight: 12 }}>● {counts.info} info</span>}
          {Object.keys(acked).filter(k => acked[k]).length > 0 && (
            <span>· {Object.keys(acked).filter(k => acked[k]).length} acknowledged this session</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── StatusChip for mute ────────────────────────────────────────────────────────
// (re-export with corrected class usage for the acked chip above)
export { StatusChip };
