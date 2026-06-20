import { useState } from 'react';
import { useData, type Dish } from '../context/DataContext';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isoDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

export default function Decommissioned() {
  const { inactiveDishes, loading, refreshData } = useData();
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (d: Dish) => {
    setEditing(d.serviceLineId);
    setReason(d.decommissionReason || '');
    setDate(isoDay(d.decommissionedAt) || new Date().toISOString().split('T')[0]);
  };

  const save = async (serviceLineId: string | null) => {
    if (!serviceLineId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/starlink-terminals/${encodeURIComponent(serviceLineId)}/decommission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sf_token')}` },
        body: JSON.stringify({ reason: reason.trim(), decommissioned_at: date }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(`Save failed: ${e.error || res.status}`);
        return;
      }
      setEditing(null);
      await refreshData();
    } catch (err: any) {
      alert(`Save failed: ${err?.message || 'network error'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Decommissioned Terminals...
      </div>
    );
  }

  const recorded = inactiveDishes.filter(d => d.decommissionedAt).length;

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Retired Infrastructure</p>
          <h1 className="sf-view-title">Decommissioned <em>Starlinks</em></h1>
          <p className="sf-view-lede">
            {inactiveDishes.length} suspended / retired service line{inactiveDishes.length === 1 ? '' : 's'}, excluded from fleet reports.
            {' '}{recorded} have a recorded decommission date.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Decommission Log</h2>
          <span className="meta">{inactiveDishes.length} terminals</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Decommissioned Starlink terminals">
            <thead>
              <tr>
                <th>Terminal</th>
                <th>Service line</th>
                <th>Decommissioned</th>
                <th>Reason</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {inactiveDishes.length === 0 ? (
                <tr><td colSpan={5} className="cell-mono" style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px 0' }}>No decommissioned terminals.</td></tr>
              ) : inactiveDishes.map(d => (
                editing === d.serviceLineId ? (
                  <tr key={d.serviceLineId || d.serial}>
                    <td className="cell-primary">{d.name}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{d.serviceLineId || '—'}</td>
                    <td>
                      <input type="date" className="sf-input" value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} />
                    </td>
                    <td>
                      <input type="text" className="sf-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. dish dead / replaced" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn--primary btn--sm" disabled={saving} onClick={() => save(d.serviceLineId)}>{saving ? '…' : 'Save'}</button>
                        <button className="btn btn--sm" disabled={saving} onClick={() => setEditing(null)}>×</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.serviceLineId || d.serial}>
                    <td className="cell-primary">{d.name}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{d.serviceLineId || '—'}</td>
                    <td className="cell-mono" style={{ fontSize: 12, color: d.decommissionedAt ? 'var(--ink)' : 'var(--muted)' }}>{fmtDate(d.decommissionedAt)}</td>
                    <td style={{ fontSize: 12, color: d.decommissionReason ? 'var(--ink-2)' : 'var(--muted)' }}>{d.decommissionReason || '—'}</td>
                    <td>
                      <button className="btn btn--sm" onClick={() => startEdit(d)}>Edit</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
