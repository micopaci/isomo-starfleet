export const light = {
  bg:       '#f8fafc',
  bg2:      '#ffffff',
  bg3:      '#f1f5f9',
  border:   '#e2e8f0',
  text:     '#0f172a',
  text2:    '#64748b',
  accent:   '#6366f1',
  online:   '#22c55e',
  degraded: '#f59e0b',
  dark:     '#ef4444',
  white:    '#ffffff',
};

export const dark = {
  bg:       '#0f172a',
  bg2:      '#1e293b',
  bg3:      '#334155',
  border:   '#334155',
  text:     '#f1f5f9',
  text2:    '#94a3b8',
  accent:   '#6366f1',
  online:   '#22c55e',
  degraded: '#f59e0b',
  dark:     '#ef4444',
  white:    '#ffffff',
};

export type Colors = typeof light;

export function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export function latencyColor(ms: number | null | undefined): string {
  if (ms == null) return '#94a3b8';
  if (ms < 40)  return '#22c55e';
  if (ms < 80)  return '#f59e0b';
  return '#ef4444';
}
