import { useState, useMemo } from 'react';
import StatusChip from '../components/StatusChip';
import Drawer from '../components/Drawer';
import { useData, type Dish, type Status } from '../context/DataContext';

const STATUS_FILTERS: { label: string; value: Status | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Degraded', value: 'degraded' },
  { label: 'Offline', value: 'offline' },
  { label: 'Inactive', value: 'inactive' },
];

function tone(status: Status): 'ok' | 'warn' | 'bad' | 'mute' {
  if (status === 'online') return 'ok';
  if (status === 'degraded') return 'warn';
  if (status === 'inactive') return 'mute';
  return 'bad';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '';
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs >= 1) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  return mins >= 1 ? `${mins}m ago` : 'just now';
}

const SORT_ACCESSORS: Record<string, (d: Dish) => string | number> = {
  name: d => d.name.toLowerCase(),
  region: d => d.region.toLowerCase(),
  status: d => d.status,
  lastSeen: d => (d.lastSeen ? new Date(d.lastSeen).getTime() : 0),
  statusSince: d => (d.statusUpdatedAt ? new Date(d.statusUpdatedAt).getTime() : 0),
  data: d => d.dataGb,
  rain: d => d.rain,
  uptime: d => d.uptime,
  agent: d => (d.agent ? 1 : 0),
};

