import { useState, useMemo } from 'react';
import { Site, computeSignalScore, siteStatus } from '@starfleet/shared';
import { StatusChip } from './StatusChip';
import { DishDrawer } from './DishDrawer';

interface Props {
  sites: Site[];
  onSelectSite: (id: number) => void;
}

type StatusFilter = 'all' | 'online' | 'degraded' | 'dark';

export function StarlinksView({ sites, onSelectSite }: Props) {
  const [q, setQ]                       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [drawerSiteId, setDrawerSiteId] = useState<number | null>(null);

  const counts = useMemo(() => ({
    all:      sites.length,
    online:   sites.filter(s => siteStatus(s) === 'online').length,
    degraded: sites.filter(s => siteStatus(s) === 'degraded').length,
    dark:     sites.filter(s => siteStatus(s) === 'dark').length,
  }), [sites]);

  const rows = useMemo(() => {
    return sites.filter(site => {
      if (statusFilter !== 'all' && siteStatus(site) !== statusFilter) return false;
      if (q) {
        const t = q.toLowerCase();
        if (
          !site.name.toLowerCase().includes(t) &&
          !site.starlink_sn.toLowerCase().includes(t) &&
          !(site.location ?? '').toLowerCase().includes(t)
        ) return false;
      }
      return true;
    });
  }, [sites, statusFilter, q]);

  const drawerSite = drawerSiteId !== null
    ? sites.find(s => s.id === drawerSiteId) ?? null
    : null;

  return (
    <>
      <div className="view">
        {/* Header */}
        <div className="view__header">
          <div>
            <div className="eyebrow">Connectivity</div>
            <h1 className="view__title">Starlink dishes</h1>
            <p className="view__lede">
              {counts.online} online · {counts.degraded} degraded · {counts.dark} dark
              {' · '}one dish per campus
            </p>
          </div>
          <div className="view__actions">
            <div className="search-box">
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>⌕</span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search dishes…"
                aria-label="Search dishes"
              />
            </div>
            <button className="btn">Export CSV</button>
          </div>
        </div>

        {/* Status filter + count */}
        <div className="tbl-toolbar">
          <div className="seg">
            {(['all', 'online', 'degraded', 'dark'] as StatusFilter[]).map(sf => (
              <button
                key={sf}
                className={`seg__btn${statusFilter === sf ? ' active' : ''}`}
                onClick={() => setStatusFilter(sf)}
              >
                {sf === 'all' ? 'All' : sf.charAt(0).toUpperCase() + sf.slice(1)}
                <span className="seg__count">{counts[sf]}</span>
              </button>
            ))}
          </div>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {rows.length} of {sites.length}
          </span>
        </div>

        {/* Table */}
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dish / Site</th>
                  <th>Status</th>
                  <th className="num">Score</th>
                  <th className="num">Latency</th>
                  <th className="num">SNR</th>
                  <th className="num">Obstruct.</th>
                  <th className="num">Ping drop</th>
                  <th className="num">Laptops</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(site => {
                  const st    = siteStatus(site);
                  const sig   = site.signal;
                  const score = sig
                    ? computeSignalScore({
                        ping_drop_pct:  sig.ping_drop_pct  ?? 0,
                        obstruction_pct: sig.obstruction_pct ?? 0,
                        snr:            sig.snr            ?? 9.5,
                        pop_latency_ms: sig.pop_latency_ms ?? 35,
                      })
                    : null;

                  return (
                    <tr
                      key={site.id}
                      className="row-click"
                      onClick={() => setDrawerSiteId(site.id)}
                    >
                      <td>
                        <div className="cell-primary">{site.name}</div>
                        <div className="cell-mono">{site.starlink_sn}</div>
                      </td>
                      <td><StatusChip status={st} /></td>
                      <td className="num">
                        {score !== null
                          ? <ScorePill score={score} />
                          : <span className="muted">—</span>}
                      </td>
                      <td className="num mono">
                        <LatCell ms={sig?.pop_latency_ms} />
                      </td>
                      <td className="num mono">
                        {sig?.snr != null
                          ? <span style={{ color: sig.snr < 7 ? 'var(--warn)' : 'inherit' }}>
                              {sig.snr.toFixed(1)}
                            </span>
                          : '—'}
                      </td>
                      <td className="num mono">
                        {sig?.obstruction_pct != null
                          ? <span style={{ color: sig.obstruction_pct > 5 ? 'var(--warn)' : 'inherit' }}>
                              {sig.obstruction_pct.toFixed(1)}%
                            </span>
                          : '—'}
                      </td>
                      <td className="num mono">
                        {sig?.ping_drop_pct != null
                          ? <span style={{ color: sig.ping_drop_pct > 3 ? 'var(--warn)' : 'inherit' }}>
                              {sig.ping_drop_pct.toFixed(1)}%
                            </span>
                          : '—'}
                      </td>
                      <td className="num mono">
                        <span style={{ color: site.online_laptops === 0 ? 'var(--bad)' : 'inherit' }}>
                          {site.online_laptops}
                        </span>
                        <span className="muted">/{site.total_laptops}</span>
                      </td>
                      <td className="row-chevron">→</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-state">No dishes match the current filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="tbl-footer">
            {rows.length} {statusFilter !== 'all' ? statusFilter : ''} dish{rows.length !== 1 ? 'es' : ''} ·
            click any row to open signal detail
          </div>
        </div>
      </div>

      {/* Slide-in drawer */}
      <DishDrawer
        site={drawerSite}
        onClose={() => setDrawerSiteId(null)}
        onOpenFull={() => {
          if (drawerSiteId !== null) {
            setDrawerSiteId(null);
            onSelectSite(drawerSiteId);
          }
        }}
      />
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--ok)'
              : score >= 50 ? 'var(--warn)'
              : 'var(--bad)';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color }}>
      {score}
    </span>
  );
}

function LatCell({ ms }: { ms: number | null | undefined }) {
  if (ms == null) return <span className="muted">—</span>;
  const color = ms < 40 ? 'var(--ok)' : ms < 80 ? 'var(--warn)' : 'var(--bad)';
  return <span style={{ color }}>{ms}ms</span>;
}
