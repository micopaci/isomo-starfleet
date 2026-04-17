import type { Site, SignalSummary } from './types';

// ─── Signal score — identical formula to backend scoreCron.js ────────────────

export interface ScoreInput {
  ping_drop_pct: number;
  obstruction_pct: number;
  snr: number;
  pop_latency_ms: number;
}

export function computeSignalScore(reading: Partial<ScoreInput>): number {
  const {
    ping_drop_pct = 0,
    obstruction_pct = 0,
    snr = 9.5,
    pop_latency_ms = 35,
  } = reading;

  let score = 100;
  score -= Math.min(30, ping_drop_pct * 6);
  score -= Math.min(30, obstruction_pct * 2);
  score -= Math.max(0, (9.5 - snr) * 8);
  score -= Math.max(0, (pop_latency_ms - 35) * 0.3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Cause prediction — identical rules to backend scoreCron.js ──────────────

export function predictCause(reading: Partial<ScoreInput>): string {
  const score = computeSignalScore(reading);
  if (score >= 100) return 'Good signal';

  const { ping_drop_pct = 0, obstruction_pct = 0, snr = 9.5 } = reading;

  if (obstruction_pct > 5 && ping_drop_pct < 5) {
    return 'Physical obstruction likely (trees/buildings)';
  }
  if (ping_drop_pct > 5 && obstruction_pct < 5) {
    return 'Satellite geometry / ground station distance';
  }
  if (snr < 7) {
    return 'Local RF interference';
  }
  return 'Signal degraded';
}

// ─── Format latency ms → "32ms" or "1.2s" ────────────────────────────────────

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Site status ──────────────────────────────────────────────────────────────

export type SiteStatusValue = 'online' | 'degraded' | 'dark';

export function siteStatus(site: Pick<Site, 'online_laptops' | 'signal'>): SiteStatusValue {
  if (site.online_laptops === 0) return 'dark';
  const signal = site.signal as SignalSummary | null;
  if (!signal) return 'dark';
  if (signal.confidence === 'low') return 'degraded';
  const score = computeSignalScore({
    ping_drop_pct: signal.ping_drop_pct ?? 0,
    obstruction_pct: signal.obstruction_pct ?? 0,
    snr: signal.snr ?? 9.5,
    pop_latency_ms: signal.pop_latency_ms ?? 35,
  });
  if (score < 60) return 'degraded';
  return 'online';
}

// ─── Latency class ────────────────────────────────────────────────────────────

export type LatencyClassValue = 'good' | 'fair' | 'poor';

export function latencyClass(ms: number | null | undefined): LatencyClassValue {
  if (ms == null) return 'poor';
  if (ms < 40) return 'good';
  if (ms < 80) return 'fair';
  return 'poor';
}

// ─── Score color ──────────────────────────────────────────────────────────────

export type ScoreColorValue = 'good' | 'warn' | 'bad' | 'unknown';

export function scoreColor(score: number | null | undefined): ScoreColorValue {
  if (score == null) return 'unknown';
  if (score >= 75)   return 'good';
  if (score >= 50)   return 'warn';
  return 'bad';
}

// ─── Format relative time ─────────────────────────────────────────────────────

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)   return 'Just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24)  return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

// ─── Score trend (from DailyScore array) ─────────────────────────────────────

export function scoreTrend(scores: Array<{ score: number }>): 'up' | 'down' | 'flat' | 'unknown' {
  if (scores.length < 2) return 'unknown';
  const recent = scores.slice(-3).map(s => s.score);
  const prev   = scores.slice(-6, -3).map(s => s.score);
  if (!prev.length) return 'unknown';
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgPrev   = prev.reduce((a, b) => a + b, 0) / prev.length;
  const delta = avgRecent - avgPrev;
  if (delta > 3)  return 'up';
  if (delta < -3) return 'down';
  return 'flat';
}
