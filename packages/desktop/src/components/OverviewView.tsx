import { useState } from 'react';
import { Site, FleetSummary, downloadCsv, siteStatus } from '@starfleet/shared';
import { StatusDot, StatusChip } from './StatusChip';

interface Props {
  sites: Site[];
  summary: FleetSummary | null;
  onSelectSite: (id: number) => void;
  onRunDiagnostics?: () => Promise<void>;
}

export function OverviewView({ sites, summary, onSelectSite, onRunDiagnostics }: Props) {
  const darkSites    = sites.filter(s => siteStatus(s) === 'dark');
  const degradedSites = sites.filter(s => siteStatus(s) === 'degraded');
  const onlineSites   = sites.filter(s => siteStatus(s) === 'online');

  const totalLaptops  = summary?.total_laptops ?? 0;
  const onlineLaptops = summary?.online_laptops ?? 0;
  const staleLaptops  = summary?.stale_devices ?? 0;
  const openIssues    = darkSites.length + degradedSites.length;
  const [busy, setBusy] = useState(false);

  async function runDiagnostics() {
    if (!onRunDiagnostics) return;
    setBusy(true);
    try {
      await onRunDiagnostics();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to queue diagnostics.');
    } finally {
      setBusy(false);
    }
  }

  function exportReport() {
    downloadCsv(buildFleetCsv(sites), `starfleet_fleet_report_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function openRunbook() {
    window.open('https://github.com/micopaci/isomo-starfleet/blob/main/docs/RUNBOOK.md', '_blank', 'noopener');
  }

  return (
    <div className="view">
      {/* Header */}
      <div className="view__header">
        <div>
          <div className="eyebrow">Fleet overview</div>
          <h1 className="view__title">
            {openIssues > 0
              ? `${openIssues} site${openIssues !== 1 ? 's' : ''} need attention.`
              : 'All sites healthy.'}
          </h1>
          <p className="view__lede">
            {onlineSites.length} online · {degradedSites.length} degraded ·{' '}
            {darkSites.length} dark · {totalLaptops} total laptops across {sites.length} sites
          </p>
        </div>
        <div className="view__actions">
          <button className="btn" onClick={runDiagnostics} disabled={!onRunDiagnostics || busy}>
            {busy ? 'Queuing…' : 'Run diagnostics'}
          </button>
          <button className="btn" onClick={openRunbook}>Open runbook</button>
          <button className="btn btn--primary" onClick={exportReport}>Export CSV</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="metric-cards metric-cards--4">
        <div className="metric-card">
          <div className="metric-label">Sites online</div>
          <div className={`metric-value ${darkSites.length ? 'metric-value--warn' : 'metric-value--ok'}`}>
            {onlineSites.length}<span style={{ fontSize: 16, color: 'var(--muted)' }}>/{sites.length}</span>
          </div>
          <div className="metric-sub">{degradedSites.length} degraded</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Dark sites</div>
          <div className={`metric-value ${darkSites.length ? 'metric-value--bad' : 'metric-value--ok'}`}>
            {darkSites.length}
          </div>
          <div className="metric-sub">{darkSites.length ? 'requires immediate action' : 'all reachable'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Laptops online</div>
          <div className="metric-value">
            {onlineLaptops}
            <span style={{ fontSize: 16, color: 'var(--muted)' }}>/{totalLaptops}</span>
          </div>
          <div className="metric-sub">{staleLaptops > 0 ? `${staleLaptops} stale` : 'all current'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Open issues</div>
          <div className={`metric-value ${openIssues ? 'metric-value--warn' : 'metric-value--ok'}`}>
            {openIssues}
          </div>
          <div className="metric-sub">{openIssues ? 'needs triage' : 'inbox zero'}</div>
        </div>
      </div>

      {/* Attention + mix split */}
      <div className="split">
        {/* Needs attention */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Needs attention</h2>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Status</th>
                  <th className="num">Online</th>
                  <th className="num">Laptops</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...darkSites, ...degradedSites].slice(0, 6).map(site => (
                  <tr
                    key={site.id}
                    className="row-click"
                    onClick={() => onSelectSite(site.id)}
                  >
                    <td>
                      <div className="cell-primary">{site.name}</div>
                    </td>
                    <td><StatusChip status={siteStatus(site)} /></td>
                    <td className="num mono">{site.online_laptops}</td>
                    <td className="num mono">{site.total_laptops}</td>
                    <td className="row-chevron">→</td>
                  </tr>
                ))}
                {darkSites.length === 0 && degradedSites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-state">All sites are healthy.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Fleet mix */}
        <section className="card">
          <div className="card-header"><h2 className="card-title">Fleet mix</h2></div>
          <div style={{ padding: '20px' }}>
            <div className="mix-bar">
              <span
                className="mix-seg ok"
                style={{ flex: onlineSites.length || 0 }}
                title={`${onlineSites.length} online`}
              />
              <span
                className="mix-seg warn"
                style={{ flex: degradedSites.length || 0 }}
                title={`${degradedSites.length} degraded`}
              />
              <span
                className="mix-seg bad"
                style={{ flex: darkSites.length || 0 }}
                title={`${darkSites.length} dark`}
              />
            </div>
            <ul className="mix-legend">
              <li><StatusDot status="online" /> <span>Online</span><span>{onlineSites.length}</span></li>
              <li><StatusDot status="degraded" /> <span>Degraded</span><span>{degradedSites.length}</span></li>
              <li><StatusDot status="dark" /> <span>Dark</span><span>{darkSites.length}</span></li>
              <li><StatusDot status="standby" /> <span>Total sites</span><span>{sites.length}</span></li>
            </ul>
          </div>

          <div className="card-header" style={{ borderTop: '1px solid var(--rule-2)' }}>
            <h3 className="card-subtitle">Laptops</h3>
          </div>
          <div className="minibars">
            <MiniBar label="Online"       n={onlineLaptops}                  total={totalLaptops} tone="ok" />
            <MiniBar label="Offline"      n={totalLaptops - onlineLaptops}   total={totalLaptops} tone="bad" />
            {staleLaptops > 0 && <MiniBar label="Stale (&gt;5min)" n={staleLaptops} total={totalLaptops} tone="warn" />}
          </div>
        </section>
      </div>

      {/* All sites grid */}
      <section className="card">
        <div className="card-header"><h2 className="card-title">All sites</h2></div>
        <div className="campus-grid">
          {sites.map(site => {
            const st = siteStatus(site);
            return (
              <div
                key={site.id}
                className="campus-card"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectSite(site.id)}
              >
                <div className="campus-card-head">
                  <div>
                    <div className="campus-card-name">{site.name}</div>
                    <StatusChip status={st} />
                  </div>
                  <div className="campus-card-count">
                    {site.online_laptops}
                    <span>online</span>
                  </div>
                </div>
                <div className="campus-stat-row">
                  <div><dt>Total</dt><dd>{site.total_laptops}</dd></div>
                  <div><dt>Offline</dt><dd className={site.total_laptops - site.online_laptops > 0 ? 'warn' : ''}>{site.total_laptops - site.online_laptops}</dd></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function buildFleetCsv(sites: Site[]): string {
  const headers = [
    'site_id',
    'name',
    'status',
    'location',
    'starlink_sn',
    'starlink_uuid',
    'online_laptops',
    'total_laptops',
    'score',
    'score_7day_avg',
    'latency_ms',
    'snr',
    'obstruction_pct',
    'ping_drop_pct',
    'updated_at',
  ];

  const rows = sites.map(site => [
    site.id,
    site.name,
    siteStatus(site),
    site.location ?? '',
    site.starlink_sn ?? '',
    site.starlink_uuid ?? '',
    site.online_laptops,
    site.total_laptops,
    site.score ?? '',
    site.score_7day_avg ?? '',
    site.signal?.pop_latency_ms ?? '',
    site.signal?.snr ?? '',
    site.signal?.obstruction_pct ?? '',
    site.signal?.ping_drop_pct ?? '',
    site.signal?.updatedAt ?? '',
  ]);

  return toCsv([headers, ...rows]);
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map(row => row.map(cell => {
    const value = String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\n');
}

function MiniBar({ label, n, total, tone }: { label: string; n: number; total: number; tone: string }) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  return (
    <div className="minibar">
      <div className="minibar__row">
        <span dangerouslySetInnerHTML={{ __html: label }} />
        <span className="mono">{n}<span className="muted"> / {total}</span></span>
      </div>
      <div className="minibar__track">
        <span className={`minibar__fill ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}
