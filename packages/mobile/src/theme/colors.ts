/**
 * Re-export shared theme tokens with mobile-compatible aliases.
 */
import {
  type ColorTokens,
  lightColors,
  darkColors,
  scoreToHex,
  latencyToHex,
} from '@starfleet/shared';

export type Colors = ColorTokens & {
  text: string;
  text2: string;
  border: string;
  white: string;
  online: string;
  degraded: string;
  dark: string;
};

function withAliases(base: ColorTokens): Colors {
  return {
    ...base,
    text:     base.ink,
    text2:    base.muted,
    border:   base.rule,
    white:    base.surface,
    online:   base.ok,
    degraded: base.warn,
    dark:     base.bad,
  };
}

export const light: Colors = withAliases(lightColors);
export const dark: Colors  = withAliases(darkColors);

export function scoreColor(score: number, colors: Colors = light): string {
  return scoreToHex(score, colors);
}

export function latencyColor(ms: number | null | undefined, colors: Colors = light): string {
  return latencyToHex(ms, colors);
}

export function toneColor(tone: 'ok' | 'warn' | 'bad' | 'mute', colors: Colors = light): string {
  return { ok: colors.ok, warn: colors.warn, bad: colors.bad, mute: colors.muted }[tone];
}
