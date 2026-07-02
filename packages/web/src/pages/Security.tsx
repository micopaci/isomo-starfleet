import { useEffect, useMemo, useState } from 'react';
import StatCard from '../components/StatCard';
import StatusChip from '../components/StatusChip';
import Drawer from '../components/Drawer';

// Mirrors packages/shared/src/types.ts (VulnerabilitySummary / VulnerabilityDevice /
// SecuritySummary / AiGuidance) — the web app defines its API shapes locally, same
// as DataContext.tsx.
interface AiGuidance {
  summary: string;
  risk_plain_english: string;
  mitigation_steps: string[];
  starfleet_action: 'update_chrome' | 'update_windows' | 'manual' | 'none_available';
  urgency: 'immediate' | 'this_week' | 'monitor';
  caveats: string;
}

interface Vulnerability {
  id: string;
  name: string | null;
  severity: string;
  cvss_v3: number | null;
  is_zero_day: boolean;
  ai_guidance: AiGuidance | null;
  ai_guidance_at: string | null;
  exposed_count: number;
  product_name: string | null;
  product_vendor: string | null;
  fixing_kb_id: string | null;
  has_fix: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

interface VulnDevice {
  id: number;
  hostname: string | null;
  windows_sn: string | null;
  os: string | null;
  os_version: string | null;
  site_name: string | null;
  product_version: string | null;
  status: 'active' | 'resolved';
  can_remediate: boolean;
}

interface SecuritySummary {
  critical: number;
  warning: number;
  info: number;
  zero_days: number;
  exposed_devices: number;
  last_synced_at: string | null;
}

type RemediationType = 'update_chrome' | 'update_windows';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('sf_token')}` };
}

function sevTone(v: Vulnerability): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (v.is_zero_day || /critical/i.test(v.severity)) return 'bad';
  if (/high/i.test(v.severity)) return 'warn';
  if (/medium/i.test(v.severity)) return 'info';
  return 'mute';
}

// The extension point for future remediation actions: which Starfleet trigger
// (if any) fixes this vulnerability. Zero-days with no fix get no action.
function remediationForVulnerability(v: Vulnerability): { type: RemediationType; label: string } | null {
  if (!v.has_fix) return null;
  const product = (v.product_name || '').toLowerCase();
  if (product.includes('chrome')) return { type: 'update_chrome', label: 'Update Chrome' };
  if (product.includes('windows') || v.fixing_kb_id) return { type: 'update_windows', label: 'Run Windows Update' };
  return null;
}

function fixLabel(v: Vulnerability): { text: string; muted: boolean } {
  if (!v.has_fix) return { text: 'No patch available', muted: true };
  if (v.fixing_kb_id) return { text: v.fixing_kb_id, muted: false };
  return { text: 'Update available', muted: false };
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

const URGENCY_TONE: Record<AiGuidance['urgency'], 'bad' | 'warn' | 'info'> = {
  immediate: 'bad',
  this_week: 'warn',
  monitor: 'info',
};

function GuidancePanel({ vuln, onRegenerated }: { vuln: Vulnerability; onRegenerated: (g: AiGuidance) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const g = vuln.ai_guidance;

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/security/vulnerabilities/${encodeURIComponent(vuln.id)}/guidance`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onRegenerated(json.ai_guidance);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          <i className="ti ti-sparkles" aria-hidden="true" /> AI mitigation guidance
        </span>
        <button className="btn btn--sm" onClick={regenerate} disabled={busy} id={`btn-regenerate-${vuln.id}`}>
          {busy ? 'Generating…' : g ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</p>}
      {!g && !error && (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          No guidance generated yet{busy ? '' : ' — it is filled in automatically after each sync when the AI key is configured'}.
        </p>
      )}
      {g && (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <StatusChip label={g.urgency.replace('_', ' ').toUpperCase()} tone={URGENCY_TONE[g.urgency]} size="sm" />
            <strong>{g.summary}</strong>
          </div>
          <p style={{ margin: '6px 0', color: 'var(--ink-2)' }}>{g.risk_plain_english}</p>
          {g.mitigation_steps.length > 0 && (
            <ol style={{ margin: '6px 0 6px 18px', padding: 0 }}>
              {g.mitigation_steps.map((step, i) => <li key={i} style={{ marginBottom: 4 }}>{step}</li>)}
            </ol>
          )}
          {g.caveats && <p style={{ margin: '6px 0', fontSize: 12, color: 'var(--ink-3)' }}>{g.caveats}</p>}
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            AI-generated — verify before acting.{vuln.ai_guidance_at ? ` Generated ${fmtRelative(vuln.ai_guidance_at)}.` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

export default function Security() {
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Vulnerability | null>(null);
  const [devices, setDevices] = useState<VulnDevice[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [triggerState, setTriggerState] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = async () => {
    try {
      const headers = authHeaders();
      const [vRes, sRes] = await Promise.all([
        fetch('/api/security/vulnerabilities', { headers }),
        fetch('/api/security/summary', { headers }),
      ]);
      if (vRes.ok) setVulns(await vRes.json());
      if (sRes.ok) setSummary(await sRes.json());
    } catch (err) {
      console.error('Failed to load security data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Lazy-load affected devices when a row is opened.
  useEffect(() => {
    if (!selected) { setDevices(null); setConfirming(false); setTriggerState(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/security/vulnerabilities/${encodeURIComponent(selected.id)}/devices`, { headers: authHeaders() });
        const json = await res.json();
        if (!cancelled && Array.isArray(json)) setDevices(json);
      } catch (err) {
        console.error('Failed to load affected devices:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const zeroDays = useMemo(() => vulns.filter(v => v.is_zero_day).length, [vulns]);

  const runRemediation = async (v: Vulnerability, action: { type: RemediationType; label: string }) => {
    setTriggerState(null);
    try {
      const res = await fetch('/api/trigger/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ type: action.type, vulnerability_id: v.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTriggerState({ ok: true, msg: `Triggered ${action.label} on ${json.count} device(s).` });
    } catch (err: any) {
      setTriggerState({ ok: false, msg: err.message });
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Security Posture...
      </div>
    );
  }

  const selectedAction = selected ? remediationForVulnerability(selected) : null;
  const activeDevices = (devices || []).filter(d => d.status === 'active');

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Defender for Endpoint</p>
          <h1 className="sf-view-title">Security <em>Vulnerabilities</em></h1>
          <p className="sf-view-lede">
            {vulns.length} exposed vulnerabilit{vulns.length === 1 ? 'y' : 'ies'} across the managed fleet
            {summary?.last_synced_at ? ` · last synced ${fmtRelative(summary.last_synced_at)}` : ''}.
          </p>
        </div>
      </div>

      <div className="kpi-strip" style={{ '--kpi-cols': '4' } as React.CSSProperties} aria-label="Security key metrics">
        <StatCard label="Critical" value={summary?.critical ?? 0} sub="incl. zero-days" tone={(summary?.critical ?? 0) > 0 ? 'bad' : 'ok'} />
        <StatCard label="Zero-days" value={summary?.zero_days ?? zeroDays} sub="no CVE assigned yet" tone={(summary?.zero_days ?? 0) > 0 ? 'warn' : 'ok'} />
        <StatCard label="High" value={summary?.warning ?? 0} sub="warning severity" tone={(summary?.warning ?? 0) > 0 ? 'warn' : 'ok'} />
        <StatCard label="Exposed Devices" value={summary?.exposed_devices ?? 0} sub="with active findings" tone={(summary?.exposed_devices ?? 0) > 0 ? 'warn' : 'ok'} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Vulnerability Feed</h2>
          <span className="meta">{vulns.length} shown</span>
        </div>
        {vulns.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No exposed vulnerabilities — either the fleet is clean or the Defender TVM sync has not run yet.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="tbl" aria-label="Vulnerabilities">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Vulnerability</th>
                  <th>Product</th>
                  <th className="num">CVSS</th>
                  <th className="num">Exposed</th>
                  <th>Fix</th>
                  <th>First Seen</th>
                </tr>
              </thead>
              <tbody>
                {vulns.map(v => {
                  const fix = fixLabel(v);
                  return (
                    <tr key={v.id} onClick={() => setSelected(v)} style={{ cursor: 'pointer' }} aria-label={`${v.id} — ${v.severity}`}>
                      <td>
                        <StatusChip label={v.severity.toUpperCase()} tone={sevTone(v)} size="sm" />
                        {v.is_zero_day && (
                          <span className="sf-sev sf-sev--critical" style={{ marginLeft: 6 }}>ZERO-DAY</span>
                        )}
                      </td>
                      <td className="cell-primary">
                        <span className="cell-mono">{v.id}</span>
                        {v.name && <div style={{ fontSize: 11, color: 'var(--ink-3)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>}
                      </td>
                      <td>{v.product_name || '—'}</td>
                      <td className="num cell-mono" style={{ color: (v.cvss_v3 ?? 0) >= 9 ? 'var(--bad)' : (v.cvss_v3 ?? 0) >= 7 ? 'var(--warn)' : undefined }}>
                        {v.cvss_v3 ?? '—'}
                      </td>
                      <td className="num cell-mono">{v.exposed_count}</td>
                      <td className="cell-mono" style={{ color: fix.muted ? 'var(--muted)' : undefined, fontSize: 12 }}>{fix.text}</td>
                      <td className="cell-mono">{fmtRelative(v.first_seen_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Drawer onClose={() => setSelected(null)}>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p className="sf-timecode">{selected.product_name || 'Vulnerability'}</p>
                <h2 style={{ margin: '2px 0 4px', fontFamily: 'var(--font-mono)' }}>{selected.id}</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusChip label={selected.severity.toUpperCase()} tone={sevTone(selected)} size="sm" />
                  {selected.is_zero_day && <span className="sf-sev sf-sev--critical">ZERO-DAY</span>}
                  <span className="cell-mono" style={{ fontSize: 12 }}>CVSS {selected.cvss_v3 ?? '—'}</span>
                </div>
              </div>
              <button className="btn btn--sm" onClick={() => setSelected(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>

            {selected.name && <p style={{ marginTop: 12, fontSize: 13 }}>{selected.name}</p>}

            <div style={{ marginTop: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
              <div>Fix: {fixLabel(selected).text}</div>
              <div>Exposed devices: {selected.exposed_count}</div>
              <div>First seen: {fmtRelative(selected.first_seen_at)} · Last seen: {fmtRelative(selected.last_seen_at)}</div>
            </div>

            {/* Remediation action */}
            <div style={{ marginTop: 16 }}>
              {selectedAction ? (
                confirming ? (
                  <div className="reconcile-panel" style={{ padding: 12 }}>
                    <p style={{ fontSize: 13, margin: '0 0 10px' }}>
                      Trigger <strong>{selectedAction.label}</strong> on the {selected.exposed_count} exposed Windows device(s)?
                      Runs the Intune remediation script on each device; offline devices fail and can be retried later.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn--primary btn--sm" onClick={() => runRemediation(selected, selectedAction)} id="btn-confirm-remediate">
                        Confirm
                      </button>
                      <button className="btn btn--sm" onClick={() => setConfirming(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn--primary" onClick={() => setConfirming(true)} id={`btn-remediate-${selected.id}`}>
                    <i className="ti ti-shield-check" aria-hidden="true" /> {selectedAction.label} ({selected.exposed_count} devices)
                  </button>
                )
              ) : (
                <p style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {selected.has_fix
                    ? 'Manual remediation — no automated Starfleet action for this product.'
                    : 'No patch available yet — Starfleet tracks this finding but cannot fix it. Re-check after the vendor ships a fix.'}
                </p>
              )}
              {triggerState && (
                <p style={{ fontSize: 12, marginTop: 8, color: triggerState.ok ? 'var(--ok)' : 'var(--bad)' }}>{triggerState.msg}</p>
              )}
            </div>

            <GuidancePanel
              vuln={selected}
              onRegenerated={(g) => {
                setSelected(prev => (prev ? { ...prev, ai_guidance: g, ai_guidance_at: new Date().toISOString() } : prev));
                setVulns(prev => prev.map(v => (v.id === selected.id ? { ...v, ai_guidance: g } : v)));
              }}
            />

            {/* Affected devices */}
            <div style={{ marginTop: 16 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                Affected devices {devices ? `(${activeDevices.length} active)` : ''}
              </span>
              {!devices ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</p>
              ) : activeDevices.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>No devices currently exposed.</p>
              ) : (
                <div className="table-scroll" style={{ marginTop: 6, maxHeight: 260, overflowY: 'auto' }}>
                  <table className="tbl" aria-label="Affected devices">
                    <thead>
                      <tr><th>Device</th><th>Site</th><th>Version</th><th>Intune</th></tr>
                    </thead>
                    <tbody>
                      {activeDevices.map(d => (
                        <tr key={d.id}>
                          <td className="cell-primary" style={{ fontSize: 12 }}>{d.hostname || d.windows_sn || `device-${d.id}`}</td>
                          <td style={{ fontSize: 12 }}>{d.site_name || '—'}</td>
                          <td className="cell-mono" style={{ fontSize: 11 }}>{d.product_version || '—'}</td>
                          <td>{d.can_remediate
                            ? <StatusChip label="Managed" tone="ok" size="sm" />
                            : <StatusChip label="Unmanaged" tone="mute" size="sm" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
