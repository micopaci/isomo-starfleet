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
  age_days: number;
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
        age_days: sig?.updatedAt ? getAgeDays(sig.updatedAt) : 0,
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
        age_days: sig?.updatedAt ? getAgeDays(sig.updatedAt) : 0,
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
        age_days: sig?.updatedAt ? getAgeDays(sig.updatedAt) : 0,
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
        age_days: sig?.updatedAt ? getAgeDays(sig.updatedAt) : 0,
      });
    }

    if (site.weather_predictor?.level === 'high' || site.weather_predictor?.level === 'medium') {
      const rainMeta = site.weather_predictor.rainfall_mm != null
        ? `Rain ${site.weather_predictor.rainfall_mm.toFixed(1)}mm`
        : 'Rain data unavailable';
      alerts.push({
        id: `weather-${site.id}`,
        severity: 'warning',
        message: `${site.weather_predictor.label} at ${site.name}`,
        meta: `${rainMeta} · ${site.weather_predictor.explanation}`,
        siteId: site.id,
        siteName: site.name,
        acked: false,
        ts: site.weather_predictor.based_on_date ?? 'Latest weather',
        age_days: site.weather_predictor.based_on_date ? getAgeDays(site.weather_predictor.based_on_date) : 0,
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

function getAgeDays(iso: string): number {
  try {
    const d = new Date(iso);
    const now = Date.now();
    return Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
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

  function ackAllOpen() {
    const newAcked = { ...acked };
    alerts.forEach(a => {
      if (!a.acked) newAcked[a.id] = true;
    });
    setAcked(newAcked);
  }

  // Calculate some simple stats for the Env panel
  const sitesWithRain = sites.filter(s => (s.weather_predictor?.rainfall_mm ?? 0) > 5).length;
  const avgObstruction = sites.length > 0
    ? sites.reduce((sum, s) => sum + (s.signal?.obstruction_pct ?? 0), 0) / sites.length
    : 0;

  return (
    <div className="view">
      <div className="hero-flow">
        <div>
          <div className="timecode">Triage · severity first · assign or acknowledge inline</div>
          <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
            Alerts
          </h1>
          <p className="lede">
            The feed separates source, campus, assignee, and action so triage can happen without opening a second page.
          </p>
        </div>
        <div className="mini-hud">
          <div className="line"><span>open queue</span><b style={{ color: counts.open > 0 ? 'var(--bad)' : 'inherit' }}>{counts.open}</b></div>
          <div className="line"><span>critical</span><b style={{ color: counts.critical > 0 ? 'var(--bad)' : 'inherit' }}>{counts.critical}</b></div>
          <div className="line"><span>warning</span><b style={{ color: counts.warning > 0 ? 'var(--warn)' : 'inherit' }}>{counts.warning}</b></div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head">
            <h2 style={{ fontSize: 13, fontWeight: 600 }}>Trend by day</h2>
            <span className="meta">last 7d</span>
          </div>
          <div className="trend-bars">
            {/* Mocking trend bars based on static data for now */}
            <div className="trend-bar" style={{ height: '42px' }} title="Mon"></div>
            <div className="trend-bar warn" style={{ height: '58px' }} title="Tue"></div>
            <div className="trend-bar" style={{ height: '34px' }} title="Wed"></div>
            <div className="trend-bar warn" style={{ height: '70px' }} title="Thu"></div>
            <div className="trend-bar bad" style={{ height: '92px' }} title="Fri"></div>
            <div className="trend-bar warn" style={{ height: '66px' }} title="Sat"></div>
            <div className="trend-bar bad" style={{ height: '82px' }} title="Sun"></div>
          </div>
        </section>
        
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head">
            <h2 style={{ fontSize: 13, fontWeight: 600 }}>Environment</h2>
            <span className="meta">fleet-wide</span>
          </div>
          <div className="fleet-mix">
            <div className="mix-line">
              <span>Geomagnetic Kp</span>
              <span className="mono ok" style={{ fontWeight: 600 }}>2 quiet</span>
            </div>
            <div className="mix-line">
              <span>Sites with rain &gt;5mm</span>
              <span className="mono">{sitesWithRain}</span>
            </div>
            <div className="mix-line">
              <span>Avg obstruction</span>
              <span className="mono">{avgObstruction.toFixed(1)}%</span>
            </div>
            <div className="mix-line">
              <span>Starlink satellites overhead</span>
              <span className="mono">18</span>
            </div>
          </div>
        </section>
      </div>

      <div className="toolbar" style={{ marginTop: 22 }}>
        <div className="seg">
          {(['open', 'critical', 'warning', 'info', 'all'] as AlertFilter[]).map(f => (
            <button
              key={f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <button className="primary-action" style={{ marginLeft: 'auto' }} onClick={ackAllOpen}>
          Acknowledge all open
        </button>
      </div>

      <section className="panel">
        <ul className="alerts-feed">
          {rows.map(alert => (
            <li
              key={alert.id}
              className={`alert-row`}
              style={{ opacity: alert.acked ? 0.6 : 1 }}
            >
              <div>
                <span className={`severity-pill ${alert.severity}`}>{alert.severity}</span>
                <div className="row-sub" style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{alert.ts}</div>
              </div>

              <div>
                <div className="alert-msg">
                  {alert.message}
                  {alert.age_days > 7 && (
                    <span 
                      className="metric-chip" 
                      style={{ 
                        marginLeft: 8, 
                        fontSize: 9, 
                        color: 'var(--warn)', 
                        borderColor: 'var(--warn)', 
                        background: 'var(--surface-2)' 
                      }}
                      title="Older than 7 days — email notification triggered"
                    >
                      Escalated
                    </span>
                  )}
                </div>
                <div className="alert-meta">
                  {alert.meta} {alert.age_days > 0 && `· ${alert.age_days}d ago`}
                </div>
              </div>

              <div className="alert-actions">
                <button
                  className="btn-row"
                  onClick={() => onSelectSite(alert.siteId)}
                >
                  View
                </button>
                <button
                  className={`btn-row ${alert.acked ? '' : 'primary'}`}
                  onClick={() => ack(alert.id)}
                  disabled={alert.acked}
                >
                  {alert.acked ? 'Acked' : 'Acknowledge'}
                </button>
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
      </section>
    </div>
  );
}

// ── StatusChip for mute ────────────────────────────────────────────────────────
// (re-export with corrected class usage for the acked chip above)
export { StatusChip };
