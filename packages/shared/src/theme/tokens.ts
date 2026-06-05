/**
 * Starfleet design tokens — single source of truth for all platforms.
 *
 * Light: warm parchment backgrounds, deep ink text, terracotta accent.
 * Dark:  deep navy instrument backgrounds, warm off-white text, softened terracotta.
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
  bg:       '#f6f1e7',
  bg2:      '#eee7d9',
  surface:  '#fbf8f1',
  surface2: '#f2ecdf',

  ink:      '#171512',
  ink2:     '#4a4339',
  ink3:     '#766e5f',
  muted:    '#9a907f',

  rule:     '#d8cfbd',
  rule2:    '#e7ddcb',

  accent:      '#c8553d',
  accentInk:   '#8c3422',
  accentSoft:  '#efd1c7',

  ok:       '#3d7a4b',
  okSoft:   '#dbe8d8',
  warn:     '#a87118',
  warnSoft: '#eeddb8',
  bad:      '#b33d3d',
  badSoft:  '#efd4d0',
  mute:     '#9a907f',
  muteSoft: '#e8dfd0',
};

export const darkColors: ColorTokens = {
  bg:       '#080f1b',
  bg2:      '#0b1321',
  surface:  '#0d1726',
  surface2: '#111d30',

  ink:      '#efe8d7',
  ink2:     '#c7bdab',
  ink3:     '#918a7d',
  muted:    '#6f7888',

  rule:     '#223047',
  rule2:    '#17253a',

  accent:      '#e47659',
  accentInk:   '#f1ac98',
  accentSoft:  '#3b2019',

  ok:       '#66b47e',
  okSoft:   '#1a3024',
  warn:     '#d8a64a',
  warnSoft: '#3a2c13',
  bad:      '#ef6f6a',
  badSoft:  '#3a1b1b',
  mute:     '#6f7888',
  muteSoft: '#172235',
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
