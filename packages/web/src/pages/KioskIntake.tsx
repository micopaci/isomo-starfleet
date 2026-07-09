import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Public scan-to-register kiosk reached from a printed QR sticker at
 * /r/:token. No dashboard login — the operator authenticates with a per-intern
 * PIN. Branches: unregistered asset -> Register (bind SN, optional assign);
 * already-registered asset -> Mark Broken / Assign to new user.
 */

const SYMPTOMS = [
  'SSD / Storage Fault',
  'Password Lockout',
  'Screen Crack',
  'Keyboard / Trackpad',
  'Battery / Power',
  'Motherboard',
  'Other',
];

const ASSIGNEE_TYPES = ['student', 'staff', 'pool'] as const;
type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

interface DeviceView {
  id: number;
  serial_number: string;
  hostname: string | null;
  model: string | null;
  manufacturer: string | null;
  os: string | null;
  hardware_status: string;
  profile_number: string | null;
  assignee_email: string | null;
  assignee_type: string | null;
}
interface AssetView {
  asset_number: number;
  registered: boolean;
  device: DeviceView | null;
}
interface RosterHit { name: string; email: string; site_id: number | null }

type Phase = 'loading' | 'invalid' | 'pin' | 'register' | 'registered' | 'done';

const STATUS_LABEL: Record<string, string> = {
  working_in_use: 'Working / In Use',
  intake_broken: 'Broken — In Repair Queue',
  in_repair: 'In Repair',
  ready_for_reissue: 'Ready to Reissue',
  decommissioned: 'Decommissioned',
};
const STATUS_TONE: Record<string, string> = {
  working_in_use: 'var(--ok)',
  intake_broken: 'var(--bad)',
  in_repair: 'var(--warn)',
  ready_for_reissue: 'var(--warn)',
  decommissioned: 'var(--muted)',
};

function newUuid(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export default function KioskIntake() {
  const { token = '' } = useParams();

  const [phase, setPhase] = useState<Phase>('loading');
  const [assetNumber, setAssetNumber] = useState<number | null>(null);
  const [asset, setAsset] = useState<AssetView | null>(null);
  const [operatorName, setOperatorName] = useState<string>(sessionStorage.getItem('kiosk_operator') || '');
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const kioskToken = () => sessionStorage.getItem('kiosk_token');

  // ── Bootstrap: re-hydrate an existing session, or resolve the tag for PIN ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setPhase('invalid'); setError('Missing QR token.'); return; }
      const existing = kioskToken();
      if (existing) {
        const res = await fetch(`/api/kiosk/asset/${encodeURIComponent(token)}`, {
          headers: { Authorization: `Bearer ${existing}` },
        }).catch(() => null);
        if (cancelled) return;
        if (res && res.ok) {
          const data = await res.json();
          applyAsset(data.asset);
          if (data.operator?.name) setOperatorName(data.operator.name);
          return;
        }
        if (res && res.status === 401) {
          sessionStorage.removeItem('kiosk_token'); // expired — fall through to PIN
        } else if (res && res.status === 404) {
          setPhase('invalid'); setError('Unknown QR tag — not part of this fleet.'); return;
        }
      }
      // No/експired session — validate the tag, then prompt for a PIN.
      const res = await fetch(`/api/kiosk/resolve/${encodeURIComponent(token)}`).catch(() => null);
      if (cancelled) return;
      if (!res) { setPhase('invalid'); setError('Network error — check the connection and retry.'); return; }
      if (res.status === 404) { setPhase('invalid'); setError('Unknown QR tag — not part of this fleet.'); return; }
      if (!res.ok) { setPhase('invalid'); setError('Could not read this tag. Try again.'); return; }
      const data = await res.json();
      setAssetNumber(data.asset_number);
      setPhase('pin');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function applyAsset(a: AssetView) {
    setAsset(a);
    setAssetNumber(a.asset_number);
    setPhase(a.registered ? 'registered' : 'register');
  }

  const headerNum = assetNumber != null ? `#${String(assetNumber).padStart(3, '0')}` : '—';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Brand / asset header */}
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div className="sf-brand-mark" aria-hidden="true" style={{ width: 40, height: 40, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>S</div>
          <p className="sf-timecode" style={{ margin: 0 }}>Hardware Intake Kiosk</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 500, margin: '2px 0 0' }}>
            Asset <em>{headerNum}</em>
          </h1>
          {operatorName && phase !== 'pin' && (
            <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 4 }}>
              Operator: {operatorName} · <button onClick={endSession} style={linkBtn}>switch</button>
            </p>
          )}
        </div>

        {phase === 'loading' && <Card><p style={muted}>Reading tag…</p></Card>}

        {phase === 'invalid' && (
          <Card>
            <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 13, textAlign: 'center', margin: 0 }}>{error || 'Invalid tag.'}</p>
          </Card>
        )}

        {phase === 'pin' && (
          <PinGate
            token={token}
            onError={setError}
            error={error}
            onAuthed={(data) => {
              sessionStorage.setItem('kiosk_token', data.kiosk_token);
              sessionStorage.setItem('kiosk_operator', data.operator?.name || '');
              setOperatorName(data.operator?.name || '');
              setError('');
              applyAsset(data.asset);
            }}
          />
        )}

        {phase === 'register' && asset && (
          <RegisterForm token={token} onDone={(msg, a) => finish(msg, a)} onError={setError} error={error} />
        )}

        {phase === 'registered' && asset?.device && (
          <RegisteredActions token={token} device={asset.device} onDone={(msg, a) => finish(msg, a)} onError={setError} error={error} />
        )}

        {phase === 'done' && (
          <Card>
            <p style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontSize: 14, textAlign: 'center', margin: '4px 0 14px' }}>✓ {doneMsg}</p>
            {asset && <DeviceSummary device={asset.device} assetNumber={asset.asset_number} />}
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 14 }}>
              Scan the next laptop's sticker to continue.
            </p>
          </Card>
        )}
      </div>
    </div>
  );

  function finish(msg: string, a: AssetView | null) {
    if (a) setAsset(a);
    setDoneMsg(msg);
    setPhase('done');
  }
  function endSession() {
    sessionStorage.removeItem('kiosk_token');
    sessionStorage.removeItem('kiosk_operator');
    setOperatorName('');
    setError('');
    setPhase('pin');
  }
}

