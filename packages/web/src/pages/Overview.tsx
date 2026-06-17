import { useState } from 'react';
import StatCard from '../components/StatCard';
import StatusChip from '../components/StatusChip';
import { useData } from '../context/DataContext';

function scoreColor(score: number): 'ok' | 'warn' | 'bad' {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

function Sparkline({ points }: { points: number[] }) {
  const w = 80; const h = 20;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = Math.max(1, max - min);
  const step = w / Math.max(1, points.length - 1);
  const pts = points.map((v, i) =>
    `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`
  ).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export default function Overview() {
  const { dishes, alerts, inventory, loading, refreshData } = useData();
  const [_sweep, setSweeping] = useState(false);

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Fleet Telemetry...
      </div>
    );
  }

  const online = dishes.filter(d => d.status === 'online').length;
  const degraded = dishes.filter(d => d.status === 'degraded').length;
  const offline = dishes.filter(d => d.status === 'offline').length;
  
  const compWorking = inventory.filter(d => d.status === 'working').length;
  const compRepair = inventory.filter(d => d.status === 'broken').length;
  const compReady = inventory.filter(d => d.status === 'ready').length;
  const totalComp = compWorking + compRepair + compReady;

  // "Online" = checked in recently (real last_seen), not merely "working" hardware.
  const devicesOnline = inventory.filter(d => d.online).length;
  const openAlerts = alerts.filter(a => a.open).length;

  const needsAttention = dishes.filter(d => d.status !== 'online').slice(0, 5);

  // Healthiest = highest real uptime; sites with no uptime data are excluded.
  const healthiest = [...dishes]
    .filter(d => d.uptime > 0)
    .sort((a, b) => b.uptime - a.uptime)
    .slice(0, 6);

  async function runSweep() {
    setSweeping(true);
    try { await refreshData(); } finally { setSweeping(false); }
  }

  return (
    <div className="sf-view">
      {/* Header */}
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Fleet Overview</p>
          <h1 className="sf-view-title">Tech <em>Operations</em></h1>
          <p className="sf-view-lede">Live telemetry snapshot across all {dishes.length} Starlink deployments.</p>
        </div>
        <div className="sf-view-actions">
          <button
            className="btn btn--primary"
            id="btn-run-sweep"
            onClick={runSweep}
            disabled={_sweep}
          >
            <i className={`ti ti-refresh${_sweep ? ' ti-spin' : ''}`} aria-hidden="true" />
            {_sweep ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="kpi-strip" style={{ '--kpi-cols': '4' } as React.CSSProperties} aria-label="Fleet key metrics">
        <StatCard label="Sites Online" value={`${online}/${dishes.length}`} sub="active Starlinks" tone={online >= 38 ? 'ok' : 'warn'} />
        <StatCard label="Devices Online" value={`${devicesOnline}/${inventory.length}`} sub="checked in ≤72h" tone={inventory.length && devicesOnline >= inventory.length * 0.85 ? 'ok' : 'warn'} />
        <StatCard label="Open Alerts" value={openAlerts} sub="require attention" tone={openAlerts <= 3 ? 'ok' : openAlerts <= 7 ? 'warn' : 'bad'} />
        <StatCard label="Sites Degraded" value={degraded + offline} sub={`${offline} offline · ${degraded} degraded`} tone={degraded + offline === 0 ? 'ok' : degraded + offline <= 2 ? 'warn' : 'bad'} />
      </div>

      {/* Fleet health bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="panel">
          <div className="panel-head"><h2>Starlink Mix</h2><span className="meta">last sweep</span></div>
          <div style={{ padding: '16px 16px 12px' }}>
            <div
              className="mix-bar"
              role="img"
              aria-label={`Fleet health: ${online} online, ${degraded} degraded, ${offline} offline`}
            >
              <span className="ok" style={{ flex: online }} />
              <span className="warn" style={{ flex: degraded }} />
              <span className="bad" style={{ flex: offline }} />
            </div>
            <div className="mix-lines">
              <div className="mix-line">
                <StatusChip label={`${online} Online`} tone="ok" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{dishes.length ? ((online / dishes.length) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="mix-line">
                <StatusChip label={`${degraded} Degraded`} tone="warn" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{dishes.length ? ((degraded / dishes.length) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="mix-line">
                <StatusChip label={`${offline} Offline`} tone="bad" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{dishes.length ? ((offline / dishes.length) * 100).toFixed(0) : 0}%</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="panel">
          <div className="panel-head"><h2>Computer Fleet</h2><span className="meta">{totalComp} tracking</span></div>
          <div style={{ padding: '16px 16px 12px' }}>
            <div
              className="mix-bar"
              role="img"
              aria-label={`Computers: ${compWorking} working, ${compReady} ready, ${compRepair} in repair`}
            >
              <span className="ok" style={{ flex: compWorking }} />
              <span className="warn" style={{ flex: compReady }} />
              <span className="bad" style={{ flex: compRepair }} />
            </div>
            <div className="mix-lines">
              <div className="mix-line">
                <StatusChip label={`${compWorking} Working`} tone="ok" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{totalComp ? ((compWorking / totalComp) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="mix-line">
                <StatusChip label={`${compReady} Ready`} tone="warn" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{totalComp ? ((compReady / totalComp) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="mix-line">
                <StatusChip label={`${compRepair} In Repair`} tone="bad" size="sm" />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{totalComp ? ((compRepair / totalComp) * 100).toFixed(0) : 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Needs Attention */}
      {needsAttention.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Needs Attention</h2>
            <span className="meta">{needsAttention.length} sites</span>
          </div>
          <div className="flow-list">
            {needsAttention.map(d => (
              <div key={d.serial} className="flow-row">
                <div className="content">
                  <div className="flow-title-row">
                    <StatusChip label={d.status.toUpperCase()} tone={d.status === 'offline' ? 'bad' : 'warn'} size="sm" />
                    <span className="row-title">{d.name}</span>
                    <span className="row-sub">{d.campus} · {d.region}</span>
                  </div>
                  <div className="flow-copy">
                    {d.status === 'offline'
                      ? `No telemetry · rain ${d.rain}mm · ${d.laptops} devices at site`
                      : `Latency ${d.latency > 0 ? `${d.latency}ms` : '—'} · SNR ${d.snr > 0 ? `${d.snr.toFixed(1)}dB` : '—'} · ping drop ${d.pingDrop}%`}
                  </div>
                </div>
                <div className="actions">
                  <Sparkline points={d.spark} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Sites grid */}
      <div className="panel">
        <div className="panel-head"><h2>Healthiest Sites</h2><span className="meta">by uptime</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" aria-label="Top performing sites">
            <thead>
              <tr>
                <th>Site</th>
                <th>Region</th>
                <th className="num">Uptime</th>
                <th className="num">Latency</th>
                <th className="num">Laptops</th>
              </tr>
            </thead>
            <tbody>
              {healthiest.length === 0 ? (
                <tr><td colSpan={5} className="cell-mono" style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px 0' }}>No uptime data yet</td></tr>
              ) : healthiest.map(d => (
                <tr key={d.serial}>
                  <td className="cell-primary">{d.name}</td>
                  <td className="cell-mono">{d.region}</td>
                  <td className="num cell-mono" style={{ color: `var(--${scoreColor(d.uptime)})` }}>{d.uptime.toFixed(1)}%</td>
                  <td className="num cell-mono">{d.latency > 0 ? `${d.latency}ms` : '—'}</td>
                  <td className="num cell-mono">{d.laptops}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
