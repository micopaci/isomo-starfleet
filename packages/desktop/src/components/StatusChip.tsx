/** Shared status primitives used across multiple views */

export type Tone = 'ok' | 'warn' | 'bad' | 'mute';

export const STATUS_TONE: Record<string, Tone> = {
  online: 'ok',    healthy: 'ok',
  degraded: 'warn', 'needs-update': 'warn', 'low-storage': 'warn',
  offline: 'bad',  critical: 'bad', dark: 'bad',
  standby: 'mute', maintenance: 'mute', 'in-repair': 'mute',
};

export const STATUS_LABEL: Record<string, string> = {
  online: 'Online', healthy: 'Healthy',
  degraded: 'Degraded', 'needs-update': 'Update due', 'low-storage': 'Low storage',
  offline: 'Offline', critical: 'Critical', dark: 'Dark',
  standby: 'Standby', maintenance: 'Maintenance', 'in-repair': 'In repair',
};

export function StatusDot({ status, size = 6 }: { status: string; size?: number }) {
  const tone = STATUS_TONE[status] ?? 'mute';
  return (
    <span
      className={`status-dot ${tone}`}
      style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }}
      aria-label={status}
    />
  );
}

export function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'mute';
  return (
    <span className={`status-chip ${tone}`}>
      <StatusDot status={status} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
