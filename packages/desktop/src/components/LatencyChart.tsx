import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { LatencyReading, latencyClass } from '@starfleet/shared';

interface Props { readings: LatencyReading[]; }

const CLASS_COLOR = { good: '#22c55e', fair: '#f59e0b', poor: '#ef4444' };

export function LatencyChart({ readings }: Props) {
  if (!readings.length) {
    return <div className="chart-empty">No latency history yet</div>;
  }

  const data = readings.map(r => ({
    date: (r.date ?? '').slice(5),
    p50: r.p50_ms,
    p95: r.p95_ms,
    class: latencyClass(r.p50_ms),
  }));

  return (
    <div className="card chart-card">
      <h3>14-Day Latency (P50 / P95)</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="ms" />
          <Tooltip formatter={(v: number) => [`${v}ms`]} />
          <Bar dataKey="p50" name="P50" radius={[2, 2, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={CLASS_COLOR[entry.class]} />
            ))}
          </Bar>
          <Bar dataKey="p95" name="P95" fill="#cbd5e1" radius={[2, 2, 0, 0]} opacity={0.6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
