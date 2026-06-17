import { useState, useMemo } from 'react';
import StatusChip from '../components/StatusChip';
import { useData, type InventoryDevice } from '../context/DataContext';
import { KNOWN_SERIALS, STUDENTS } from '../data/mockData';

export type DeviceStatus = 'working' | 'broken' | 'ready' | 'decommissioned';

type InvFilter = DeviceStatus | 'all';

const SYMPTOMS = [
  'SSD / Storage Fault',
  'Password Lockout',
  'Screen Crack',
  'Keyboard / Trackpad',
  'Battery / Power',
  'Motherboard',
  'Other',
];

function DeviceStatusBadge({ status, mismatch }: { status: DeviceStatus; mismatch: boolean }) {
  const toneMap: Record<DeviceStatus, 'ok' | 'bad' | 'warn' | 'mute'> = {
    working: 'ok', broken: 'bad', ready: 'warn', decommissioned: 'mute',
  };
  const labelMap: Record<DeviceStatus, string> = {
    working: 'WORKING', broken: 'BROKEN', ready: 'READY', decommissioned: 'DECOM.',
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <StatusChip label={labelMap[status]} tone={toneMap[status]} size="sm" />
      {mismatch && (
        <span className="metric-chip metric-chip--bad" aria-label="Mismatch detected">MISMATCH</span>
      )}
    </span>
  );
}

