interface Props {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'info' | 'mute';
}

export default function StatCard({ label, value, sub, tone }: Props) {
  const valueStyle = tone ? { color: `var(--${tone})` } : undefined;
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={valueStyle}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
