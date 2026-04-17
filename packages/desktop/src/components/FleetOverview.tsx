import { Site, computeSignalScore, siteStatus, SiteStatusValue } from '@starfleet/shared';

interface Props {
  sites: Site[];
  onSelect: (id: number) => void;
}

const STATUS_COLOR: Record<SiteStatusValue, string> = {
  online:   '#22c55e',
  degraded: '#f59e0b',
  dark:     '#ef4444',
};

export function FleetOverview({ sites, onSelect }: Props) {
  // Sort by score ascending (worst first)
  const sorted = [...sites].sort((a, b) => {
    const scoreA = a.signal ? computeSignalScore({ ping_drop_pct: a.signal.ping_drop_pct ?? 0, obstruction_pct: a.signal.obstruction_pct ?? 0, snr: a.signal.snr ?? 9.5, pop_latency_ms: a.signal.pop_latency_ms ?? 35 }) : -1;
    const scoreB = b.signal ? computeSignalScore({ ping_drop_pct: b.signal.ping_drop_pct ?? 0, obstruction_pct: b.signal.obstruction_pct ?? 0, snr: b.signal.snr ?? 9.5, pop_latency_ms: b.signal.pop_latency_ms ?? 35 }) : -1;
    return scoreA - scoreB;
  });

  return (
    <div className="fleet-overview">
      <h2>Fleet Overview <span className="muted">— worst first</span></h2>
      <div className="site-grid">
        {sorted.map(site => {
          const status = siteStatus(site);
          const score = site.signal
            ? computeSignalScore({ ping_drop_pct: site.signal.ping_drop_pct ?? 0, obstruction_pct: site.signal.obstruction_pct ?? 0, snr: site.signal.snr ?? 9.5, pop_latency_ms: site.signal.pop_latency_ms ?? 35 })
            : null;

          return (
            <button
              key={site.id}
              className="site-card"
              onClick={() => onSelect(site.id)}
              style={{ borderLeft: `4px solid ${STATUS_COLOR[status]}` }}
            >
              <div className="site-card-name">{site.name}</div>
              <div className="site-card-score">
                {score !== null
                  ? <span style={{ color: STATUS_COLOR[status] }}>Score {score}</span>
                  : <span className="muted">No data</span>
                }
              </div>
              <div className="site-card-cause muted">{site.signal ? '' : 'Awaiting first reading'}</div>
              <div className="site-card-laptops">
                💻 {site.online_laptops}/{site.total_laptops} online
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
