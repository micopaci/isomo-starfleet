interface Props {
  points: number[];
  height?: number;
  width?: number;
  dim?: boolean;
}

export function Sparkline({ points, height = 24, width = 88, dim = false }: Props) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      className="sparkline"
      style={{ opacity: dim ? 0.35 : 1, color: 'var(--accent)' }}
    >
      <path d={d} stroke="currentColor" strokeWidth="1.25" fill="none" />
    </svg>
  );
}
