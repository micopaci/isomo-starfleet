import { FleetSummary } from '@starfleet/shared';

interface Props { summary: FleetSummary | null; }

export function MetricCards({ summary }: Props) {
  const cards = [
    {
      label: 'Sites online',
      value: summary ? `${summary.online_sites}/${summary.total_sites}` : '—',
      tone:  summary?.dark_sites ? 'warn' : 'ok',
      sub:   summary?.dark_sites ? `${summary.dark_sites} dark` : 'all reachable',
    },
    {
      label: 'Degraded',
      value: summary?.degraded_sites ?? '—',
      tone:  summary?.degraded_sites ? 'warn' : 'ok',
      sub:   summary?.anomaly_sites ? `${summary.anomaly_sites} anomaly` : null,
    },
    {
      label: 'Dark / offline',
      value: summary?.dark_sites ?? '—',
      tone:  summary?.dark_sites ? 'bad' : 'ok',
      sub:   null,
    },
    {
      label: 'Laptops online',
      value: summary ? `${summary.online_laptops}/${summary.total_laptops}` : '—',
      tone:  null,
      sub:   summary?.stale_devices ? `${summary.stale_devices} stale` : null,
    },
  ];

  return (
    <div className="metric-cards metric-cards--4">
      {cards.map(c => (
        <div key={c.label} className="metric-card">
          <div className="metric-label">{c.label}</div>
          <div className={`metric-value ${c.tone ? `metric-value--${c.tone}` : ''}`}>{c.value}</div>
          {c.sub && <div className="metric-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
