import { useState, useEffect, useCallback } from 'react';

interface Terminal {
  service_line_id: string;
  nickname: string | null;
  site_name: string | null;
  current_status: string;
  decommissioned_at: string | null;
  decommission_reason: string | null;
  latest_usage: { log_date: string; consumed_gb: number | null } | null;
}

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

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sf_token')}` });

export default function Decommissioned() {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/starlink-terminals?days=45', { headers: authHeaders() });
      const json = await res.json();
      const all: Terminal[] = Array.isArray(json?.terminals) ? json.terminals : [];
      // Decommissioned view is keyed strictly off the decommission date so it
      // never overlaps the Starlinks "Inactive" tab (which shows suspended-but-
      // not-decommissioned lines). Decommission a dish to move it here.
      setTerminals(all.filter(t => t.decommissioned_at));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (t: Terminal) => {
    setEditing(t.service_line_id);
    setReason(t.decommission_reason || '');
    setDate(isoDay(t.decommissioned_at) || new Date().toISOString().split('T')[0]);
  };

  const save = async (serviceLineId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/starlink-terminals/${encodeURIComponent(serviceLineId)}/decommission`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason: reason.trim(), decommissioned_at: date }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(`Save failed: ${e.error || res.status}`); return; }
      setEditing(null);
      await load();
    } catch (err: any) {
      alert(`Save failed: ${err?.message || 'network error'}`);
    } finally {
      setSaving(false);
    }
  };

  const restore = async (serviceLineId: string) => {
    if (!confirm('Restore this terminal to active (clear decommission)?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/starlink-terminals/${encodeURIComponent(serviceLineId)}/decommission`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ clear: true }),
      });
      if (!res.ok) { alert(`Restore failed: ${res.status}`); return; }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const decommissionStale = async () => {
    setBulkBusy(true);
    try {
      const dry = await fetch('/api/starlink-terminals/decommission-stale', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ weeks: 3, dryRun: true }),
      });
      if (!dry.ok) { alert(`Failed: ${dry.status}`); return; }
      const preview = await dry.json();
      if (!preview.count) { alert('No terminals have had zero data usage for 3+ weeks.'); return; }
      const names = preview.terminals.slice(0, 12).map((t: any) => `• ${t.nickname || t.service_line_id} (last data ${fmtDate(t.last_usage_date)})`).join('\n');
      const more = preview.count > 12 ? `\n…and ${preview.count - 12} more` : '';
      if (!confirm(`Decommission ${preview.count} terminal(s) with no data usage for 3+ weeks?\n\n${names}${more}`)) return;
      const apply = await fetch('/api/starlink-terminals/decommission-stale', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ weeks: 3 }),
      });
      if (!apply.ok) { alert(`Failed: ${apply.status}`); return; }
      const result = await apply.json();
      alert(`Decommissioned ${result.decommissioned} terminal(s).`);
      await load();
    } catch (err: any) {
      alert(`Failed: ${err?.message || 'network error'}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const restoreWronglyFlagged = async () => {
    setBulkBusy(true);
    try {
      const res = await fetch('/api/starlink-terminals/restore-active', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ weeks: 3 }),
      });
      if (!res.ok) { alert(`Failed: ${res.status}`); return; }
      const result = await res.json();
      alert(result.restored ? `Restored ${result.restored} terminal(s) that had recent data usage.` : 'No auto-decommissioned terminals had recent usage.');
      await load();
    } catch (err: any) {
      alert(`Failed: ${err?.message || 'network error'}`);
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Decommissioned Terminals...
      </div>
    );
  }

  const recorded = terminals.filter(t => t.decommissioned_at).length;

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Retired Infrastructure</p>
          <h1 className="sf-view-title">Decommissioned <em>Starlinks</em></h1>
          <p className="sf-view-lede">
            {terminals.length} suspended / retired service line{terminals.length === 1 ? '' : 's'}, excluded from fleet reports.
            {' '}{recorded} have a recorded decommission date.
          </p>
        </div>
        <div className="sf-view-actions">
          <button className="btn" onClick={restoreWronglyFlagged} disabled={bulkBusy} id="btn-restore-active">
            <i className="ti ti-restore" aria-hidden="true" /> Restore active (recent data)
          </button>
          <button className="btn btn--danger-outline" onClick={decommissionStale} disabled={bulkBusy} id="btn-decommission-stale">
            <i className="ti ti-circle-off" aria-hidden="true" /> {bulkBusy ? 'Working…' : 'Decommission no-data 3+ weeks'}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Decommission Log</h2>
          <span className="meta">{terminals.length} terminals</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Decommissioned Starlink terminals">
            <thead>
              <tr>
                <th>Terminal</th>
                <th>Service line</th>
                <th>Last data</th>
                <th>Decommissioned</th>
                <th>Reason</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {terminals.length === 0 ? (
                <tr><td colSpan={6} className="cell-mono" style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px 0' }}>No decommissioned terminals.</td></tr>
              ) : terminals.map(t => (
                editing === t.service_line_id ? (
                  <tr key={t.service_line_id}>
                    <td className="cell-primary">{t.nickname || t.site_name || t.service_line_id}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{t.service_line_id}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{fmtDate(t.latest_usage?.log_date || null)}</td>
                    <td><input type="date" className="sf-input" value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} /></td>
                    <td><input type="text" className="sf-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. dish dead / replaced" style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn--primary btn--sm" disabled={saving} onClick={() => save(t.service_line_id)}>{saving ? '…' : 'Save'}</button>
                        <button className="btn btn--sm" disabled={saving} onClick={() => setEditing(null)}>×</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.service_line_id}>
                    <td className="cell-primary">{t.nickname || t.site_name || t.service_line_id}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{t.service_line_id}</td>
                    <td className="cell-mono" style={{ fontSize: 11, color: t.latest_usage?.log_date ? 'var(--ink-2)' : 'var(--muted)' }}>{fmtDate(t.latest_usage?.log_date || null)}</td>
                    <td className="cell-mono" style={{ fontSize: 12, color: t.decommissioned_at ? 'var(--ink)' : 'var(--muted)' }}>{fmtDate(t.decommissioned_at)}</td>
                    <td style={{ fontSize: 12, color: t.decommission_reason ? 'var(--ink-2)' : 'var(--muted)' }}>{t.decommission_reason || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn--sm" onClick={() => startEdit(t)}>Edit</button>
                        <button className="btn btn--sm" onClick={() => restore(t.service_line_id)}>Restore</button>
                      </div>
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
