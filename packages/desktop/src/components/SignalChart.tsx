import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { DailyScore } from '@starfleet/shared';

interface Props {
  scores: DailyScore[];
  hasAnomalies?: boolean;
  hasLowData?: boolean;
}

interface ScoreDotProps {
  cx?: number;
  cy?: number;
  payload?: {
    date: string;
    score: number;
    anomaly?: boolean | null;
  };
}

const DOT_FILL = (score: number, anomaly?: boolean | null) => {
  if (anomaly) return '#ef4444';        // red flash for anomaly days
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
};

// Custom tooltip
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: {
  date: string; score: number; cause: string; anomaly?: boolean | null;
  data_quality?: string | null; anomaly_delta?: number | null;
}}> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-card, #1e293b)',
      border: '1px solid var(--border, #334155)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      minWidth: 200,
      color: 'var(--text, #e2e8f0)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.date}</div>
      <div>Score: <strong>{d.score}</strong></div>
      <div style={{ color: '#94a3b8', marginTop: 2 }}>{d.cause}</div>
      {d.anomaly && (
        <div style={{ color: '#ef4444', marginTop: 4 }}>
          ⚠ Anomaly{d.anomaly_delta != null ? ` (−${Math.abs(d.anomaly_delta)} vs avg)` : ''}
        </div>
      )}
      {d.data_quality === 'low_data' && (
        <div style={{ color: '#f59e0b', marginTop: 2 }}>⚡ Low data — score may be imprecise</div>
      )}
    </div>
  );
}

export function SignalChart({ scores, hasAnomalies, hasLowData }: Props) {
  if (!scores.length) {
    return <div className="chart-empty">No signal history yet</div>;
  }

  const data = scores.map(s => ({
    date:          s.date.slice(5),  // MM-DD
    score:         s.score,
    cause:         s.cause,
    anomaly:       s.anomaly,
    data_quality:  s.data_quality,
    anomaly_delta: s.anomaly_delta,
  }));

  // Reference dots on anomaly days (red burst marker)
  const anomalyDots = data
    .filter(d => d.anomaly)
    .map(d => (
      <ReferenceDot
        key={`anomaly-${d.date}`}
        x={d.date}
        y={d.score}
        r={7}
        fill="rgba(239,68,68,0.25)"
        stroke="#ef4444"
        strokeWidth={1.5}
      />
    ));

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <h3>14-Day Signal Score</h3>
        <div className="chart-badges">
          {hasAnomalies && (
            <span className="badge badge-alert" title="One or more anomaly days detected">
              ⚠ Anomalies
            </span>
          )}
          {hasLowData && (
            <span className="badge badge-warn" title="Some days had fewer than 12 readings">
              ⚡ Low data
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          {anomalyDots}
          <Line
            type="monotone"
            dataKey="score"
            stroke="#10b981"
            strokeWidth={2}
            dot={(props: ScoreDotProps) => {
              const { cx = 0, cy = 0, payload } = props;
              if (!payload) return <circle cx={cx} cy={cy} r={4} fill="#10b981" />;
              return (
                <circle
                  key={payload.date}
                  cx={cx}
                  cy={cy}
                  r={payload.anomaly ? 5 : 4}
                  fill={DOT_FILL(payload.score, payload.anomaly)}
                  stroke={payload.anomaly ? '#ef4444' : 'transparent'}
                  strokeWidth={payload.anomaly ? 2 : 0}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