// ── PIN gate ─────────────────────────────────────────────────────────────────
function PinGate({ token, onAuthed, onError, error }: {
  token: string;
  onAuthed: (data: { kiosk_token: string; operator: { name: string }; asset: AssetView }) => void;
  onError: (m: string) => void;
  error: string;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy(true); onError('');
    try {
      const res = await fetch('/api/kiosk/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin: pin.trim() }),
      });
      const data = await res.json();
      if (res.ok) onAuthed(data);
      else onError(data.error || 'Invalid PIN.');
    } catch {
      onError('Network error — try again.');
    } finally {
      setBusy(false); setPin('');
    }
  };

  return (
    <Card>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="sf-field-label" htmlFor="kiosk-pin">Operator PIN</label>
          <input
            id="kiosk-pin"
            className="sf-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="••••"
            value={pin}
            disabled={busy}
            style={{ letterSpacing: '.4em', textAlign: 'center', fontSize: 20 }}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </div>
        {error && <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0, textAlign: 'center' }}>{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || !pin} style={{ width: '100%', justifyContent: 'center', padding: 12 }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </Card>
  );
}

// ── Register (unregistered asset) ────────────────────────────────────────────
function RegisterForm({ token, onDone, onError, error }: {
  token: string;
  onDone: (msg: string, a: AssetView | null) => void;
  onError: (m: string) => void;
  error: string;
}) {
  const [sn, setSn] = useState('');
  const [symptoms, setSymptoms] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [assign, setAssign] = useState(false);
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneeType, setAssigneeType] = useState<AssigneeType>('student');
  const [busy, setBusy] = useState<'' | 'register' | 'broken'>('');
  const uuid = useMemo(newUuid, []);

  const toggle = (s: string) => setSymptoms(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const submit = async (markBroken: boolean) => {
    if (!sn.trim()) return onError('Enter or scan the BIOS serial number.');
    if (markBroken && symptoms.size === 0) return onError('Select at least one symptom to mark broken.');
    setBusy(markBroken ? 'broken' : 'register'); onError('');
    try {
      const res = await fetch('/api/kiosk/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('kiosk_token')}` },
        body: JSON.stringify({
          token,
          serial: sn.trim(),
          mark_broken: markBroken,
          symptoms: Array.from(symptoms),
          notes: notes.trim() || null,
          assignee_email: !markBroken && assign ? assigneeEmail.trim() : null,
          assignee_type: assigneeType,
          client_transaction_uuid: uuid,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onDone(markBroken ? `Registered ${sn.trim()} and sent to repair.` : `Registered ${sn.trim()}${assign && assigneeEmail.trim() ? ` → ${assigneeEmail.trim()}` : ''}.`, data.asset || null);
      } else if (res.status === 401) {
        onError('Session expired — reload and enter your PIN.');
      } else {
        onError(data.error || 'Failed to register.');
      }
    } catch {
      onError('Network error — try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="sf-field-label" htmlFor="kiosk-sn">BIOS Serial Number</label>
          <input id="kiosk-sn" className="sf-input" type="text" autoComplete="off" placeholder="Type or scan SN…"
            value={sn} disabled={!!busy} onChange={e => setSn(e.target.value)} autoFocus />
        </div>

        <div>
          <p className="sf-field-label">Symptom Checklist <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>(required only to mark broken)</span></p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
            {SYMPTOMS.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={symptoms.has(s)} disabled={!!busy} onChange={() => toggle(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>

        <AssignBlock
          enabled={assign} onToggle={setAssign}
          email={assigneeEmail} onEmail={setAssigneeEmail}
          type={assigneeType} onType={setAssigneeType} busy={!!busy}
          label="Assign to a user now (optional)"
        />

        <div>
          <label className="sf-field-label" htmlFor="kiosk-notes">Additional Notes (optional)</label>
          <textarea id="kiosk-notes" className="sf-input sf-textarea" rows={2} placeholder="Any extra context…"
            value={notes} disabled={!!busy} onChange={e => setNotes(e.target.value)} />
        </div>

        {error && <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" style={{ flex: 1, justifyContent: 'center', minWidth: 140, padding: 12 }}
            onClick={() => submit(false)} disabled={!!busy}>
            {busy === 'register' ? 'Registering…' : 'Register'}
          </button>
          <button className="btn" style={{ flex: 1, justifyContent: 'center', minWidth: 140, padding: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }}
            onClick={() => submit(true)} disabled={!!busy}>
            {busy === 'broken' ? 'Saving…' : 'Register as Broken'}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── Registered asset actions (mark broken / reassign) ────────────────────────
function RegisteredActions({ token, device, onDone, onError, error }: {
  token: string;
  device: DeviceView;
  onDone: (msg: string, a: AssetView | null) => void;
  onError: (m: string) => void;
  error: string;
}) {
  const [mode, setMode] = useState<'menu' | 'broken' | 'assign'>('menu');
  const [symptoms, setSymptoms] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneeType, setAssigneeType] = useState<AssigneeType>('student');
  const [busy, setBusy] = useState(false);
  const uuid = useMemo(newUuid, [mode]);

  const toggle = (s: string) => setSymptoms(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const markBroken = async () => {
    if (symptoms.size === 0) return onError('Select at least one symptom.');
    setBusy(true); onError('');
    try {
      const res = await fetch('/api/kiosk/mark-broken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('kiosk_token')}` },
        body: JSON.stringify({ token, symptoms: Array.from(symptoms), notes: notes.trim() || null, client_transaction_uuid: uuid }),
      });
      const data = await res.json();
      if (res.ok) onDone('Sent to the repair queue.', data.asset || null);
      else onError(data.error || 'Failed to update.');
    } catch { onError('Network error — try again.'); } finally { setBusy(false); }
  };

  const assign = async () => {
    if (!assigneeEmail.trim()) return onError('Enter the new user email.');
    setBusy(true); onError('');
    try {
      const res = await fetch('/api/kiosk/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('kiosk_token')}` },
        body: JSON.stringify({ token, assignee_email: assigneeEmail.trim(), assignee_type: assigneeType, notes: notes.trim() || null, client_transaction_uuid: uuid }),
      });
      const data = await res.json();
      if (res.ok) onDone(`Assigned to ${assigneeEmail.trim()}.`, data.asset || null);
      else onError(data.error || 'Failed to assign.');
    } catch { onError('Network error — try again.'); } finally { setBusy(false); }
  };

  return (
    <Card>
      <DeviceSummary device={device} assetNumber={null} />

      {mode === 'menu' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <button className="btn btn--primary" style={{ justifyContent: 'center', padding: 12 }} onClick={() => { onError(''); setMode('assign'); }}>
            Assign to a new user
          </button>
          <button className="btn" style={{ justifyContent: 'center', padding: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => { onError(''); setMode('broken'); }}>
            Mark broken
          </button>
        </div>
      )}

      {mode === 'broken' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <p className="sf-field-label">Symptom Checklist</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
            {SYMPTOMS.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={symptoms.has(s)} disabled={busy} onChange={() => toggle(s)} />
                {s}
              </label>
            ))}
          </div>
          <textarea className="sf-input sf-textarea" rows={2} placeholder="Notes (optional)…" value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} />
          {error && <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: 12 }} onClick={() => { setMode('menu'); onError(''); }} disabled={busy}>Back</button>
            <button className="btn btn--primary" style={{ flex: 1, justifyContent: 'center', padding: 12, borderColor: 'var(--bad)', background: 'var(--bad)' }} onClick={markBroken} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm Broken'}
            </button>
          </div>
        </div>
      )}

      {mode === 'assign' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <AssignBlock enabled onToggle={() => {}} hideToggle
            email={assigneeEmail} onEmail={setAssigneeEmail}
            type={assigneeType} onType={setAssigneeType} busy={busy}
            label="New user" />
          <textarea className="sf-input sf-textarea" rows={2} placeholder="Notes (optional)…" value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} />
          {error && <p style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: 12 }} onClick={() => { setMode('menu'); onError(''); }} disabled={busy}>Back</button>
            <button className="btn btn--primary" style={{ flex: 1, justifyContent: 'center', padding: 12 }} onClick={assign} disabled={busy}>
              {busy ? 'Assigning…' : 'Confirm Assignment'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Assignee picker (roster type-ahead + free-text fallback) ─────────────────
function AssignBlock({ enabled, onToggle, hideToggle, email, onEmail, type, onType, busy, label }: {
  enabled: boolean; onToggle: (v: boolean) => void; hideToggle?: boolean;
  email: string; onEmail: (v: string) => void;
  type: AssigneeType; onType: (v: AssigneeType) => void;
  busy: boolean; label: string;
}) {
  const [hits, setHits] = useState<RosterHit[]>([]);

  const search = async (q: string) => {
    onEmail(q);
    if (q.trim().length < 2) { setHits([]); return; }
    try {
      const res = await fetch(`/api/kiosk/roster?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('kiosk_token')}` },
      });
      if (res.ok) setHits(await res.json());
    } catch { /* offline — free-text still works */ }
  };

  return (
    <div>
      {!hideToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: enabled ? 10 : 0 }}>
          <input type="checkbox" checked={enabled} disabled={busy} onChange={e => onToggle(e.target.checked)} />
          {label}
        </label>
      )}
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {hideToggle && <label className="sf-field-label">{label}</label>}
          <div style={{ position: 'relative' }}>
            <input className="sf-input" type="text" autoComplete="off" placeholder="Search roster or type any email…"
              value={email} disabled={busy} onChange={e => search(e.target.value)} onBlur={() => setTimeout(() => setHits([]), 150)} />
            {hits.length > 0 && (
              <div className="sf-autocomplete">
                {hits.map(h => (
                  <div key={h.email} className="sf-autocomplete-item" onMouseDown={() => { onEmail(h.email); onType('student'); setHits([]); }}>
                    <strong>{h.name}</strong> <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{h.email}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="seg" role="group" aria-label="Assignee type">
            {ASSIGNEE_TYPES.map(t => (
              <button key={t} type="button" className={`seg-btn${type === t ? ' is-active' : ''}`} disabled={busy} onClick={() => onType(t)} style={{ textTransform: 'capitalize' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────
function DeviceSummary({ device, assetNumber }: { device: DeviceView | null; assetNumber: number | null }) {
  if (!device) return null;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{device.profile_number || '—'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: STATUS_TONE[device.hardware_status] || 'var(--muted)' }}>
          {STATUS_LABEL[device.hardware_status] || device.hardware_status}
        </span>
      </div>
      <Row k="Serial" v={device.serial_number} mono />
      {assetNumber != null && <Row k="Asset #" v={String(assetNumber).padStart(3, '0')} mono />}
      {device.model && <Row k="Model" v={device.model} />}
      <Row k="Assigned to" v={device.assignee_email ? `${device.assignee_email}${device.assignee_type ? ` (${device.assignee_type})` : ''}` : 'Unassigned'} />
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span style={{ color: 'var(--ink)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="panel" style={{ padding: 20 }}>{children}</div>;
}
const muted: React.CSSProperties = { color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', margin: 0 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent, var(--warn))', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', padding: 0 };
