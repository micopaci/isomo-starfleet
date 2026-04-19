/**
 * Starfleet · Isomo palette
 *
 * Light: warm off-white backgrounds, deep ink text, terracotta accent.
 * Dark:  deep navy backgrounds, warm off-white text, softened terracotta accent.
 *
 * Status colors are chroma-matched so the system reads as unified,
 * not like a traffic light. Green/amber/red at similar saturation.
 */

export const light = {
  // Surfaces
  bg:       '#f6f3ec',   // warm off-white
  bg2:      '#efeadd',   // slightly deeper off-white
  surface:  '#ffffff',
  surface2: '#f9f6ef',

  // Ink
  ink:      '#141414',
  ink2:     '#3a3a3a',
  ink3:     '#6b6b6b',
  muted:    '#8a867b',

  // Rules / borders
  rule:     '#d9d4c5',
  rule2:    '#e6e1d3',

  // Accent — terracotta (Rwandan earth tones)
  accent:      '#c8553d',
  accentSoft:  '#f4d9cf',
  accentInk:   '#8c3422',

  // Status
  ok:        '#3e7d4a',
  okSoft:    '#d9e8d8',
  warn:      '#b7791f',
  warnSoft:  '#f2e3c4',
  bad:       '#b13c3c',
  badSoft:   '#f2d6d3',
  mute:      '#9e9a8b',
  muteSoft:  '#e7e3d6',

  // Legacy aliases kept for existing component compat
  text:      '#141414',
  text2:     '#8a867b',
  border:    '#d9d4c5',
  white:     '#ffffff',

  // Derived status colours (used by existing ScorePill / siteStatus)
  online:    '#3e7d4a',   // same as ok
  degraded:  '#b7791f',   // same as warn
  dark:      '#b13c3c',   // same as bad
};

export const dark = {
  // Surfaces
  bg:       '#0b1220',   // deep navy ink
  bg2:      '#0e1727',
  surface:  '#111c2e',
  surface2: '#142339',

  // Ink (inverted to warm off-white)
  ink:      '#f2ede0',
  ink2:     '#c9c3b4',
  ink3:     '#97917f',
  muted:    '#7a7665',

  // Rules
  rule:     '#1e2d46',
  rule2:    '#18253a',

  // Accent — softened terracotta for dark backgrounds
  accent:      '#e8856f',
  accentSoft:  '#3b2019',
  accentInk:   '#f7b9a8',

  // Status
  ok:        '#7ab389',
  okSoft:    '#1d3626',
  warn:      '#e6b86b',
  warnSoft:  '#3a2c13',
  bad:       '#e28482',
  badSoft:   '#3a1b1b',
  mute:      '#87826f',
  muteSoft:  '#1a2335',

  // Legacy aliases
  text:      '#f2ede0',
  text2:     '#7a7665',
  border:    '#1e2d46',
  white:     '#ffffff',

  // Derived status
  online:    '#7ab389',
  degraded:  '#e6b86b',
  dark:      '#e28482',
};

export type Colors = typeof light;

/** Score 0–100 → tone color */
export function scoreColor(score: number, colors: Colors = light): string {
  if (score >= 80) return colors.ok;
  if (score >= 50) return colors.warn;
  return colors.bad;
}

/** Latency ms → tone color */
export function latencyColor(ms: number | null | undefined, colors: Colors = light): string {
  if (ms == null)  return colors.muted;
  if (ms < 40)     return colors.ok;
  if (ms < 80)     return colors.warn;
  return colors.bad;
}

/** Generic health → tone */
export function toneColor(tone: 'ok' | 'warn' | 'bad' | 'mute', colors: Colors = light): string {
  return { ok: colors.ok, warn: colors.warn, bad: colors.bad, mute: colors.muted }[tone];
}
