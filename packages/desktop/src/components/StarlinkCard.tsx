import { SiteDetail, TriggerType, computeSignalScore, predictCause, formatLatency, siteStatus } from '@starfleet/shared';

interface Props {
  site: SiteDetail;
  isAdmin: boolean;
  onTrigger: (deviceId: number, type: TriggerType) => Promise<void>;
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
      <p className="cause-label muted" style={{ marginTop: -6 }}>
        Weather predictor: {site.weather_predictor?.label ?? 'No weather reading yet'}
      </p>
      {site.weather_predictor?.explanation && (
        <p className="cause-label muted" style={{ marginTop: -6 }}>
          {site.weather_predictor.explanation}
        </p>
      )}

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
          <span className="sig-label">Speed ↓/↑</span>
          <span className="sig-value">
            {formatSpeed(site.download_mbps ?? sig?.download_mbps ?? null, site.upload_mbps ?? sig?.upload_mbps ?? null)}
          </span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Connected (all)</span>
          <span className="sig-value">{site.online_laptops} laptop{site.online_laptops !== 1 ? 's' : ''}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Intune</span>
          <span className="sig-value">{site.online_intune_laptops ?? 0}/{site.total_intune_laptops ?? 0}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Chromebooks</span>
          <span className="sig-value">{site.online_chromebooks ?? 0}/{site.total_chromebooks ?? 0}</span>
        </div>
        <div className="sig-metric">
          <span className="sig-label">Uptime today</span>
          <span className="sig-value">
            {site.uptime_pct != null
              ? <span style={{ color: site.uptime_pct >= 90 ? 'var(--ok)' : site.uptime_pct >= 70 ? 'var(--warn)' : 'var(--bad)' }}>
                  {site.uptime_pct.toFixed(1)}%
                </span>
              : '—'}
          </span>
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
              if (firstDevice) void onTrigger(firstDevice.id, 'diagnostics');
            }}
          >
            Diagnostics
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const firstDevice = site.devices[0];
              if (firstDevice) void onTrigger(firstDevice.id, 'ping_dish');
            }}
          >
            Ping dish
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const firstDevice = site.devices[0];
              if (firstDevice) void onTrigger(firstDevice.id, 'location_refresh');
            }}
          >
            Refresh location
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const firstDevice = site.devices[0];
              if (firstDevice) void onTrigger(firstDevice.id, 'data_pull');
            }}
          >
            Pull data
          </button>
          <button
            className="btn-secondary btn-secondary--danger"
            onClick={() => {
              if (!window.confirm(`Reboot the Starlink dish at ${site.name}? This will interrupt connectivity for ~2 minutes.`)) return;
              const firstDevice = site.devices[0];
              if (firstDevice) void onTrigger(firstDevice.id, 'reboot_starlink');
            }}
          >
            Reboot dish
          </button>
        </div>
      )}
    </div>
  );
}

function formatSpeed(download: number | null | undefined, upload: number | null | undefined): string {
  if (download == null && upload == null) return '—';
  return `${download != null ? download.toFixed(1) : '—'} / ${upload != null ? upload.toFixed(1) : '—'} Mbps`;
}