// Inline reconcile panel for a mismatch device
function ReconcilePanel({ device, onClose, onResolved }: {
  device: InventoryDevice;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [emailSuggestions, setEmailSuggestions] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAction = async (action: 'reassign' | 'comment') => {
    if (action === 'reassign' && !email.trim()) return alert('Enter an email.');
    if (action === 'comment' && !comment.trim()) return alert('Enter a comment.');

    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sf_token')}`,
        },
        body: JSON.stringify({
          profile: device.profile,
          action,
          assignee_email: action === 'reassign' ? email.trim() : undefined,
          comment: action === 'comment' ? comment.trim() : undefined,
          operator_email: 'intern@isomo.tech'
        })
      });

      if (res.ok) {
        setDone(true);
        onResolved();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || 'Failed to reconcile'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message || 'Network error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="reconcile-panel">
        <p style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>✓ Resolved. Mismatch cleared.</p>
        <button className="btn btn--sm" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
      </div>
    );
  }

  return (
    <div className="reconcile-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--warn)' }}>
          ⚠ Resolve: {device.profile} Mismatch
          {device.hoursOnline ? ` · +${device.hoursOnline}h online` : ''}
        </span>
        <button className="btn btn--sm" onClick={onClose} disabled={submitting}>Cancel</button>
      </div>
      <div className="reconcile-grid">
        <div className="reconcile-card">
          <h4>Option A — Reassign Custodian</h4>
          <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Assign to a student or staff. Updates status to working_in_use and resolves the alert.</p>
          <div style={{ position: 'relative' }}>
            <input
              className="sf-input"
              type="text"
              placeholder="Custodian email (UPN)…"
              value={email}
              disabled={submitting}
              onChange={e => {
                setEmail(e.target.value);
                const q = e.target.value.toLowerCase();
                emailSuggestions.length > 0 && setEmailSuggestions(q.length > 1 ? STUDENTS.filter(s => s.includes(q)).slice(0, 4) : []);
              }}
              id={`recon-email-${device.profile}`}
            />
            {emailSuggestions.length > 0 && (
              <div className="sf-autocomplete">
                {emailSuggestions.map(s => (
                  <div key={s} className="sf-autocomplete-item" onClick={() => { setEmail(s); setEmailSuggestions([]); }}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn btn--primary"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={() => handleAction('reassign')}
            disabled={submitting}
            id={`recon-reassign-${device.profile}`}
          >
            {submitting ? 'Confirming...' : 'Confirm Reassignment'}
          </button>
        </div>
        <div className="reconcile-card">
          <h4>Option B — Log Diagnostic Comment</h4>
          <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Keep status as {device.status}. Log a comment explaining why the device is online.</p>
          <textarea
            className="sf-input sf-textarea"
            rows={4}
            placeholder="Diagnostic notes or bench explanation…"
            value={comment}
            disabled={submitting}
            onChange={e => setComment(e.target.value)}
            id={`recon-comment-${device.profile}`}
          />
          <button
            className="btn"
            style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
            onClick={() => handleAction('comment')}
            disabled={submitting}
            id={`recon-comment-submit-${device.profile}`}
          >
            {submitting ? 'Submitting...' : 'Submit Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// New Intake Modal
function IntakeModal({ onClose, onIntakeComplete }: {
  onClose: () => void;
  onIntakeComplete: () => void;
}) {
  const [sn, setSn] = useState('');
  const [operator, setOperator] = useState('');
  const [symptoms, setSymptoms] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [snSuggestions, setSnSuggestions] = useState<typeof KNOWN_SERIALS>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleSymptom = (s: string) => {
    setSymptoms(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  };

  const submit = async () => {
    if (!sn.trim()) return alert('Please enter a serial number.');
    if (!operator.trim()) return alert('Please enter the operator name.');
    
    setSubmitting(true);
    try {
      const token = localStorage.getItem('sf_token');
      const res = await fetch('/api/inventory/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serial: sn.trim(),
          symptoms: Array.from(symptoms),
          notes: notes.trim(),
          operator_email: operator.trim(),
        })
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✓ Device registered!\nSerial: ${sn}\nProfile: ${data.profile_number}\nOperator: ${operator}\n\nLabel printed. Apply sticker to laptop.`);
        onIntakeComplete();
        onClose();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || 'Failed to submit intake'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message || 'Network error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="sf-scrim" onClick={onClose} />
      <div className="sf-modal" id="intake-modal" role="dialog" aria-modal="true" aria-labelledby="intake-modal-title">
        <div className="sf-modal-head">
          <div>
            <p className="sf-timecode">Hardware Intake Kiosk</p>
            <h2 className="sf-modal-title" id="intake-modal-title">Register Device</h2>
          </div>
          <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close intake modal" disabled={submitting}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="sf-modal-body">
          {/* SN field */}
          <div>
            <label className="sf-field-label" htmlFor="intake-sn">BIOS Serial Number</label>
            <input
              id="intake-sn"
              className="sf-input"
              type="text"
              placeholder="Type or scan SN (e.g. SN-A9283F)…"
              value={sn}
              disabled={submitting}
              autoComplete="off"
              onChange={e => {
                setSn(e.target.value);
                const q = e.target.value.toLowerCase();
                setSnSuggestions(q.length > 1 ? KNOWN_SERIALS.filter(k => k.serial.toLowerCase().includes(q)) : []);
              }}
            />
            {snSuggestions.length > 0 && (
              <div className="sf-autocomplete">
                {snSuggestions.map(k => (
                  <div key={k.serial} className="sf-autocomplete-item" onClick={() => { setSn(k.serial); setSnSuggestions([]); }}>
                    <strong>{k.serial}</strong>{' '}
                    <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{k.model} · {k.profile}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Symptoms */}
          <div>
            <p className="sf-field-label">Symptom Checklist</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {SYMPTOMS.map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={symptoms.has(s)}
                    disabled={submitting}
                    onChange={() => toggleSymptom(s)}
                    id={`symptom-${s.replace(/\s+/g, '-')}`}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="sf-field-label" htmlFor="intake-notes">Additional Notes (optional)</label>
            <textarea
              id="intake-notes"
              className="sf-input sf-textarea"
              rows={2}
              placeholder="Any extra context about the fault…"
              value={notes}
              disabled={submitting}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
          {/* Operator — this comes AFTER the device fields per user rule */}
          <div>
            <label className="sf-field-label" htmlFor="intake-operator">Data Entry Person</label>
            <input
              id="intake-operator"
              className="sf-input"
              type="text"
              placeholder="Your name (e.g. Eric)…"
              value={operator}
              disabled={submitting}
              onChange={e => setOperator(e.target.value)}
            />
          </div>
        </div>
        <div className="sf-modal-foot">
          <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="btn"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
            onClick={submit}
            disabled={submitting}
            id="btn-intake-print"
          >
            <i className="ti ti-tag" aria-hidden="true" /> {submitting ? 'Registering...' : 'Register & Print Label'}
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={submitting} id="btn-intake-broken">
            <i className="ti ti-alert-circle" aria-hidden="true" /> {submitting ? 'Registering...' : 'Mark Broken'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function Inventory() {
  const { inventory: devices, loading, refreshData } = useData();
  const [filter, setFilter] = useState<InvFilter>('all');
  const [search, setSearch] = useState('');
  const [openReconcile, setOpenReconcile] = useState<string | null>(null);
  const [showIntake, setShowIntake] = useState(false);

  const filtered = useMemo(() =>
    devices.filter(d => {
      const matchFilter = filter === 'all' || d.status === filter;
      const q = search.toLowerCase();
      const matchSearch = !q || d.profile.toLowerCase().includes(q) || d.serial.toLowerCase().includes(q) || d.model.toLowerCase().includes(q) || d.assignee.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    }), [devices, filter, search]);

  const mismatches = devices.filter(d => d.mismatch);
  const counts = {
    working: devices.filter(d => d.status === 'working').length,
    broken: devices.filter(d => d.status === 'broken').length,
    ready: devices.filter(d => d.status === 'ready').length,
    decom: devices.filter(d => d.status === 'decommissioned').length,
  };

  const handleResolved = () => {
    refreshData();
    setOpenReconcile(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Inventory...
      </div>
    );
  }

  return (
    <div className="sf-view">
      {/* Header */}
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Hardware Lifecycle Management</p>
          <h1 className="sf-view-title">Device <em>Inventory</em></h1>
          <p className="sf-view-lede">Track every laptop through intake, repair queue, reissue, and active assignment. All changes are logged with the operator's name and timestamp.</p>
        </div>
        <div className="sf-view-actions">
          <button
            className="btn btn--primary"
            onClick={() => setShowIntake(true)}
            id="btn-new-intake"
          >
            <i className="ti ti-plus" aria-hidden="true" /> New Intake
          </button>
          <button className="btn" id="btn-export-inventory">
            <i className="ti ti-download" aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="kpi-strip" style={{ '--kpi-cols': '5' } as React.CSSProperties} aria-label="Inventory metrics">
        <div className="kpi"><div className="kpi-label">Total Devices</div><div className="kpi-value">{devices.length}</div><div className="kpi-sub">across all sites</div></div>
        <div className="kpi"><div className="kpi-label">Working / In Use</div><div className="kpi-value" style={{ color: 'var(--ok)' }}>{counts.working}</div><div className="kpi-sub">actively assigned</div></div>
        <div className="kpi"><div className="kpi-label">Intake / Broken</div><div className="kpi-value" style={{ color: 'var(--bad)' }}>{counts.broken}</div><div className="kpi-sub">in repair queue</div></div>
        <div className="kpi"><div className="kpi-label">Ready to Reissue</div><div className="kpi-value" style={{ color: 'var(--warn)' }}>{counts.ready}</div><div className="kpi-sub">repaired, unassigned</div></div>
        <div className="kpi"><div className="kpi-label">Mismatch Alerts</div><div className="kpi-value" style={{ color: mismatches.length > 0 ? 'var(--bad)' : 'var(--ok)' }}>{mismatches.length}</div><div className="kpi-sub">online while broken</div></div>
      </div>

      {/* Mismatch banner */}
      {mismatches.length > 0 && (
        <div className="mismatch-banner" id="inv-mismatch-banner" role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} aria-hidden="true" />
            <div>
              <strong>{mismatches.length} inventory mismatch{mismatches.length > 1 ? 'es' : ''} detected.</strong>
              <span style={{ marginLeft: 8, color: 'inherit', opacity: .75 }}>Devices marked as broken are heartbeating online.</span>
            </div>
          </div>
          <button className="btn btn--sm btn--danger-outline" onClick={() => document.getElementById('inv-mismatch-section')?.scrollIntoView({ behavior: 'smooth' })}>
            View mismatches <i className="ti ti-arrow-down" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by device status">
          {([['all', 'All'], ['working', 'Working'], ['broken', 'Broken'], ['ready', 'Ready'], ['decommissioned', 'Decommissioned']] as [InvFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              className={`seg-btn${filter === val ? ' is-active' : ''}`}
              onClick={() => setFilter(val)}
              id={`inv-filter-${val}`}
            >
              {label}
              <span className="seg-count">
                {val === 'all' ? devices.length
                  : val === 'decommissioned' ? counts.decom
                  : devices.filter(d => d.status === val).length}
              </span>
            </button>
          ))}
        </div>
        <div className="search" style={{ marginLeft: 'auto', width: 260 }}>
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search LAP-XXX or serial…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            id="inv-search"
            aria-label="Search inventory"
          />
        </div>
      </div>

      {/* Device Table */}
      <div className="panel">
        <div className="panel-head">
          <h2>Device Registry</h2>
          <span className="meta">{filtered.length} of {devices.length} shown</span>
        </div>
        <div className="table-scroll">
          <table className="tbl" aria-label="Device inventory">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Profile #</th>
                <th style={{ width: 140 }}>Serial (BIOS)</th>
                <th>Model</th>
                <th style={{ width: 160 }}>Status</th>
                <th>Assignee</th>
                <th style={{ width: 120 }}>Last Intake</th>
                <th style={{ width: 110 }}>Operator</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.profile + d.serial} aria-label={`${d.profile} — ${d.status}`}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', fontSize: 12 }}>{d.profile}</span>
                  </td>
                  <td>
                    <span className="cell-mono" style={{ fontSize: 11 }}>{d.serial}</span>
                  </td>
                  <td>{d.model}</td>
                  <td><DeviceStatusBadge status={d.status} mismatch={d.mismatch} /></td>
                  <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{d.assignee}</td>
                  <td><span className="cell-mono" style={{ fontSize: 11 }}>{d.lastIntake}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{d.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mismatch Resolution Section */}
      {mismatches.length > 0 && (
        <div className="panel" id="inv-mismatch-section">
          <div className="panel-head">
            <h2>
              Open Discrepancies
              <span style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, marginLeft: 8 }}>
                {mismatches.length} escalated
              </span>
            </h2>
            <span className="meta">Devices heartbeating online while marked broken/decommissioned</span>
          </div>
          <div className="flow-list">
            {mismatches.map(d => (
              <div key={d.profile}>
                <div className="flow-row" id={`mismatch-${d.profile}`}>
                  <div className="content">
                    <div className="flow-title-row">
                      <StatusChip label="MISMATCH" tone="bad" size="sm" />
                      <span className="row-title">{d.profile}</span>
                      <span className="row-sub">{d.serial} · {d.model}</span>
                      {d.hoursOnline && (
                        <span className="metric-chip metric-chip--bad">+{d.hoursOnline}h online</span>
                      )}
                    </div>
                    <div className="flow-copy" style={{ marginTop: 6 }}>
                      Device heartbeated online but is marked <strong>{d.status}</strong> in inventory. Last operator:{' '}
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{d.operator}</span> · {d.lastIntake}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => setOpenReconcile(openReconcile === d.profile ? null : d.profile)}
                      id={`btn-resolve-${d.profile}`}
                    >
                      {openReconcile === d.profile ? 'Cancel' : 'Resolve'}
                    </button>
                  </div>
                </div>
                {openReconcile === d.profile && (
                  <ReconcilePanel
                    device={d}
                    onClose={() => setOpenReconcile(null)}
                    onResolved={handleResolved}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intake Modal */}
      {showIntake && (
        <IntakeModal
          onClose={() => setShowIntake(false)}
          onIntakeComplete={refreshData}
        />
      )}
    </div>
  );
}
