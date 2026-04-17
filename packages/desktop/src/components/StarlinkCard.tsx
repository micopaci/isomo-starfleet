import { SiteDetail, computeSignalScore, predictCause, formatLatency, siteStatus } from '@starfleet/shared';

interface Props {
  site: SiteDetail;
  isAdmin: boolean;
  onTrigger: (deviceId: number, type: string) => void;
}

const SCORE_COLOR = (s: number) =>
  s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444';

export function StarlinkCard({ site, isAdmin, onTrigger }: Props) {
  const sig = site.signal;

  const score = sig
    ? computeSignalScore({
        ping_drop_pct: sig.ping_drop_pct ?? 0,
        obstruction_pct: sig.obstruction_pct ?? 0,
        snr: sig.snr ?? 9.5,
        pop_latency_ms: sig.pop_latency_ms ?? 35,
      })
    : null;

  const cause = sig
    ? predictCause({
        ping_drop_pct: sig.ping_drop_pct ?? 0,
        obstruction_pct: sig.obstruction_pct ?? 0,
        snr: sig.snr ?? 9.5,
        pop_latency_ms: sig.pop_latency_ms ?? 35,
      })
    : 'No data';

  const status = siteStatus(site);

  return (
    <div className="starlink-card card">
      <div className="card-header">
        <h3>🛰 Starlink Signal</h3>
        {score !== null && (
          <span
            className="score-pill"
            style={{ background: SCORE_COLOR(score) }}
          >
            Score {score}
          </span>
        )}
        <span className={`badge badge-${sig?.confidence ?? 'low'}`}>
          {sig?.confidence ?? 'no data'}
        </span>
      </div>

      <p className="cause-label">{cause}</p>

      <div className="signal-grid">
        <div className="sig-metric">
          <span className="sig-label">SNR</span>
          <span className="sig-value">{sig?.snr?.toFixed(1) ?? '—'}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Ping Drop</span>
          <span className="sig-value">{sig?.ping_drop_pct != null ? `${sig.ping_drop_pct.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Obstruction</span>
          <span className="sig-value">{sig?.obstruction_pct != null ? `${sig.obstruction_pct.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">PoP Latency</span>
          <span className="sig-value">{formatLatency(sig?.pop_latency_ms)}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Reporters</span>
          <span className="sig-value">{site.online_laptops} laptop{site.online_laptops !== 1 ? 's' : ''}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Status</span>
          <span className={`sig-value status-${status}`}>{status}</span>
        </div>
      </div>

      {isAdmin && (
        <div className="card-actions">
          <button
            className="btn-secondary"
            onClick={() => {
              const firstDevice = site.devices[0];
              if (firstDevice) onTrigger(firstDevice.id, 'location_refresh');
            }}
          >
            ↻ Refresh location
          </button>
        </div>
      )}
    </div>
  );
}
