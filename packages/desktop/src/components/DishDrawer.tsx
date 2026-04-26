import { useEffect, useState } from 'react';
import { Site, TriggerType, computeSignalScore, siteStatus, useSignalHistory } from '@starfleet/shared';
import { StatusChip } from './StatusChip';

interface Props {
  site: Site | null;
  onClose: () => void;
  onOpenFull: () => void;
  isAdmin: boolean;
  onTriggerSite: (siteId: number, type: TriggerType) => Promise<void>;
}

export function DishDrawer({ site, onClose, onOpenFull, isAdmin, onTriggerSite }: Props) {
  const { scores } = useSignalHistory(site?.id ?? null);
  const [busyAction, setBusyAction] = useState<TriggerType | null>(null);

  // Escape key closes
  useEffect(() => {
    if (!site) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [site, onClose]);

  if (!site) return null;

  const sig    = site.signal;
  const st     = siteStatus(site);
  const score  = sig
    ? computeSignalScore({
        ping_drop_pct:   sig.ping_drop_pct   ?? 0,
        obstruction_pct: sig.obstruction_pct  ?? 0,
        snr:             sig.snr             ?? 9.5,
        pop_latency_ms:  sig.pop_latency_ms  ?? 35,
      })
    : null;

  // Mini score sparkline from last 14 days
  const sparkPoints = scores.map(s => s.score);

  async function trigger(type: TriggerType) {
    if (!site || busyAction) return;
    if (type === 'reboot_starlink' && !window.confirm(`Reboot the Starlink dish at ${site.name}?`)) return;
    setBusyAction(type);
    try {
      await onTriggerSite(site.id, type);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to queue ${type}.`);
    } finally {
      setBusyAction(null);
    }
  }

  function openStarlinkPortal() {
    window.open('https://www.starlink.com/account/home', '_blank', 'noopener');
  }

  return (
    <>
      {/* Scrim */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 40,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Dish detail — ${site.name}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 420, maxWidth: '100vw',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--rule)',
          zIndex: 50,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Head */}
        <header style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--rule-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow">Starlink dish</div>
              <h2 style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 24,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                margin: '6px 0 4px',
              }}>
                {site.name}
              </h2>
              <div className="cell-mono">{site.starlink_sn}</div>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close drawer">✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <StatusChip status={st} />
            {site.location && (
              <span className="muted" style={{ fontSize: 12 }}>{site.location}</span>
            )}
          </div>
        </header>

        {/* Signal metrics grid */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--rule-2)' }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Signal metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <DrawerStat label="Score" value={score !== null ? String(score) : '—'} tone={scoreTone(score)} />
            <DrawerStat label="Latency" value={sig?.pop_latency_ms != null ? `${sig.pop_latency_ms}ms` : '—'} tone={latTone(sig?.pop_latency_ms)} />
            <DrawerStat label="SNR" value={sig?.snr != null ? sig.snr.toFixed(1) : '—'} tone={sig?.snr != null && sig.snr < 7 ? 'warn' : null} />
            <DrawerStat label="Obstruct." value={sig?.obstruction_pct != null ? `${sig.obstruction_pct.toFixed(1)}%` : '—'} tone={sig?.obstruction_pct != null && sig.obstruction_pct > 5 ? 'warn' : null} />
            <DrawerStat label="Ping drop" value={sig?.ping_drop_pct != null ? `${sig.ping_drop_pct.toFixed(1)}%` : '—'} tone={sig?.ping_drop_pct != null && sig.ping_drop_pct > 3 ? 'warn' : null} />
            <DrawerStat label="Confidence" value={sig?.confidence === 'high' ? 'High' : sig?.confidence === 'low' ? 'Low' : '—'} tone={sig?.confidence === 'low' ? 'warn' : null} />
          </div>
        </div>

        {/* Laptops */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-2)' }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Devices</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <DrawerStat label="Online" value={String(site.online_laptops)} tone={site.online_laptops === 0 ? 'bad' : 'ok'} />
            <DrawerStat label="Total" value={String(site.total_laptops)} tone={null} />
            <DrawerStat label="Offline" value={String(site.total_laptops - site.online_laptops)} tone={site.total_laptops - site.online_laptops > 0 ? 'warn' : null} />
          </div>
        </div>

        {/* Score history sparkline */}
        {sparkPoints.length > 0 && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Score · last 14 days</div>
            <ScoreSparkline points={sparkPoints} />
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
              marginTop: 6,
            }}>
              <span>−14d</span>
              <span>−7d</span>
              <span>today</span>
            </div>
          </div>
        )}

        {/* Anomaly warning */}
        {sig?.anomaly && (
          <div style={{
            margin: '16px 24px 0',
            padding: '12px 14px',
            background: 'var(--warn-soft)',
            borderLeft: '3px solid var(--warn)',
            fontSize: 12.5,
          }}>
            <strong style={{ color: 'var(--warn)' }}>Anomaly detected</strong>
            {sig.anomaly_delta != null && (
              <span style={{ color: 'var(--ink-2)', marginLeft: 6 }}>
                {sig.anomaly_delta > 0 ? '+' : ''}{sig.anomaly_delta}pt vs 7-day avg
              </span>
            )}
          </div>
        )}

        {/* 7-day avg */}
        {site.score != null && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-2)' }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <DrawerStat label="Today's score" value={String(site.score)} tone={scoreTone(site.score)} />
              {site.score_7day_avg != null && (
                <DrawerStat label="7-day avg" value={String(site.score_7day_avg)} tone={scoreTone(site.score_7day_avg)} />
              )}
            </div>
          </div>
        )}

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-2)' }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Dish actions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn" onClick={() => void trigger('ping_dish')} disabled={!isAdmin || busyAction !== null}>
              {busyAction === 'ping_dish' ? 'Queuing…' : 'Ping dish'}
            </button>
            <button className="btn" onClick={() => void trigger('reboot_starlink')} disabled={!isAdmin || busyAction !== null}>
              {busyAction === 'reboot_starlink' ? 'Queuing…' : 'Reboot'}
            </button>
            <button className="btn" onClick={openStarlinkPortal}>Open in Starlink</button>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Footer actions */}
        <footer style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--rule)',
          display: 'flex', gap: 8,
        }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={onOpenFull}>
            Full site detail →
          </button>
        </footer>
      </aside>
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function DrawerStat({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | null | undefined;
}) {
  const color = tone === 'ok' ? 'var(--ok)'
              : tone === 'warn' ? 'var(--warn)'
              : tone === 'bad' ? 'var(--bad)'
              : 'var(--ink)';
  return (
    <div>
      <div className="metric-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-serif)',
        fontSize: 20,
        letterSpacing: '-0.02em',
        color,
      }}>
        {value}
      </div>
    </div>
  );
}

function scoreTone(score: number | null): 'ok' | 'warn' | 'bad' | null {
  if (score == null) return null;
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

function latTone(ms: number | null | undefined): 'ok' | 'warn' | 'bad' | null {
  if (ms == null) return null;
  if (ms < 40) return 'ok';
  if (ms < 80) return 'warn';
  return 'bad';
}

function ScoreSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 360, H = 48;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 100);
  const range = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map(v => H - ((v - min) / range) * H);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');

  // Color: last point's score
  const last = points[points.length - 1];
  const stroke = last >= 80 ? 'var(--ok)' : last >= 50 ? 'var(--warn)' : 'var(--bad)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {/* Baseline */}
      <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule-2)" strokeWidth="1" />
      {/* Score 80 line */}
      <line
        x1="0" y1={H - ((80 - min) / range) * H}
        x2={W} y2={H - ((80 - min) / range) * H}
        stroke="var(--ok)" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.5"
      />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Last point dot */}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={stroke} />
    </svg>
  );
}
