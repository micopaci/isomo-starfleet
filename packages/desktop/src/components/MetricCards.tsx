import { FleetSummary } from '@starfleet/shared';

interface Props { summary: FleetSummary | null; }

export function MetricCards({ summary }: Props) {
  const cards = [
    {
      label: 'Sites',
      value: summary?.total_sites ?? '—',
      color: '#6366f1',
      sub:   null,
    },
    {
      label: 'Online',
      value: summary?.online_sites ?? '—',
      color: '#22c55e',
      sub:   null,
    },
    {
      label: 'Degraded',
      value: summary?.degraded_sites ?? '—',
      color: '#f59e0b',
      sub:   summary?.anomaly_sites ? `${summary.anomaly_sites} anomaly` : null,
    },
    {
      label: 'Dark',
      value: summary?.dark_sites ?? '—',
      color: '#ef4444',
      sub:   null,
    },
    {
      label: 'Laptops',
      value: summary ? `${summary.online_laptops}/${summary.total_laptops}` : '—',
      color: '#0ea5e9',
      sub:   summary?.stale_devices ? `${summary.stale_devices} stale` : null,
    },
  ];

  return (
    <div className="metric-cards">
      {cards.map(c => (
        <div key={c.label} className="metric-card" style={{ borderTop: `3px solid ${c.color}` }}>
          <div className="metric-value">{c.value}</div>
          <div className="metric-label">{c.label}</div>
          {c.sub && (
            <div className="metric-sub" style={{ color: '#f59e0b', fontSize: 11, marginTop: 2 }}>
              ⚠ {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
