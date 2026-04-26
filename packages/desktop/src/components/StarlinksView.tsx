import { useState, useMemo } from 'react';
import { Site, TriggerType, computeSignalScore, downloadCsv, siteStatus } from '@starfleet/shared';
import { StatusChip } from './StatusChip';
import { DishDrawer } from './DishDrawer';

interface Props {
  sites: Site[];
  isAdmin: boolean;
  onSelectSite: (id: number) => void;
  onTriggerSite: (siteId: number, type: TriggerType) => Promise<void>;
  onImportMonthlyUsage: (
    month: string,
    entries: Array<{ site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number }>,
  ) => Promise<void>;
}

type StatusFilter = 'all' | 'online' | 'degraded' | 'dark';

export function StarlinksView({ sites, isAdmin, onSelectSite, onTriggerSite, onImportMonthlyUsage }: Props) {
  const [q, setQ]                       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [drawerSiteId, setDrawerSiteId] = useState<number | null>(null);
  const [uploading, setUploading]       = useState(false);

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

  function exportRows() {
    downloadCsv(buildStarlinksCsv(rows), `starfleet_starlinks_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async function importMonthlyData(file: File | null) {
    if (!file) return;
    const defaultMonth = new Date().toISOString().slice(0, 7);
    const month = window.prompt('Month to import (YYYY-MM)', defaultMonth);
    if (!month) return;

    setUploading(true);
    try {
      const text = await file.text();
      const entries = parseMonthlyUsageCsv(text);
      if (!entries.length) throw new Error('No usable rows found. Expected columns: site_id plus gb_total, mb_total, or bytes_total.');
      await onImportMonthlyUsage(month, entries);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Monthly usage import failed.');
    } finally {
      setUploading(false);
    }
  }

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
            {isAdmin && (
              <label className={`btn${uploading ? ' is-disabled' : ''}`}>
                {uploading ? 'Uploading…' : 'Upload monthly data'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={e => {
                    void importMonthlyData(e.currentTarget.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}
            <button className="btn" onClick={exportRows}>Export CSV</button>
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
        isAdmin={isAdmin}
        onTriggerSite={onTriggerSite}
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

function buildStarlinksCsv(sites: Site[]): string {
  const rows = sites.map(site => {
    const sig = site.signal;
    return [
      site.id,
      site.name,
      siteStatus(site),
      site.location ?? '',
      site.starlink_sn ?? '',
      site.starlink_uuid ?? '',
      site.online_laptops,
      site.total_laptops,
      site.score ?? '',
      sig?.pop_latency_ms ?? '',
      sig?.snr ?? '',
      sig?.obstruction_pct ?? '',
      sig?.ping_drop_pct ?? '',
      sig?.updatedAt ?? '',
    ];
  });

  return toCsv([
    ['site_id', 'site_name', 'status', 'location', 'starlink_sn', 'starlink_uuid', 'online_laptops', 'total_laptops', 'score', 'latency_ms', 'snr', 'obstruction_pct', 'ping_drop_pct', 'updated_at'],
    ...rows,
  ]);
}

function parseMonthlyUsageCsv(text: string): Array<{ site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number }> {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const siteIndex = headers.indexOf('site_id');
  const gbIndex = headers.indexOf('gb_total');
  const mbIndex = headers.indexOf('mb_total');
  const bytesIndex = headers.indexOf('bytes_total');
  if (siteIndex === -1) return [];

  return lines.slice(1).flatMap(line => {
    const cells = splitCsvLine(line);
    const site_id = Number(cells[siteIndex]);
    if (!Number.isInteger(site_id) || site_id <= 0) return [];

    const entry: { site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number } = { site_id };
    if (gbIndex !== -1 && cells[gbIndex] !== '') entry.gb_total = Number(cells[gbIndex]);
    else if (mbIndex !== -1 && cells[mbIndex] !== '') entry.mb_total = Number(cells[mbIndex]);
    else if (bytesIndex !== -1 && cells[bytesIndex] !== '') entry.bytes_total = Number(cells[bytesIndex]);

    const total = entry.gb_total ?? entry.mb_total ?? entry.bytes_total;
    return total != null && Number.isFinite(total) && total >= 0 ? [entry] : [];
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map(row => row.map(cell => {
    const value = String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\n');
}
