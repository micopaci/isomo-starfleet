import { Site, computeSignalScore, siteStatus } from '@starfleet/shared';
import { StatusChip } from './StatusChip';

interface Props {
  sites: Site[];
  onSelect: (id: number) => void;
}

export function FleetOverview({ sites, onSelect }: Props) {
  // Sort by score ascending (worst first)
  const sorted = [...sites].sort((a, b) => {
    const sa = a.signal ? computeSignalScore({ ping_drop_pct: a.signal.ping_drop_pct ?? 0, obstruction_pct: a.signal.obstruction_pct ?? 0, snr: a.signal.snr ?? 9.5, pop_latency_ms: a.signal.pop_latency_ms ?? 35 }) : -1;
    const sb = b.signal ? computeSignalScore({ ping_drop_pct: b.signal.ping_drop_pct ?? 0, obstruction_pct: b.signal.obstruction_pct ?? 0, snr: b.signal.snr ?? 9.5, pop_latency_ms: b.signal.pop_latency_ms ?? 35 }) : -1;
    return sa - sb;
  });

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Sites</h2>
        <span className="muted" style={{ fontSize: 12 }}>sorted by health score · worst first</span>
      </div>
      <div className="campus-grid">
        {sorted.map(site => {
          const status = siteStatus(site);
          const score = site.signal
            ? computeSignalScore({ ping_drop_pct: site.signal.ping_drop_pct ?? 0, obstruction_pct: site.signal.obstruction_pct ?? 0, snr: site.signal.snr ?? 9.5, pop_latency_ms: site.signal.pop_latency_ms ?? 35 })
            : null;

          const tone = status === 'online' ? 'ok' : status === 'degraded' ? 'warn' : 'bad';

          return (
            <div
              key={site.id}
              className="campus-card"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(site.id)}
            >
              <div className="campus-card-head">
                <div>
                  <div className="campus-card-name">{site.name}</div>
                  <StatusChip status={status} />
                </div>
                <div className="campus-card-count" style={{ color: `var(--${tone})` }}>
                  {score !== null ? score : '—'}
                  <span>score</span>
                </div>
              </div>
              <div className="campus-stat-row">
                <div>
                  <dt>Latency</dt>
                  <dd style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                    {site.signal?.pop_latency_ms != null ? `${site.signal.pop_latency_ms}ms` : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Obstruct.</dt>
                  <dd style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                    {site.signal?.obstruction_pct != null ? `${site.signal.obstruction_pct.toFixed(1)}%` : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Laptops</dt>
                  <dd style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                    {site.online_laptops}/{site.total_laptops}
                  </dd>
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>No sites loaded.</div>
        )}
      </div>
    </div>
  );
}
