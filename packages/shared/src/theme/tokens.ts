/**
 * Starfleet design tokens — single source of truth for all platforms.
 *
 * Light: warm field-paper backgrounds, deep green-black text, signal-green accent.
 * Dark:  green-black instrument backgrounds, soft bone text, field-green accent.
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
  bg:       '#f3f6f1',
  bg2:      '#e8eee8',
  surface:  '#fbfcf8',
  surface2: '#eef4ee',

  ink:      '#222b27',
  ink2:     '#44514b',
  ink3:     '#68756e',
  muted:    '#84908a',

  rule:     '#cfd9d2',
  rule2:    '#dfe6e1',

  accent:      '#24825f',
  accentInk:   '#0e3d2b',
  accentSoft:  '#d7eadf',

  ok:       '#347a56',
  okSoft:   '#dceade',
  warn:     '#9b6f18',
  warnSoft: '#eee1bd',
  bad:      '#b45142',
  badSoft:  '#edd5d1',
  mute:     '#84908a',
  muteSoft: '#e4ebe5',
};

export const darkColors: ColorTokens = {
  bg:       '#141f1c',
  bg2:      '#17251f',
  surface:  '#1b2b24',
  surface2: '#22332b',

  ink:      '#e6efe9',
  ink2:     '#b8c5be',
  ink3:     '#7c8a84',
  muted:    '#66746d',

  rule:     '#33443c',
  rule2:    '#26362f',

  accent:      '#34b483',
  accentInk:   '#10241b',
  accentSoft:  '#15382a',

  ok:       '#5fc28e',
  okSoft:   '#183526',
  warn:     '#d9a441',
  warnSoft: '#392d14',
  bad:      '#cf5b48',
  badSoft:  '#3b1e1a',
  mute:     '#7c8a84',
  muteSoft: '#22312b',
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