export default function Starlinks() {
  const { dishes: activeDishes, inactiveDishes, loading } = useData();
  const [filter, setFilter] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Dish | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const toggleSort = (key: string) =>
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  // The Starlinks list is terminal-aware: it shows the active site-based fleet
  // plus suspended/disabled service lines (which never surface through /api/sites).
  const dishes = useMemo(() => [...activeDishes, ...inactiveDishes], [activeDishes, inactiveDishes]);

  const filtered = useMemo(() => {
    const rows = dishes.filter(d => {
      const matchFilter = filter === 'all' || d.status === filter;
      const q = search.toLowerCase();
      const matchSearch = !q || d.name.toLowerCase().includes(q) || d.campus.toLowerCase().includes(q) || d.region.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
    const accessor = SORT_ACCESSORS[sort.key] || SORT_ACCESSORS.name;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [dishes, filter, search, sort]);

  const counts = useMemo(() => ({
    online: dishes.filter(d => d.status === 'online').length,
    degraded: dishes.filter(d => d.status === 'degraded').length,
    offline: dishes.filter(d => d.status === 'offline').length,
    inactive: dishes.filter(d => d.status === 'inactive').length,
  }), [dishes]);

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Starlink Terminals...
      </div>
    );
  }

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Network Infrastructure</p>
          <h1 className="sf-view-title">Starlink <em>Terminals</em></h1>
          <p className="sf-view-lede">All {dishes.length} Starlink dishes deployed across Rwanda. {counts.online} online, {counts.degraded} degraded, {counts.offline} offline, {counts.inactive} inactive.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              className={`seg-btn${filter === f.value ? ' is-active' : ''}`}
              onClick={() => setFilter(f.value)}
              id={`filter-starlinks-${f.value}`}
            >
              {f.label}
              <span className="seg-count">
                {f.value === 'all' ? dishes.length : f.value === 'online' ? counts.online : f.value === 'degraded' ? counts.degraded : f.value === 'offline' ? counts.offline : counts.inactive}
              </span>
            </button>
          ))}
        </div>
        <div className="search" style={{ marginLeft: 'auto', width: 240 }}>
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search sites or regions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            id="search-starlinks"
            aria-label="Search Starlinks"
          />
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-head">
          <h2>Dish Registry</h2>
          <span className="meta">{filtered.length} of {dishes.length} shown</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Starlink terminals">
            <thead>
              <tr>
                {([
                  ['name', 'Site', ''], ['region', 'Region', ''], ['status', 'Status', ''],
                  ['lastSeen', 'Last Seen', ''], ['statusSince', 'Status Since', ''],
                  ['data', 'Data (7d)', 'num'], ['rain', 'Rain', 'num'],
                  ['uptime', 'Uptime', 'num'], ['agent', 'Agent', ''],
                ] as [string, string, string][]).map(([key, label, cls]) => (
                  <th
                    key={key}
                    className={cls}
                    onClick={() => toggleSort(key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {label}
                    <span style={{ opacity: sort.key === key ? 0.9 : 0.25, marginLeft: 4 }}>
                      {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr
                  key={d.serial}
                  onClick={() => setSelected(d)}
                  aria-label={`${d.name} — ${d.status}`}
                >
                  <td className="cell-primary">{d.name}</td>
                  <td className="cell-mono">{d.region}</td>
                  <td><StatusChip label={d.status.toUpperCase()} tone={tone(d.status)} size="sm" /></td>
                  <td className="cell-mono" title={fmtDate(d.lastSeen)}>{d.lastSeen ? fmtRelative(d.lastSeen) : '—'}</td>
                  <td className="cell-mono" title={fmtDate(d.statusUpdatedAt)}>{d.statusUpdatedAt ? fmtRelative(d.statusUpdatedAt) : '—'}</td>
                  <td className="num cell-mono">{d.dataGb > 0 ? `${d.dataGb.toFixed(1)}GB` : '—'}</td>
                  <td className="num cell-mono" style={{ color: d.rain > 5 ? 'var(--warn)' : undefined }}>{d.rain > 0 ? `${d.rain}mm` : '—'}</td>
                  <td className="num cell-mono" style={{ color: d.uptime === 0 ? 'var(--muted)' : d.uptime >= 99 ? 'var(--ok)' : 'var(--warn)' }}>{d.uptime > 0 ? `${d.uptime.toFixed(1)}%` : '—'}</td>
                  <td>{d.agent ? <StatusChip label="Active" tone="ok" size="sm" /> : <StatusChip label="None" tone="mute" size="sm" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dish Detail Drawer */}
      {selected && (
        <Drawer onClose={() => setSelected(null)}>
          <div className="sf-drawer-head">
            <div>
              <p className="sf-timecode">Dish Diagnostics</p>
              <div className="sf-drawer-title">{selected.name}</div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 3 }}>{selected.campus} · {selected.region}</p>
            </div>
            <button className="btn btn--icon btn--sm" onClick={() => setSelected(null)} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          <div className="sf-drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <StatusChip label={selected.status.toUpperCase()} tone={tone(selected.status)} />
            {selected.statusUpdatedAt && (
              <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                since {fmtDate(selected.statusUpdatedAt)} · {fmtRelative(selected.statusUpdatedAt)}
              </span>
            )}
          </div>

          {/* At-a-glance dates / identity */}
          <div style={{ display: 'grid', gap: 1, background: 'var(--rule)', border: '1px solid var(--rule)', marginBottom: 16 }}>
            {[
              { l: 'Last seen', v: fmtDate(selected.lastSeen), s: fmtRelative(selected.lastSeen) },
              { l: 'Latest data', v: fmtDate(selected.latestUsageDate), s: selected.dataGb > 0 ? `${selected.dataGb.toFixed(1)} GB / 7d` : '' },
              { l: 'Billing cycle start', v: fmtDate(selected.billingCycleStart), s: '' },
              { l: 'Service line', v: selected.serviceLineId || '—', s: selected.accountId ? `acct ${selected.accountId}` : '' },
            ].map(row => (
              <div key={row.l} style={{ background: 'var(--surface)', padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{row.l}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)', textAlign: 'right' }}>
                  {row.v}{row.s && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{row.s}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="sf-drawer-grid">
            <div className="kpi"><div className="kpi-label">Latency</div><div className="kpi-value" style={{ color: selected.latency > 150 ? 'var(--warn)' : selected.latency === 0 ? 'var(--bad)' : 'var(--ok)' }}>{selected.latency > 0 ? `${selected.latency}ms` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Download</div><div className="kpi-value">{selected.down > 0 ? `${selected.down}M` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Upload</div><div className="kpi-value">{selected.up > 0 ? `${selected.up}M` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">SNR</div><div className="kpi-value">{selected.snr > 0 ? `${selected.snr.toFixed(1)}dB` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Obstruction</div><div className="kpi-value" style={{ color: selected.obstruction > 1 ? 'var(--warn)' : undefined }}>{selected.obstruction > 0 ? `${selected.obstruction.toFixed(2)}%` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Data (7d)</div><div className="kpi-value">{selected.dataGb > 0 ? `${selected.dataGb.toFixed(1)}GB` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Uptime</div><div className="kpi-value">{selected.uptime > 0 ? `${selected.uptime.toFixed(1)}%` : '—'}</div></div>
          </div>
          <div className="sf-drawer-section">
            <h3 style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>10-day data usage (GB)</h3>
            {(() => {
              const max = Math.max(...selected.spark, 1);
              return (
                <svg viewBox="0 0 360 60" style={{ width: '100%', height: 60 }}>
                  {selected.spark.map((v, i) => (
                    <rect
                      key={i}
                      x={i * 38}
                      y={60 - (v / max) * 56}
                      width={30}
                      height={(v / max) * 56}
                      fill="var(--accent)"
                      opacity={.85}
                    />
                  ))}
                </svg>
              );
            })()}
          </div>
          <div className="sf-drawer-foot">
            <button className="btn btn--primary" onClick={() => alert('Initiating diagnostics sweep...')}>Diagnostics</button>
            <button className="btn" onClick={() => alert('Sending ping...')}>Ping dish</button>
            <button className="btn btn--danger-outline" onClick={() => { if (confirm('Reboot this terminal?')) alert('Reboot dispatched.'); }}>Reboot</button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
