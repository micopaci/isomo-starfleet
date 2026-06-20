// Builds a print-ready Starlink Data Usage Report (HTML) that mirrors the
// branded PDF layout. Opened in a new window and printed → PDF by the browser.

interface UsageRow {
  log_date: string;
  service_line_id: string;
  nickname: string | null;
  site_name: string | null;
  consumed_gb: number | null;
}

interface TerminalRow {
  service_line_id: string;
  nickname: string | null;
  site_name: string | null;
  current_status: string;
}

interface Agg {
  name: string;
  serviceLine: string;
  status: string;
  total: number;
  days: Set<string>;
  peakGb: number;
  peakDate: string;
}

const GB = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function buildStarlinkReportHtml(rows: UsageRow[], terminals: TerminalRow[], from: string, to: string): string {
  const totalDays = daysBetween(from, to);

  // Per-terminal aggregation
  const byTerm = new Map<string, Agg>();
  const byDay = new Map<string, number>();
  let fleetTotal = 0;

  for (const r of rows) {
    const gb = Number(r.consumed_gb) || 0;
    fleetTotal += gb;
    byDay.set(r.log_date, (byDay.get(r.log_date) || 0) + gb);
    let a = byTerm.get(r.service_line_id);
    if (!a) {
      a = { name: r.nickname || r.site_name || r.service_line_id, serviceLine: r.service_line_id, status: 'Online', total: 0, days: new Set(), peakGb: 0, peakDate: '' };
      byTerm.set(r.service_line_id, a);
    }
    a.total += gb;
    if (gb > 0) a.days.add(r.log_date);
    if (gb > a.peakGb) { a.peakGb = gb; a.peakDate = r.log_date; }
  }

  // Merge full terminal inventory (status + terminals without usage)
  const statusBy = new Map<string, string>();
  for (const t of terminals) {
    statusBy.set(t.service_line_id, t.current_status || 'Unknown');
    if (!byTerm.has(t.service_line_id)) {
      byTerm.set(t.service_line_id, { name: t.nickname || t.site_name || t.service_line_id, serviceLine: t.service_line_id, status: t.current_status || 'Unknown', total: 0, days: new Set(), peakGb: 0, peakDate: '' });
    }
  }
  for (const [sl, a] of byTerm) a.status = statusBy.get(sl) || a.status;

  const allAgg = [...byTerm.values()].sort((x, y) => y.total - x.total);
  const withUsage = allAgg.filter(a => a.total > 0).length;
  const tracked = byTerm.size;
  const reportingDays = byDay.size;
  const avgFleetDay = reportingDays ? fleetTotal / reportingDays : 0;
  let peakDay = ''; let peakDayGb = 0;
  for (const [d, v] of byDay) if (v > peakDayGb) { peakDayGb = v; peakDay = d; }
  const dailyRecords = rows.filter(r => (Number(r.consumed_gb) || 0) >= 0).length;
  const statusCounts: Record<string, number> = {};
  for (const a of allAgg) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  const statusLabel = Object.entries(statusCounts).map(([s, n]) => `${s}: ${n}`).join(', ');

  const top10 = allAgg.filter(a => a.total > 0).slice(0, 10);
  const top10Max = top10.length ? top10[0].total : 1;

  const dayKeys = [...byDay.keys()].sort();
  const dayMax = Math.max(...byDay.values(), 1);

  // Coverage notes: terminals with partial coverage or no usage
  const coverage = allAgg
    .map(a => {
      const dcount = a.days.size;
      if (a.total === 0) return { cond: 'No usage rows', name: a.name, status: a.status, cov: `0/${totalDays}`, note: 'Inactive terminal in Starfleet inventory.' };
      if (dcount < totalDays) return { cond: 'Partial coverage', name: a.name, status: a.status, cov: `${dcount}/${totalDays}`, note: '' };
      return null;
    })
    .filter(Boolean) as { cond: string; name: string; status: string; cov: string; note: string }[];

  const fmtRange = `${from} – ${to}`;
  const genAt = new Date().toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const kpiCard = (value: string, label: string, sub: string, accent = false) =>
    `<div class="kpi"><div class="kpi-v${accent ? ' accent' : ''}">${value}</div><div class="kpi-l">${label}</div><div class="kpi-s">${sub}</div></div>`;

  const top10Rows = top10.map((a, i) =>
    `<div class="bar-row">
      <div class="bar-label">${i + 1}. ${esc(a.name)}</div>
      <div class="bar-track"><div class="bar-fill ${i < 2 ? 'green' : 'amber'}" style="width:${Math.max(2, (a.total / top10Max) * 100)}%"></div></div>
      <div class="bar-val">${GB(a.total)} GB</div>
    </div>`).join('');

  const dailyBars = dayKeys.map(d => {
    const v = byDay.get(d) || 0;
    const isPeak = d === peakDay;
    return `<div class="dbar ${isPeak ? 'green' : 'amber'}" style="height:${Math.max(1, (v / dayMax) * 100)}%" title="${d}: ${GB(v)} GB"></div>`;
  }).join('');

  const coverageRows = coverage.length
    ? coverage.map(c => `<tr><td>${esc(c.cond)}</td><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.cov)}</td><td>${esc(c.note)}</td></tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#888">Full coverage across all reporting terminals.</td></tr>`;

  const rankedRows = allAgg.map((a, i) => {
    const dcount = a.days.size;
    const avg = dcount ? a.total / dcount : 0;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(a.name)}</td>
      <td class="mono">${esc(a.serviceLine)}</td>
      <td>${esc(a.status)}</td>
      <td class="num">${dcount}/${totalDays}</td>
      <td class="num">${GB(a.total)}</td>
      <td class="num">${avg ? avg.toFixed(1) : '0.0'}</td>
      <td class="num">${a.peakDate ? `${a.peakDate.slice(5)} / ${a.peakGb.toFixed(1)}` : '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Starlink Data Usage Report ${from} to ${to}</title>
<style>
  @page { size: landscape; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1d1d1b; background: #faf7ef; margin: 0; padding: 24px; }
  h1 { text-align: center; font-size: 34px; font-weight: 600; margin: 4px 0 2px; letter-spacing: .5px; }
  .sub { text-align: left; color: #555; font-size: 13px; margin: 0 0 16px; }
  .callout { background: #eef3ea; border: 1px solid #d7e2d0; border-radius: 6px; padding: 12px 16px; margin-bottom: 18px; }
  .callout b { font-size: 12px; } .callout p { margin: 4px 0 0; font-size: 11px; color: #555; }
  .kpis { display: flex; gap: 12px; margin-bottom: 18px; }
  .kpi { flex: 1; border: 1px solid #e0dccd; border-radius: 8px; padding: 14px 16px; background: #fff; }
  .kpi-v { font-size: 26px; font-weight: 600; } .kpi-v.accent { color: #2f7a44; }
  .kpi-l { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #777; margin-top: 6px; }
  .kpi-s { font-size: 10px; color: #999; margin-top: 6px; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; }
  .meta-tbl td { border: 1px solid #e6e2d6; padding: 8px 12px; }
  .meta-tbl td:first-child { width: 180px; color: #555; }
  .section-h { font-size: 20px; font-weight: 600; margin: 22px 0 10px; }
  .cols { display: flex; gap: 30px; }
  .col { flex: 1; }
  .col-h { font-size: 16px; margin: 0 0 12px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; font-family: Arial, sans-serif; font-size: 11px; }
  .bar-label { width: 150px; } .bar-val { width: 80px; text-align: right; color: #444; }
  .bar-track { flex: 1; background: #eef1ea; height: 13px; border-radius: 2px; }
  .bar-fill { height: 100%; border-radius: 2px; } .bar-fill.green { background: #2f7a44; } .bar-fill.amber { background: #d9a441; }
  .chart { display: flex; align-items: flex-end; gap: 2px; height: 200px; border-bottom: 1px solid #ccc; }
  .dbar { flex: 1; min-width: 3px; } .dbar.green { background: #2f7a44; } .dbar.amber { background: #d9a441; }
  .data-tbl th { background: #1d1d1b; color: #fff; text-align: left; padding: 7px 9px; font-size: 10px; }
  .data-tbl td { border: 1px solid #e6e2d6; padding: 6px 9px; }
  .data-tbl .num { text-align: right; } .data-tbl .mono { font-family: 'Courier New', monospace; }
  .ranked th { background: #1d1d1b; color: #fff; text-align: left; padding: 7px 9px; font-size: 10px; }
  .ranked td { border-bottom: 1px solid #eee; padding: 6px 9px; }
  .ranked .num { text-align: right; } .ranked .mono { font-family: 'Courier New', monospace; }
  .page-break { page-break-before: always; }
  .foot { margin-top: 14px; border-top: 1px solid #ddd; padding-top: 6px; font-family: Arial, sans-serif; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .noprint { text-align: center; margin-bottom: 16px; }
  .noprint button { font-family: Arial; font-size: 13px; padding: 8px 18px; background: #2f7a44; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
</style></head><body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

  <h1>Starlink Data Usage Report</h1>
  <p class="sub">${fmtRange} · all Starlink service lines in Starfleet</p>

  <div class="callout"><b>Source and date semantics</b><p>Window uses [${from}, ${to}]. Values come from direct Starlink telemetryagg history (starlink_usage_history) by service_line_id.</p></div>

  <div class="kpis">
    ${kpiCard(`${GB(fleetTotal)} GB`, 'Fleet total', 'Direct Starlink usage history\nAll terminals included', true)}
    ${kpiCard(String(tracked), 'Starlinks tracked', `${withUsage} with usage\n${tracked - withUsage} without usage`)}
    ${kpiCard(`${GB(avgFleetDay)} GB`, 'Average fleet day', `${dailyRecords} daily records\n${reportingDays} reporting days`)}
    ${kpiCard(peakDay || '—', 'Peak fleet day', peakDayGb ? `${GB(peakDayGb)} GB\nHighest daily total` : '—')}
    ${kpiCard(String(withUsage), 'Reporting terminals', `of ${tracked} tracked`)}
  </div>

  <table class="meta-tbl">
    <tr><td>Generated</td><td>${esc(genAt)}</td></tr>
    <tr><td>Terminal statuses</td><td>${esc(statusLabel)}</td></tr>
    <tr><td>Source tables</td><td>starlink_usage_history, starlink_terminals, sites</td></tr>
    <tr><td>Window</td><td>${from} to ${to}</td></tr>
  </table>
  <div class="foot"><span>Starfleet Starlink usage report — source: starlink_usage_history</span><span>Page 1</span></div>

  <div class="page-break"></div>
  <div class="cols">
    <div class="col"><h3 class="col-h">Top 10 Starlinks by usage</h3>${top10Rows || '<p style="color:#888;font-size:12px">No usage in range.</p>'}</div>
    <div class="col"><h3 class="col-h">Fleet daily total usage</h3><div class="chart">${dailyBars}</div><p style="font-size:10px;color:#888;margin-top:6px">${dayKeys[0] || ''} → ${dayKeys[dayKeys.length - 1] || ''}${peakDay ? ` · peak ${peakDay}: ${GB(peakDayGb)} GB` : ''}</p></div>
  </div>
  <h2 class="section-h">Coverage notes</h2>
  <table class="data-tbl"><thead><tr><th>Condition</th><th>Starlink</th><th>Status</th><th>Coverage</th><th>Note</th></tr></thead><tbody>${coverageRows}</tbody></table>
  <div class="foot"><span>Starfleet Starlink usage report — source: starlink_usage_history</span><span>Page 2</span></div>

  <div class="page-break"></div>
  <h2 class="section-h">Ranked Starlink Usage Summary</h2>
  <p class="sub">Totals are ${fmtRange} GB. Avg/day is over days with a reported Starlink usage row.</p>
  <table class="ranked"><thead><tr><th>Rank</th><th>Starlink / site</th><th>Service line</th><th>Status</th><th>Days</th><th>Total GB</th><th>Avg/day</th><th>Peak</th></tr></thead><tbody>${rankedRows}</tbody></table>
  <div class="foot"><span>Starfleet Starlink usage report — source: starlink_usage_history</span><span>Page 3</span></div>
</body></html>`;
}
