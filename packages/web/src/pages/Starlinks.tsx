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

export default function Starlinks() {
  const { dishes: activeDishes, inactiveDishes, loading } = useData();
  const [filter, setFilter] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Dish | null>(null);

  // The Starlinks list is terminal-aware: it shows the active site-based fleet
  // plus suspended/disabled service lines (which never surface through /api/sites).
  const dishes = useMemo(() => [...activeDishes, ...inactiveDishes], [activeDishes, inactiveDishes]);

  const filtered = useMemo(() =>
    dishes.filter(d => {
      const matchFilter = filter === 'all' || d.status === filter;
      const q = search.toLowerCase();
      const matchSearch = !q || d.name.toLowerCase().includes(q) || d.campus.toLowerCase().includes(q) || d.region.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    }), [dishes, filter, search]);

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
                <th>Site</th>
                <th>Region</th>
                <th>Status</th>
                <th className="num">Latency</th>
                <th className="num">Down</th>
                <th className="num">Up</th>
                <th className="num">SNR</th>
                <th className="num">Rain</th>
                <th className="num">Uptime</th>
                <th>Agent</th>
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
                  <td className="num cell-mono" style={{ color: d.latency === 0 ? 'var(--bad)' : d.latency > 150 ? 'var(--warn)' : 'var(--ok)' }}>
                    {d.latency > 0 ? `${d.latency}ms` : '—'}
                  </td>
                  <td className="num cell-mono">{d.down > 0 ? `${d.down}M` : '—'}</td>
                  <td className="num cell-mono">{d.up > 0 ? `${d.up}M` : '—'}</td>
                  <td className="num cell-mono">{d.snr > 0 ? `${d.snr.toFixed(1)}` : '—'}</td>
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
          <div className="sf-drawer-section">
            <StatusChip label={selected.status.toUpperCase()} tone={tone(selected.status)} />
          </div>
          <div className="sf-drawer-grid">
            <div className="kpi"><div className="kpi-label">Latency</div><div className="kpi-value" style={{ color: selected.latency > 150 ? 'var(--warn)' : selected.latency === 0 ? 'var(--bad)' : 'var(--ok)' }}>{selected.latency > 0 ? `${selected.latency}ms` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Download</div><div className="kpi-value">{selected.down > 0 ? `${selected.down}M` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Upload</div><div className="kpi-value">{selected.up > 0 ? `${selected.up}M` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">SNR</div><div className="kpi-value">{selected.snr > 0 ? `${selected.snr.toFixed(1)}dB` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Ping Drop</div><div className="kpi-value">{selected.pingDrop}%</div></div>
            <div className="kpi"><div className="kpi-label">Uptime</div><div className="kpi-value">{selected.uptime > 0 ? `${selected.uptime.toFixed(1)}%` : '—'}</div></div>
          </div>
          <div className="sf-drawer-section">
            <h3 style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>10-day uptime trend</h3>
            <svg viewBox="0 0 360 60" style={{ width: '100%', height: 60 }}>
              {selected.spark.map((v, i) => (
                <rect
                  key={i}
                  x={i * 38}
                  y={60 - (v / 100) * 56}
                  width={30}
                  height={(v / 100) * 56}
                  fill={v >= 90 ? 'var(--ok)' : v >= 70 ? 'var(--warn)' : 'var(--bad)'}
                  opacity={.85}
                />
              ))}
            </svg>
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
