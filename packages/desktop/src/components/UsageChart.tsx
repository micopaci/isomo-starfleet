import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { UsageHistoryPoint } from '@starfleet/shared';

interface Props {
  usage: UsageHistoryPoint[];
}

function formatMb(mb: number): string {
  if (!Number.isFinite(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

export function UsageChart({ usage }: Props) {
  if (!usage.length) {
    return <div className="chart-empty">No usage history yet</div>;
  }

  const data = usage.map(u => ({
    month: String(u.month).slice(0, 7),
    managed: Number(u.managed_mb || 0),
    unmanaged: Number(u.unmanaged_est_mb || 0),
    total: u.total_mb == null ? null : Number(u.total_mb),
    confidence: u.confidence,
  }));

  return (
    <div className="card chart-card">
      <h3>Monthly Data Usage (Managed vs Estimated Unmanaged)</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1024)}GB`} />
          <Tooltip
            formatter={(v: number) => formatMb(v)}
            labelFormatter={(label) => `Month ${label}`}
          />
          <Legend />
          <Bar dataKey="managed" name="Managed (agent)" stackId="usage" fill="#22c55e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="unmanaged" name="Estimated unmanaged" stackId="usage" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="muted" style={{ fontSize: 12 }}>
        Unmanaged is estimated as imported site total minus managed laptop usage for each month.
      </div>
    </div>
  );
}
