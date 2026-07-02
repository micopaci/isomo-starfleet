import { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';

const SEV_FILTERS: { label: string; value: string | 'all' | 'ack' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'Warning', value: 'warning' },
  { label: 'Security', value: 'security' },
  { label: 'Inventory', value: 'inventory' },
  { label: 'Info', value: 'info' },
  { label: 'Acknowledged', value: 'ack' },
];

// 'security' filters on alert category (Defender TVM findings span severities);
// the other filter values match on mapped severity.
function matchesFilter(a: any, filter: string): boolean {
  if (filter === 'security') return a.category === 'security';
  return a.sev === filter;
}

function SevBadge({ sev }: { sev: string }) {
  return <span className={`sf-sev sf-sev--${sev}`}>{sev.toUpperCase()}</span>;
}

// Simple reconcile panel for inventory mismatch alerts
function ReconcilePanel({ alert, onClose, onRefresh }: { alert: any; onClose: () => void; onRefresh: () => void }) {
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleAction = async (action: 'reassign' | 'comment') => {
    const res = await fetch('/api/inventory/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sf_token')}` },
      body: JSON.stringify({
        profile: alert.profile_number,
        action,
        assignee_email: action === 'reassign' ? email : undefined,
        comment: action === 'comment' ? comment : undefined,
        operator_email: 'intern@isomo.tech'
      })
    });
    if (res.ok) {
      setSubmitted(true);
      setTimeout(onRefresh, 1500); // refresh after a short delay
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  };

  if (submitted) {
    return (
      <div className="reconcile-panel">
        <p style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>✓ Resolved. Alert will clear on next telemetry sync.</p>
        <button className="btn btn--sm" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
      </div>
    );
  }

  return (
    <div className="reconcile-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--warn)' }}>⚠ Resolve Mismatch — {alert.profile_number || alert.id}</span>
        <button className="btn btn--sm" onClick={onClose}>Cancel</button>
      </div>
      <div className="reconcile-grid">
        <div className="reconcile-card">
          <h4>Option A — Reassign Custodian</h4>
          <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Assign to a student or staff. Resolves the mismatch and updates status to working_in_use.</p>
          <input
            className="sf-input"
            type="text"
            placeholder="Custodian email (UPN)…"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <button
            className="btn btn--primary"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={() => handleAction('reassign')}
          >
            Confirm Reassignment
          </button>
        </div>
        <div className="reconcile-card">
          <h4>Option B — Log Diagnostic Comment</h4>
          <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Keep status as broken. Log a comment (e.g. bench test, diagnostics in progress).</p>
          <textarea
            className="sf-input sf-textarea"
            rows={3}
            placeholder="Diagnostic notes…"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
          <button
            className="btn"
            style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
            onClick={() => handleAction('comment')}
          >
            Submit Comment
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Alerts() {
  const { alerts, loading, refreshData } = useData();
  const [filter, setFilter] = useState<string | 'all' | 'ack'>('all');
  const [alertList, setAlertList] = useState<any[]>([]);
  const [openReconcile, setOpenReconcile] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[][]>([]);

  useEffect(() => {
    setAlertList(alerts);
  }, [alerts]);

  const filtered = useMemo(() =>
    alertList.filter(a => {
      if (filter === 'ack') return !a.open;
      if (filter === 'all') return true;
      return matchesFilter(a, filter) && a.open;
    }), [alertList, filter]);

  const acknowledge = async (id: string) => {
    setUndoStack(prev => [...prev, [id]]);
    setAlertList(prev => prev.map(a => a.id === id ? { ...a, open: false } : a));
    await fetch(`/api/alerts/${id}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('sf_token')}` } });
    refreshData();
  };

  const clearAll = () => {
    const toClear = alertList.filter(a => a.open).map(a => a.id);
    if (toClear.length === 0) return;
    setUndoStack(prev => [...prev, toClear]);
    setAlertList(prev => prev.map(a => a.open ? { ...a, open: false } : a));
    toClear.forEach(id => {
      fetch(`/api/alerts/${id}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('sf_token')}` } });
    });
    refreshData();
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const lastCleared = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setAlertList(prev => prev.map(a => lastCleared.includes(a.id) ? { ...a, open: true } : a));
    // NOTE: Backend doesn't support un-ack, so this is just local state reverting
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Alerts...
      </div>
    );
  }

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Operational Alerts</p>
          <h1 className="sf-view-title">Alert <em>Feed</em></h1>
          <p className="sf-view-lede">
            {alertList.filter(a => a.sev === 'critical' && a.open).length} critical · {' '}
            {alertList.filter(a => a.sev === 'inventory' && a.open).length} inventory mismatches · {' '}
            {alertList.filter(a => !a.open).length} acknowledged
          </p>
        </div>
      </div>

      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="seg" role="group" aria-label="Filter alerts">
          {SEV_FILTERS.map(f => (
            <button
              key={f.value}
              className={`seg-btn${filter === f.value ? ' is-active' : ''}`}
              onClick={() => setFilter(f.value)}
              id={`filter-alerts-${f.value}`}
            >
              {f.label}
              <span className="seg-count">
                {f.value === 'all' ? alertList.filter(a => a.open).length
                  : f.value === 'ack' ? alertList.filter(a => !a.open).length
                  : alertList.filter(a => matchesFilter(a, f.value) && a.open).length}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {undoStack.length > 0 && (
            <button className="btn" onClick={undo}>
              <i className="ti ti-arrow-back-up" aria-hidden="true" /> Undo
            </button>
          )}
          {alertList.filter(a => a.open).length > 0 && (
            <button className="btn" onClick={clearAll}>
              <i className="ti ti-checks" aria-hidden="true" /> Clear All
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Active Alerts</h2>
          <span className="meta">{filtered.length} shown</span>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No alerts in this category
          </div>
        ) : (
          <>
            {filtered.map(a => (
              <div key={a.id}>
                <div className={`sf-alert${!a.open ? ' is-ack' : ''}`} id={`alert-${a.id}`}>
                  <div>
                    <SevBadge sev={a.sev} />
                    <div className="cell-mono" style={{ marginTop: 4, fontSize: 11 }}>{a.time} · {a.ageDays === 0 ? 'today' : `${a.ageDays}d ago`}</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{a.msg}</div>
                    <div className="flow-meta" style={{ marginTop: 6 }}>
                      <span>{a.meta}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {a.sev === 'inventory' && a.open && (
                      <button
                        className="btn btn--sm btn--accent-outline"
                        onClick={() => setOpenReconcile(openReconcile === a.id ? null : a.id)}
                        id={`btn-reconcile-${a.id}`}
                      >
                        Resolve
                      </button>
                    )}
                    {a.open && (
                      <button
                        className="btn btn--sm"
                        onClick={() => acknowledge(a.id)}
                        id={`btn-ack-${a.id}`}
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
                {a.sev === 'inventory' && openReconcile === a.id && (
                  <ReconcilePanel alert={a} onClose={() => setOpenReconcile(null)} onRefresh={refreshData} />
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
