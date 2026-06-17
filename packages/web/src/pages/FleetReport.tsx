import { useData } from '../context/DataContext';

export default function FleetReport() {
  const { dishes, loading } = useData();

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Fleet Report...
      </div>
    );
  }

  const totalLaptops = dishes.reduce((s, d) => s + d.laptops, 0);
  const totalSites = dishes.length;
  const onlineSites = dishes.filter(d => d.status === 'online').length;
  const totalTB = +(dishes.reduce((acc, d) => acc + (0.5 + d.laptops * 0.15), 0)).toFixed(1);
  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Biweekly Fleet Report</p>
          <h1 className="sf-view-title">Fleet <em>Report</em></h1>
          <p className="sf-view-lede">Full operational summary for the Isomo EdTech fleet. Generated automatically from telemetry snapshots.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <input type="date" className="sf-input" defaultValue="2026-06-01" style={{ width: 'auto' }} />
            <span style={{ color: 'var(--ink-3)', alignSelf: 'center' }}>to</span>
            <input type="date" className="sf-input" defaultValue="2026-06-15" style={{ width: 'auto' }} />
            <select className="sf-input" defaultValue="all" style={{ width: 'auto' }}>
              <option value="all">All Regions</option>
              <option value="kigali">Kigali</option>
              <option value="north">Northern Province</option>
              <option value="south">Southern Province</option>
            </select>
          </div>
        </div>
        <div className="sf-view-actions">
          <button className="btn btn--primary" onClick={() => alert('Generating PDF...')} id="btn-export-report">
            <i className="ti ti-file-analytics" aria-hidden="true" /> Export PDF
          </button>
          <button className="btn" onClick={() => alert('Generating CSV...')} id="btn-export-csv">
            <i className="ti ti-file-spreadsheet" aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-strip" style={{ '--kpi-cols': '4' } as React.CSSProperties}>
        <div className="kpi"><div className="kpi-label">Data This Month</div><div className="kpi-value">{totalTB} TB</div><div className="kpi-sub">+11% vs last month</div></div>
        <div className="kpi"><div className="kpi-label">Avg per School</div><div className="kpi-value">{(totalTB / onlineSites).toFixed(2)} TB</div><div className="kpi-sub">month to date</div></div>
        <div className="kpi">
          <div className="kpi-label">Schools Reporting</div>
          <div className="kpi-value" style={{ color: onlineSites < totalSites ? 'var(--warn)' : 'var(--ok)' }}>{onlineSites}/{totalSites}</div>
          <div className="kpi-sub">{totalSites - onlineSites} offline this period</div>
        </div>
        <div className="kpi"><div className="kpi-label">Total Devices</div><div className="kpi-value">{totalLaptops}</div><div className="kpi-sub">laptops across fleet</div></div>
      </div>

      {/* Usage table */}
      <div className="panel">
        <div className="panel-head">
          <h2>Data Usage by School</h2>
          <span className="meta">June 1 – 15, 2026</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Fleet data usage">
            <thead>
              <tr>
                <th>School</th>
                <th>Region</th>
                <th className="num">Status</th>
                <th className="num">Laptops</th>
                <th className="num">Estimated Usage</th>
                <th>Share of Fleet</th>
              </tr>
            </thead>
            <tbody>
              {dishes
                .slice()
                .sort((a, b) => b.laptops - a.laptops)
                .map(d => {
                  const tb = +(0.5 + d.laptops * 0.15).toFixed(2);
                  const pct = Math.round((tb / totalTB) * 100);
                  return (
                    <tr key={d.serial}>
                      <td className="cell-primary">{d.name}</td>
                      <td className="cell-mono">{d.region}</td>
                      <td className="num">
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: d.status === 'online' ? 'var(--ok)' : d.status === 'degraded' ? 'var(--warn)' : 'var(--bad)', textTransform: 'uppercase' }}>
                          {d.status}
                        </span>
                      </td>
                      <td className="num cell-mono">{d.laptops}</td>
                      <td className="num cell-mono">{tb} TB</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                            <div style={{ width: `${Math.min(pct * 3, 100)}%`, height: '100%', background: 'var(--accent)' }} />
                          </div>
                          <span className="cell-mono" style={{ fontSize: 10, minWidth: 30 }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Uptime chart */}
      <div className="panel">
        <div className="panel-head"><h2>Uptime Trend</h2><span className="meta">Last 14 days</span></div>
        <div style={{ padding: '16px 20px' }}>
          <svg viewBox="0 0 480 100" style={{ width: '100%', height: 100 }} aria-label="Uptime trend chart">
            <line x1="0" y1="80" x2="480" y2="80" stroke="var(--rule)" strokeWidth="1" />
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              points="0,40 36,30 72,46 108,34 144,52 180,28 216,44 252,30 288,60 324,38 360,32 396,42 432,30 468,36"
            />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
            <span>June 1</span>
            <span>June 7</span>
            <span>June 15</span>
          </div>
        </div>
      </div>
    </div>
  );
}
