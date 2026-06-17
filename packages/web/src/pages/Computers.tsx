import { useState, useMemo, useEffect } from 'react';
import StatusChip from '../components/StatusChip';
import Drawer from '../components/Drawer';

const STATUS_FILTERS = ['all', 'healthy', 'critical', 'offline', 'update-due', 'low-storage'] as const;
type DevFilter = typeof STATUS_FILTERS[number];

export default function Computers() {
  const [filter, setFilter] = useState<DevFilter>('all');
  const [search, setSearch] = useState('');
  const [computerList, setComputerList] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<string>('healthy');

  const [showIntake, setShowIntake] = useState(false);
  const [intakeSerial, setIntakeSerial] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');

  const fetchInventory = () => {
    const token = localStorage.getItem('sf_token');
    if (!token) { setLoading(false); return; }
    fetch('/api/devices', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setComputerList(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('sf_token');
    const res = await fetch('/api/inventory/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serial: intakeSerial, notes: intakeNotes, operator_email: 'intern@isomo.tech' })
    });
    if (res.ok) {
      setShowIntake(false);
      setIntakeSerial('');
      setIntakeNotes('');
      fetchInventory();
    } else {
      const { error } = await res.json();
      alert(`Error: ${error}`);
    }
  };

  const filtered = useMemo(() =>
    computerList.filter(c => {
      const mappedStatus = c.hardware_status === 'working_in_use' ? 'healthy' : c.hardware_status;
      const matchFilter = filter === 'all' || mappedStatus === filter;
      const q = search.toLowerCase();
      const matchSearch = !q || (c.profile_number || '').toLowerCase().includes(q) || (c.user_principal_name || '').toLowerCase().includes(q) || (c.model || '').toLowerCase().includes(q) || (c.hostname || '').toLowerCase().includes(q) || (c.windows_sn || '').toLowerCase().includes(q);
      return matchFilter && matchSearch;
    }), [filter, search, computerList]);

  const handleSelect = (c: any) => {
    setSelected(c);
    setEditEmail(c.user_principal_name || '');
    setEditStatus(c.hardware_status === 'working_in_use' ? 'healthy' : c.hardware_status);
  };

  const handleSave = async () => {
    if (!selected) return;
    // In a full implementation, we'd fire an update API call here
    // For now we just update locally to simulate success
    setComputerList(prev => prev.map(c => c.id === selected.id ? { ...c, assignee_email: editEmail, hardware_status: editStatus } : c));
    setSelected(null);
  };

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Endpoint Telemetry</p>
          <h1 className="sf-view-title">Computer <em>Fleet</em></h1>
          <p className="sf-view-lede">
            {computerList.filter(c => c.hardware_status === 'working_in_use').length} healthy · {' '}
            {computerList.filter(c => c.hardware_status === 'intake_broken' || c.hardware_status === 'in_repair').length} in repair
          </p>
        </div>
        <div className="sf-view-actions">
          <button className="btn btn--primary" onClick={() => setShowIntake(true)}>
            <i className="ti ti-plus" /> Log New Intake
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by device status">
          {(['all', 'healthy', 'intake_broken', 'in_repair', 'decommissioned']).map(f => (
            <button
              key={f}
              className={`seg-btn${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f as any)}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="search" style={{ marginLeft: 'auto', width: 240 }}>
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            placeholder="Tag, email or serial…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Device Registry</h2>
          <span className="meta">{loading ? 'Loading...' : `${filtered.length} shown`}</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Computer fleet">
            <thead>
              <tr>
                <th>Name</th>
                <th>Profile</th>
                <th>Serial</th>
                <th>Assignee</th>
                <th>Model</th>
                <th>OS</th>
                <th>Status</th>
                <th>Connection</th>
                <th className="num">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={() => handleSelect(c)}>
                  <td className="cell-primary" style={{ fontSize: 12 }}>{c.hostname || '—'}</td>
                  <td className="cell-mono" style={{ fontSize: 12 }}>{c.profile_number || '—'}</td>
                  <td className="cell-mono">{c.windows_sn || '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.user_principal_name || '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.model || '—'}</td>
                  <td className="cell-mono">{c.os_version || c.os || '—'}</td>
                  <td><StatusChip label={(c.hardware_status || 'unknown').toUpperCase().replace(/_/g, ' ')} tone={c.hardware_status === 'working_in_use' ? 'ok' : c.hardware_status === 'decommissioned' ? 'mute' : 'bad'} size="sm" /></td>
                  <td><StatusChip label={(c.status || 'unknown').toUpperCase()} tone={c.status === 'online' ? 'ok' : c.status === 'stale' ? 'warn' : c.status === 'offline' ? 'bad' : 'mute'} size="sm" /></td>
                  <td className="num cell-mono">{c.last_seen ? new Date(c.last_seen).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showIntake && (
        <div className="sf-scrim">
          <div className="sf-modal" role="dialog" aria-modal="true" style={{ width: 440 }}>
            <form onSubmit={handleIntakeSubmit}>
              <div className="sf-modal-head">
                <h2 className="sf-modal-title">Hardware Intake</h2>
                <button type="button" className="btn btn--icon btn--sm" onClick={() => setShowIntake(false)}><i className="ti ti-x" /></button>
              </div>
              <div className="sf-modal-body">
                <div>
                  <label className="sf-field-label">Serial Number</label>
                  <input required type="text" className="sf-input" value={intakeSerial} onChange={e => setIntakeSerial(e.target.value)} placeholder="e.g. PF12345" />
                </div>
                <div>
                  <label className="sf-field-label">Diagnostic Notes</label>
                  <textarea className="sf-input sf-textarea" rows={3} value={intakeNotes} onChange={e => setIntakeNotes(e.target.value)} placeholder="What's wrong with it?" />
                </div>
              </div>
              <div className="sf-modal-foot">
                <button type="button" className="btn" onClick={() => setShowIntake(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary">Log Intake (Mark Broken)</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <Drawer onClose={() => setSelected(null)}>
          <div className="sf-drawer-head">
            <div>
              <p className="sf-timecode">Device Profile</p>
              <div className="sf-drawer-title">{selected.hostname || selected.profile_number || selected.windows_sn || '—'}</div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 3 }}>
                <input 
                  type="email" 
                  value={editEmail} 
                  onChange={e => setEditEmail(e.target.value)} 
                  className="sf-input" 
                  style={{ padding: '4px 8px', fontSize: 13, marginTop: 8 }} 
                  placeholder="Assignee email"
                />
              </p>
            </div>
            <button className="btn btn--icon btn--sm" onClick={() => setSelected(null)} aria-label="Close"><i className="ti ti-x" /></button>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label className="sf-field-label">Hardware Status</label>
            <select 
              value={editStatus} 
              onChange={e => setEditStatus(e.target.value)} 
              className="sf-input"
            >
              <option value="working_in_use">Working (In Use)</option>
              <option value="intake_broken">Broken (Intake)</option>
              <option value="in_repair">In Repair</option>
              <option value="decommissioned">Decommissioned</option>
            </select>
          </div>

          <div className="sf-drawer-grid">
            <div className="kpi"><div className="kpi-label">Model</div><div className="kpi-value" style={{ fontSize: 14 }}>{selected.model || '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Serial</div><div className="kpi-value" style={{ fontSize: 14 }}>{selected.windows_sn || '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Last Seen</div><div className="kpi-value" style={{ fontSize: 14 }}>{selected.last_seen ? new Date(selected.last_seen).toLocaleDateString() : '—'}</div></div>
          </div>
          <div className="sf-drawer-foot" style={{ flexDirection: 'column', gap: 12 }}>
            <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleSave}>Save Changes</button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
