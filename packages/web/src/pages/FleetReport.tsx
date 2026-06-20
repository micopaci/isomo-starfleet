import { useState } from 'react';
import { useData } from '../context/DataContext';

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 14);
  const iso = (d: Date) => d.toISOString().split('T')[0];
  return { from: iso(from), to: iso(to) };
}

export default function FleetReport() {
  const { dishes, loading } = useData();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('sf_token');
      // Real portal usage lives in starlink_usage_history, served by /api/starlink-usage.
      const res = await fetch(`/api/starlink-usage?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        alert(`Export failed (${res.status}). ${msg.slice(0, 200)}`);
        return;
      }
      const json = await res.json();
      // /api/starlink-usage returns { from, to, rows: [...] }
      const rows = Array.isArray(json) ? json : (json?.rows || []);
      if (rows.length === 0) {
        alert(`No usage records found for ${from} → ${to}.`);
        return;
      }
      const headers = ['log_date', 'site_name', 'nickname', 'service_line_id', 'account_id', 'consumed_gb', 'billing_cycle_start', 'collected_at'];
      const esc = (v: any) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(','), ...rows.map((r: any) => headers.map(h => esc(r[h])).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `starlink_usage_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err?.message || 'network error'}`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Fleet Report...
      </div>
    );
  }

  const activeDishes = dishes.filter(d => d.status !== 'inactive');
  const totalLaptops = activeDishes.reduce((s, d) => s + d.laptops, 0);
  const totalSites = activeDishes.length;
  const onlineSites = activeDishes.filter(d => d.status === 'online').length;
  // Real data consumption (last 7 days) from the portal usage sync.
  const totalDataGb = +(activeDishes.reduce((acc, d) => acc + (d.dataGb || 0), 0)).toFixed(1);
  const reportingSchools = activeDishes.filter(d => d.dataGb > 0).length;
  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Biweekly Fleet Report</p>
          <h1 className="sf-view-title">Fleet <em>Report</em></h1>
          <p className="sf-view-lede">Full operational summary for the Isomo EdTech fleet. Generated automatically from telemetry snapshots.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <input type="date" className="sf-input" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} />
            <span style={{ color: 'var(--ink-3)', alignSelf: 'center' }}>to</span>
            <input type="date" className="sf-input" value={to} min={from} onChange={e => setTo(e.target.value)} style={{ width: 'auto' }} />
          </div>
        </div>
        <div className="sf-view-actions">
          <button className="btn btn--primary" onClick={() => window.print()} id="btn-export-report">
            <i className="ti ti-printer" aria-hidden="true" /> Print / PDF
          </button>
          <button className="btn" onClick={exportCsv} disabled={exporting} id="btn-export-csv">
            <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-strip" style={{ '--kpi-cols': '4' } as React.CSSProperties}>
        <div className="kpi"><div className="kpi-label">Data (last 7d)</div><div className="kpi-value">{totalDataGb} GB</div><div className="kpi-sub">across active fleet</div></div>
        <div className="kpi"><div className="kpi-label">Avg per School</div><div className="kpi-value">{reportingSchools ? (totalDataGb / reportingSchools).toFixed(1) : '0'} GB</div><div className="kpi-sub">{reportingSchools} reporting usage</div></div>
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
          <span className="meta">{from} → {to}</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Fleet data usage">
            <thead>
              <tr>
                <th>School</th>
                <th>Region</th>
                <th className="num">Status</th>
                <th className="num">Laptops</th>
                <th className="num">Data (7d)</th>
                <th>Share of Fleet</th>
              </tr>
            </thead>
            <tbody>
              {activeDishes
                .slice()
                .sort((a, b) => b.dataGb - a.dataGb)
                .map(d => {
                  const pct = totalDataGb ? Math.round((d.dataGb / totalDataGb) * 100) : 0;
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
                      <td className="num cell-mono">{d.dataGb > 0 ? `${d.dataGb.toFixed(1)} GB` : '—'}</td>
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

    </div>
  );
}
