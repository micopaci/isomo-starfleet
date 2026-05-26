/**
 * Starfleet design tokens — single source of truth for all platforms.
 *
 * Light: warm parchment backgrounds, deep ink text, terracotta accent.
 * Dark:  deep warm ink backgrounds, warm off-white text, softened terracotta.
 */

export interface ColorTokens {
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;

  ink: string;
  ink2: string;
  ink3: string;
  muted: string;

  rule: string;
  rule2: string;

  accent: string;
  accentInk: string;
  accentSoft: string;

  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
  mute: string;
  muteSoft: string;
}

export const lightColors: ColorTokens = {
  bg:       '#f6f3ec',
  bg2:      '#efeadd',
  surface:  '#ffffff',
  surface2: '#f9f6ef',

  ink:      '#141414',
  ink2:     '#3a3a3a',
  ink3:     '#6b6b6b',
  muted:    '#8a867b',

  rule:     '#d9d4c5',
  rule2:    '#e6e1d3',

  accent:      '#c8553d',
  accentInk:   '#8c3422',
  accentSoft:  '#f4d9cf',

  ok:       '#3e7d4a',
  okSoft:   '#d9e8d8',
  warn:     '#b7791f',
  warnSoft: '#f2e3c4',
  bad:      '#b13c3c',
  badSoft:  '#f2d6d3',
  mute:     '#9e9a8b',
  muteSoft: '#e7e3d6',
};

export const darkColors: ColorTokens = {
  bg:       '#0b1220',
  bg2:      '#0e1727',
  surface:  '#111c2e',
  surface2: '#142339',

  ink:      '#f2ede0',
  ink2:     '#c9c3b4',
  ink3:     '#97917f',
  muted:    '#7a7665',

  rule:     '#1e2d46',
  rule2:    '#18253a',

  accent:      '#e8856f',
  accentInk:   '#f7b9a8',
  accentSoft:  '#3b2019',

  ok:       '#7ab389',
  okSoft:   '#1d3626',
  warn:     '#e6b86b',
  warnSoft: '#3a2c13',
  bad:      '#e28482',
  badSoft:  '#3a1b1b',
  mute:     '#87826f',
  muteSoft: '#1a2335',
};

export const fonts = {
  ui:    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "'Newsreader', 'Iowan Old Style', 'Palatino', Georgia, serif",
  mono:  "'IBM Plex Mono', ui-monospace, Menlo, monospace",
} as const;

export const layout = {
  sidebarWidth: 232,
  radius: 0,
  panelPad: 20,
} as const;

export function scoreToHex(score: number, colors: ColorTokens = lightColors): string {
  if (score >= 80) return colors.ok;
  if (score >= 50) return colors.warn;
  return colors.bad;
}

export function statusToHex(status: 'online' | 'degraded' | 'dark', colors: ColorTokens = lightColors): string {
  if (status === 'online') return colors.ok;
  if (status === 'degraded') return colors.warn;
  return colors.bad;
}

export function latencyToHex(ms: number | null | undefined, colors: ColorTokens = lightColors): string {
  if (ms == null) return colors.muted;
  if (ms < 40)    return colors.ok;
  if (ms < 80)    return colors.warn;
  return colors.bad;
}
