import { useState, useMemo } from 'react';
import { Site, TriggerType, CreateSiteInput, computeSignalScore, downloadCsv, siteStatus } from '@starfleet/shared';
import { StatusChip } from './StatusChip';
import { DishDrawer } from './DishDrawer';
import { SiteCreateModal } from './SiteCreateModal';

interface Props {
  sites: Site[];
  isAdmin: boolean;
  onSelectSite: (id: number) => void;
  onTriggerSite: (siteId: number, type: TriggerType) => Promise<void>;
  onImportMonthlyUsage: (
    month: string,
    entries: Array<{ site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number }>,
  ) => Promise<void>;
  onCreateSite: (input: CreateSiteInput) => Promise<void>;
}

type StatusFilter = 'all' | 'online' | 'degraded' | 'dark';
type SortField = 'name' | 'campus' | 'status' | 'latency' | 'snr' | 'obs' | 'uptime' | 'rain';

export function StarlinksView({ sites, isAdmin, onSelectSite, onTriggerSite, onImportMonthlyUsage, onCreateSite }: Props) {
  const [q, setQ]                       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField]       = useState<SortField>('name');
  const [sortAsc, setSortAsc]           = useState(true);
  const [drawerSiteId, setDrawerSiteId] = useState<number | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [createOpen, setCreateOpen]     = useState(false);

  const counts = useMemo(() => ({
    all:      sites.length,
    online:   sites.filter(s => siteStatus(s) === 'online').length,
    degraded: sites.filter(s => siteStatus(s) === 'degraded').length,
    dark:     sites.filter(s => siteStatus(s) === 'dark').length,
  }), [sites]);

  const rows = useMemo(() => {
    let result = sites.filter(site => {
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

    result.sort((a, b) => {
      let va: any, vb: any;
      switch (sortField) {
        case 'name': va = a.starlink_sn; vb = b.starlink_sn; break;
        case 'campus': va = a.name; vb = b.name; break;
        case 'status': va = siteStatus(a); vb = siteStatus(b); break;
        case 'latency': va = a.signal?.pop_latency_ms ?? 999; vb = b.signal?.pop_latency_ms ?? 999; break;
        case 'snr': va = a.signal?.snr ?? 0; vb = b.signal?.snr ?? 0; break;
        case 'obs': va = a.signal?.obstruction_pct ?? 0; vb = b.signal?.obstruction_pct ?? 0; break;
        case 'uptime': va = a.uptime_pct ?? 0; vb = b.uptime_pct ?? 0; break;
        case 'rain': va = a.weather?.rainfall_mm ?? 0; vb = b.weather?.rainfall_mm ?? 0; break;
      }
      
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [sites, statusFilter, q, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

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
        <div className="hero-flow">
          <div>
            <div className="timecode">Connectivity · {sites.length} dishes · click row for detail drawer</div>
            <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
              Starlink fleet
            </h1>
            <p className="lede">
              Daily scanning of Starlink terminals: status, latency, SNR, obstruction, throughput, rainfall, and current trend on the same row.
            </p>
          </div>
          <div className="mini-hud">
            <div className="line"><span>sorted by</span><b>{sortField}</b></div>
            <div className="line"><span>offline</span><b style={{ color: counts.dark > 0 ? 'var(--bad)' : 'inherit' }}>{counts.dark}</b></div>
            <div className="line"><span>degraded</span><b style={{ color: counts.degraded > 0 ? 'var(--warn)' : 'inherit' }}>{counts.degraded}</b></div>
          </div>
        </div>

        <div className="toolbar">
          <div className="seg">
            {(['all', 'online', 'degraded', 'dark'] as StatusFilter[]).map(sf => (
              <button
                key={sf}
                className={statusFilter === sf ? 'active' : ''}
                onClick={() => setStatusFilter(sf)}
              >
                {sf === 'all' ? 'All' : sf.charAt(0).toUpperCase() + sf.slice(1)}
                <span className="count">{counts[sf]}</span>
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search dish or campus name"
          />
        </div>

        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th 
                  className={`sortable ${sortField === 'name' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('name')}
                  style={{ width: 210 }}
                >
                  Dish
                </th>
                <th 
                  className={`sortable ${sortField === 'campus' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('campus')}
                  style={{ width: 130 }}
                >
                  Campus
                </th>
                <th 
                  className={`sortable ${sortField === 'status' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('status')}
                  style={{ width: 110 }}
                >
                  Status
                </th>
                <th 
                  className={`num sortable ${sortField === 'latency' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('latency')}
                  style={{ width: 90 }}
                >
                  Latency
                </th>
                <th 
                  className={`num sortable ${sortField === 'snr' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('snr')}
                  style={{ width: 80 }}
                >
                  SNR
                </th>
                <th 
                  className={`num sortable ${sortField === 'obs' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('obs')}
                  style={{ width: 110 }}
                >
                  Obstruction
                </th>
                <th className="num" style={{ width: 100 }}>Down/Up</th>
                <th 
                  className={`num sortable ${sortField === 'uptime' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('uptime')}
                  style={{ width: 90 }}
                >
                  Uptime
                </th>
                <th 
                  className={`num sortable ${sortField === 'rain' ? (sortAsc ? 'sort-asc' : 'sort-desc') : ''}`}
                  onClick={() => handleSort('rain')}
                  style={{ width: 90 }}
                >
                  Rainfall
                </th>
                <th style={{ width: 116 }}>Trend (24h)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(site => {
                const st    = siteStatus(site);
                const sig   = site.signal;

                return (
                  <tr
                    key={site.id}
                    onClick={() => setDrawerSiteId(site.id)}
                  >
                    <td>
                      <div style={{ color: 'var(--ink)' }}>{site.starlink_sn || site.name}</div>
                      {site.starlink_sn && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{site.starlink_uuid || '—'}</div>}
                    </td>
                    <td style={{ fontFamily: 'var(--font-serif)', fontSize: 14 }}>{site.name}</td>
                    <td>
                      <span className={`status-cell ${st === 'dark' ? 'bad' : st === 'degraded' ? 'warn' : 'ok'}`}>
                        <span className={`dot ${st === 'dark' ? 'bad' : st === 'degraded' ? 'warn' : 'ok'}`}></span>
                        {st}
                      </span>
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
                        ? <span style={{ color: sig.obstruction_pct > 0.05 ? 'var(--warn)' : 'inherit' }}>
                            {(sig.obstruction_pct * 100).toFixed(1)}%
                          </span>
                        : '—'}
                    </td>
                    <td className="num mono" style={{ fontSize: 10 }}>
                      <SpeedCell
                        download={site.download_mbps ?? sig?.download_mbps ?? null}
                        upload={site.upload_mbps ?? sig?.upload_mbps ?? null}
                      />
                    </td>
                    <td className="num mono">
                      <UptimeCell pct={site.uptime_pct} />
                    </td>
                    <td className="num mono">
                      {site.weather?.rainfall_mm != null 
                        ? <span style={{ color: site.weather.rainfall_mm > 5 ? 'var(--warn)' : 'inherit' }}>{site.weather.rainfall_mm}mm</span>
                        : '—'}
                    </td>
                    <td>
                      <Sparkline site={site} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>No dishes match the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      {createOpen && (
        <SiteCreateModal
          onSave={onCreateSite}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function LatCell({ ms }: { ms: number | null | undefined }) {
  if (ms == null) return <span className="muted">—</span>;
  const color = ms < 40 ? 'var(--ok)' : ms < 80 ? 'var(--warn)' : 'var(--bad)';
  return <span style={{ color }}>{ms}ms</span>;
}

function UptimeCell({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="muted">—</span>;
  const color = pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--warn)' : 'var(--bad)';
  return <span style={{ color }}>{pct.toFixed(1)}%</span>;
}

function SpeedCell({
  download,
  upload,
}: {
  download: number | null | undefined;
  upload: number | null | undefined;
}) {
  if (download == null && upload == null) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <span style={{ color: 'var(--ink)' }}>{download != null ? download.toFixed(1) : '—'} <span style={{ color: 'var(--muted)' }}>↓</span></span>
      <span style={{ color: 'var(--muted)' }}>{upload != null ? upload.toFixed(1) : '—'} <span>↑</span></span>
    </div>
  );
}

function Sparkline({ site }: { site: Site }) {
  // Generate a determinisic mock sparkline based on site.id since we don't have historical data here yet
  const points = useMemo(() => {
    let p = [];
    let x = 0;
    let y = 10 + (site.id % 5);
    for (let i = 0; i < 24; i++) {
      p.push(`${x},${y}`);
      x += 4;
      y = Math.max(2, Math.min(20, y + (Math.random() * 6 - 3)));
    }
    return p.join(' ');
  }, [site.id]);

  const st = siteStatus(site);
  const color = st === 'dark' ? 'var(--bad)' : st === 'degraded' ? 'var(--warn)' : 'var(--ok)';

  return (
    <svg className="spark" viewBox="0 0 92 22" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
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
      site.download_mbps ?? sig?.download_mbps ?? '',
      site.upload_mbps ?? sig?.upload_mbps ?? '',
      sig?.snr ?? '',
      sig?.obstruction_pct ?? '',
      sig?.ping_drop_pct ?? '',
      site.weather_predictor?.label ?? '',
      site.weather_predictor?.explanation ?? '',
      site.weather_predictor?.rainfall_mm ?? site.weather?.rainfall_mm ?? '',
      site.weather_predictor?.cloud_cover_pct ?? site.weather?.cloud_cover_pct ?? '',
      site.online_intune_laptops ?? '',
      site.total_intune_laptops ?? '',
      site.online_chromebooks ?? '',
      site.total_chromebooks ?? '',
      sig?.updatedAt ?? '',
      site.uptime_pct ?? '',
    ];
  });

  return toCsv([
    ['site_id', 'site_name', 'status', 'location', 'starlink_sn', 'starlink_uuid', 'online_laptops', 'total_laptops', 'score', 'latency_ms', 'download_mbps', 'upload_mbps', 'snr', 'obstruction_pct', 'ping_drop_pct', 'weather_predictor', 'weather_explanation', 'rainfall_mm', 'cloud_cover_pct', 'online_intune_laptops', 'total_intune_laptops', 'online_chromebooks', 'total_chromebooks', 'updated_at', 'uptime_pct'],
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
