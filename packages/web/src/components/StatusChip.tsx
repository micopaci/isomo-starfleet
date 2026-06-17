type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

interface Props {
  label: string;
  tone: Tone;
  size?: 'sm' | 'md';
}

export default function StatusChip({ label, tone, size = 'md' }: Props) {
  return (
    <span className={`status-cell status-cell--${tone}`} style={size === 'sm' ? { fontSize: 10 } : undefined}>
      <span className={`dot dot--${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}
