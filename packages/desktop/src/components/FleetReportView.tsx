import { useState, useMemo } from 'react';
import { Site, siteStatus } from '@starfleet/shared';

interface Props {
  sites: Site[];
}

export function FleetReportView({ sites }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<'name' | 'usage' | 'share'>('usage');
  const [sortDesc, setSortDesc] = useState(true);

  // Generate some deterministic mock usage data for the view
  const usageData = useMemo(() => {
    let totalUsage = 0;
    const data = sites.map(site => {
      // Mock usage based on site ID, scaled down to look like TB
      const tb = ((site.id * 17) % 500) / 100 + 0.1; 
      totalUsage += tb;
      return { site, tb };
    });

    return data.map(d => ({
      ...d,
      pct: totalUsage > 0 ? (d.tb / totalUsage) * 100 : 0
    }));
  }, [sites]);

  const sortedUsage = useMemo(() => {
    return [...usageData].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'name') cmp = a.site.name.localeCompare(b.site.name);
      else if (sortCol === 'usage') cmp = a.tb - b.tb;
      else if (sortCol === 'share') cmp = a.pct - b.pct;
      return sortDesc ? -cmp : cmp;
    });
  }, [usageData, sortCol, sortDesc]);

  const totalTb = usageData.reduce((acc, curr) => acc + curr.tb, 0);
  const avgTb = usageData.length > 0 ? totalTb / usageData.length : 0;
  
  const offlineCount = sites.filter(s => {
    const st = siteStatus(s);
    return st === 'dark';
  }).length;
  const reportingCount = sites.length - offlineCount;

  function toggleSort(col: 'name' | 'usage' | 'share') {
    if (sortCol === col) setSortDesc(!sortDesc);
    else {
      setSortCol(col);
      setSortDesc(col !== 'name'); // default descending for numbers, ascending for name
    }
  }

  function getSortClass(col: string) {
    if (sortCol !== col) return 'sortable';
    return `sortable sort-${sortDesc ? 'desc' : 'asc'}`;
  }

  return (
    <div className="view">
      <div className="hero-flow">
        <div>
          <div className="timecode">Reports · {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
          <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
            Fleet health &amp; data usage.
          </h1>
          <p className="lede">
            Month-to-date connectivity and Starlink consumption per school, ready to export for leadership.
          </p>
        </div>
        <button 
          className="primary-action" 
          onClick={() => alert('Exporting report...')}
        >
          Download report
        </button>
      </div>

      <div className="report-hero" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="kpi" style={{ background: 'var(--surface)', padding: 20, border: '1px solid var(--rule)' }}>
          <div className="kpi-label" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Fleet Uptime</div>
          <div className="kpi-value ok" style={{ fontSize: 24, fontWeight: 600, color: 'var(--ok)', fontFamily: 'var(--font-mono)' }}>99.42%</div>
          <div className="kpi-sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Average across {sites.length} sites</div>
        </div>
        <div className="kpi" style={{ background: 'var(--surface)', padding: 20, border: '1px solid var(--rule)' }}>
          <div className="kpi-label" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Data this month</div>
          <div className="kpi-value" style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{totalTb.toFixed(1)} TB</div>
          <div className="kpi-sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>+11% vs last month</div>
        </div>
        <div className="kpi" style={{ background: 'var(--surface)', padding: 20, border: '1px solid var(--rule)' }}>
          <div className="kpi-label" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Avg per school</div>
          <div className="kpi-value" style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{avgTb.toFixed(2)} TB</div>
          <div className="kpi-sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>month to date</div>
        </div>
        <div className="kpi" style={{ background: 'var(--surface)', padding: 20, border: '1px solid var(--rule)' }}>
          <div className="kpi-label" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Schools reporting</div>
          <div className="kpi-value" style={{ fontSize: 24, fontWeight: 600, color: offlineCount > 0 ? 'var(--warn)' : 'var(--ok)', fontFamily: 'var(--font-mono)' }}>
            {reportingCount}/{sites.length}
          </div>
          <div className="kpi-sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            {offlineCount > 0 ? `${offlineCount} offline` : 'All sites reporting'}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Data usage by school</h2>
          <button 
            className="btn-row" 
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show top 6' : `Show all ${sites.length}`}
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className={getSortClass('name')} onClick={() => toggleSort('name')} style={{ width: 250, cursor: 'pointer' }}>School</th>
                <th className={`${getSortClass('usage')} num`} onClick={() => toggleSort('usage')} style={{ width: 140, cursor: 'pointer' }}>Month to Date</th>
                <th className={getSortClass('share')} onClick={() => toggleSort('share')} style={{ cursor: 'pointer' }}>Share of Fleet</th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? sortedUsage : sortedUsage.slice(0, 6)).map((row, idx) => (
                <tr key={idx}>
                  <td style={{ color: 'var(--ink)' }}>{row.site.name}</td>
                  <td className="num mono" style={{ fontSize: 13 }}>{row.tb.toFixed(2)} TB</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="storage-bar" style={{ flex: 1 }}>
                        <div className="storage-fill" style={{ width: `${row.pct}%`, background: 'var(--accent)' }}></div>
                      </div>
                      <span className="mono" style={{ width: 40, textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{Math.round(row.pct)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-head">
            <h2 style={{ fontSize: 13, fontWeight: 600 }}>Uptime trend</h2>
            <span className="meta">last 14 days</span>
          </div>
          <div className="chart-panel-body" style={{ padding: 16 }}>
            <div className="chart-container" style={{ position: 'relative', height: 100 }}>
              <svg viewBox="0 0 480 150" style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
                <line x1="0" y1="120" x2="480" y2="120" stroke="var(--rule)" strokeWidth="1"/>
                <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points="0,40 36,30 72,46 108,34 144,52 180,28 216,44 252,30 288,60 324,38 360,32 396,42 432,30 468,36"/>
              </svg>
            </div>
            <div className="muted mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 8 }}>
              <span>Day 1</span>
              <span>Day 7</span>
              <span>Day 14</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-head">
            <h2 style={{ fontSize: 13, fontWeight: 600 }}>Export Data</h2>
          </div>
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Daily bandwidth consumption metrics per site in CSV format.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 110, padding: 8, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>From</div>
                <div style={{ fontSize: 12, marginTop: 2, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>2026-06-01</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, padding: 8, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>To</div>
                <div style={{ fontSize: 12, marginTop: 2, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>2026-06-15</div>
              </div>
            </div>
            <button 
              className="primary-action" 
              style={{ justifySelf: 'start', marginTop: 6 }} 
              onClick={() => alert('Generating CSV...')}
            >
              Generate CSV Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
