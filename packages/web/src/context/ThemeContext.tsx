import React, { createContext, useContext, useEffect, useState } from 'react';

export type Palette = 'field-green' | 'navy' | 'carbon' | 'slate' | 'warm-paper' | 'chalk' | 'stone';
export type Typeset = 'editorial' | 'compact' | 'fun';
export type Density = 'comfortable' | 'compact' | 'large';
export type Contrast = 'normal' | 'high';
export type AccentColor = 'signal-green' | 'indigo' | 'terracotta' | 'ochre' | 'plum';
export type Theme = 'light' | 'dark';

const LIGHT_PALETTES = new Set<Palette>(['warm-paper', 'chalk', 'stone']);

interface ThemeState {
  palette: Palette;
  typeset: Typeset;
  density: Density;
  contrast: Contrast;
  accentColor: AccentColor;
  theme: Theme;
}

interface ThemeContextValue extends ThemeState {
  setPalette: (p: Palette) => void;
  setTypeset: (t: Typeset) => void;
  setDensity: (d: Density) => void;
  setContrast: (c: Contrast) => void;
  setAccentColor: (a: AccentColor) => void;
  toggleTheme: () => void;
  pinSettings: () => void;
  restorePin: () => void;
  hasPinned: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readLS(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function applyToHTML(state: ThemeState) {
  const h = document.documentElement;
  h.dataset.palette = state.palette;
  h.dataset.theme = state.theme;
  h.dataset.typeset = state.typeset;
  h.dataset.density = state.density;
  h.dataset.contrast = state.contrast;
  h.dataset.accentColor = state.accentColor;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ThemeState>(() => {
    const palette = readLS('sf_palette', 'field-green') as Palette;
    const lsTheme = localStorage.getItem('sf_theme') as Theme | null;
    return {
      palette,
      typeset: readLS('sf_typeset', 'editorial') as Typeset,
      density: readLS('sf_density', 'comfortable') as Density,
      contrast: readLS('sf_contrast', 'normal') as Contrast,
      accentColor: readLS('sf_accent', 'signal-green') as AccentColor,
      theme: lsTheme || (LIGHT_PALETTES.has(palette) ? 'light' : 'dark'),
    };
  });
  const [hasPinned, setHasPinned] = useState(() => !!localStorage.getItem('sf_pin_palette'));

  useEffect(() => { applyToHTML(state); }, [state]);

  function update(patch: Partial<ThemeState>) {
    setState(prev => {
      const next = { ...prev, ...patch };
      if (patch.palette) {
        next.theme = LIGHT_PALETTES.has(patch.palette) ? 'light' : 'dark';
      }
      Object.entries({
        sf_palette: next.palette,
        sf_typeset: next.typeset,
        sf_density: next.density,
        sf_contrast: next.contrast,
        sf_accent: next.accentColor,
        sf_theme: next.theme,
      }).forEach(([k, v]) => localStorage.setItem(k, v));
      return next;
    });
  }

  const setPalette = (p: Palette) => update({ palette: p });
  const setTypeset = (t: Typeset) => update({ typeset: t });
  const setDensity = (d: Density) => update({ density: d });
  const setContrast = (c: Contrast) => update({ contrast: c });
  const setAccentColor = (a: AccentColor) => update({ accentColor: a });
  const toggleTheme = () => {
    setState(prev => {
      const nextTheme: Theme = prev.theme === 'dark' ? 'light' : 'dark';
      const next: ThemeState = { ...prev, theme: nextTheme };
      if (nextTheme === 'dark' && LIGHT_PALETTES.has(prev.palette)) {
        next.palette = 'carbon';
      } else if (nextTheme === 'light' && !LIGHT_PALETTES.has(prev.palette)) {
        next.palette = 'chalk';
      }
      applyToHTML(next);
      Object.entries({
        sf_palette: next.palette,
        sf_theme: next.theme,
      }).forEach(([k, v]) => localStorage.setItem(k, v));
      return next;
    });
  };

  const pinSettings = () => {
    ['sf_palette', 'sf_typeset', 'sf_density', 'sf_accent', 'sf_contrast'].forEach(k => {
      const v = localStorage.getItem(k);
      if (v) localStorage.setItem(k.replace('sf_', 'sf_pin_'), v);
    });
    setHasPinned(true);
  };

  const restorePin = () => {
    const pinPal = localStorage.getItem('sf_pin_palette');
    if (!pinPal) return;
    update({
      palette: pinPal as Palette,
      typeset: (localStorage.getItem('sf_pin_typeset') || 'editorial') as Typeset,
      density: (localStorage.getItem('sf_pin_density') || 'comfortable') as Density,
      accentColor: (localStorage.getItem('sf_pin_accent') || 'signal-green') as AccentColor,
      contrast: (localStorage.getItem('sf_pin_contrast') || 'normal') as Contrast,
    });
  };

  return (
    <ThemeContext.Provider value={{ ...state, setPalette, setTypeset, setDensity, setContrast, setAccentColor, toggleTheme, pinSettings, restorePin, hasPinned }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
