import { useTheme } from '../context/ThemeContext';
import type { Palette, Typeset, Density, AccentColor } from '../context/ThemeContext';

const PALETTES: { id: Palette; label: string; bg: string; accent: string }[] = [
  { id: 'field-green', label: 'Field Green',  bg: '#141f1c', accent: '#34b483' },
  { id: 'navy',        label: 'Navy',         bg: '#0c1320', accent: '#d2674c' },
  { id: 'carbon',      label: 'Carbon',       bg: '#0b0b0d', accent: '#d9a441' },
  { id: 'slate',       label: 'Slate',        bg: '#11161d', accent: '#4f8fd1' },
  { id: 'warm-paper',  label: 'Warm Paper',   bg: '#f6f3ec', accent: '#c8553d' },
  { id: 'chalk',       label: 'Chalk',        bg: '#f5f7fb', accent: '#3d67cc' },
  { id: 'stone',       label: 'Stone',        bg: '#f0eeea', accent: '#6b5030' },
];

const ACCENTS: { id: AccentColor; label: string; hex: string }[] = [
  { id: 'signal-green', label: 'Signal Green', hex: '#34b483' },
  { id: 'indigo',       label: 'Indigo',       hex: '#5c7cfa' },
  { id: 'terracotta',   label: 'Terracotta',   hex: '#cf5b48' },
  { id: 'ochre',        label: 'Ochre',        hex: '#d9a441' },
  { id: 'plum',         label: 'Plum',         hex: '#9e6ec2' },
];

interface Props { onClose: () => void; }

export default function ThemePanel({ onClose }: Props) {
  const { palette, typeset, density, contrast, accentColor, theme,
          setPalette, setTypeset, setDensity, setContrast, setAccentColor,
          toggleTheme, pinSettings, restorePin, hasPinned } = useTheme();

  return (
    <>
      <div className="sf-scrim" onClick={onClose} />
      <aside className="sf-drawer" id="settings-drawer" aria-label="Display settings" style={{ maxWidth: 380 }}>
        <div className="sf-drawer-head">
          <div>
            <div className="sf-timecode">Interface customization</div>
            <div className="sf-drawer-title">Display Settings</div>
          </div>
          <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close settings">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {/* A — Palette */}
        <section className="sf-drawer-section" aria-labelledby="set-palette-label">
          <h3 id="set-palette-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>A — Theme Palette</h3>
          <div className="sf-set-list">
            {PALETTES.map(p => (
              <button
                key={p.id}
                className={`sf-set-option${palette === p.id ? ' is-active' : ''}`}
                onClick={() => setPalette(p.id)}
                id={`palette-${p.id}`}
              >
                <span>{p.label}</span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <span style={{ width: 12, height: 12, background: p.bg, border: '1px solid var(--rule)' }} />
                  <span style={{ width: 12, height: 12, background: p.accent, border: '1px solid var(--rule)' }} />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* B — Typeset */}
        <section className="sf-drawer-section" aria-labelledby="set-type-label">
          <h3 id="set-type-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>B — Typography</h3>
          <div className="sf-seg-ctrl">
            {(['editorial', 'compact', 'fun'] as Typeset[]).map(t => (
              <button key={t} className={typeset === t ? 'active' : ''} onClick={() => setTypeset(t)} id={`typeset-${t}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* C — Density */}
        <section className="sf-drawer-section" aria-labelledby="set-density-label">
          <h3 id="set-density-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>C — Density</h3>
          <div className="sf-seg-ctrl">
            {(['compact', 'comfortable', 'large'] as Density[]).map(d => (
              <button key={d} className={density === d ? 'active' : ''} onClick={() => setDensity(d)} id={`density-${d}`}>
                {d === 'comfortable' ? 'Normal' : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* D — Accent */}
        <section className="sf-drawer-section" aria-labelledby="set-accent-label">
          <h3 id="set-accent-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>D — Accent Colour</h3>
          <div className="sf-swatches">
            {ACCENTS.map(a => (
              <button
                key={a.id}
                className={`sf-swatch${accentColor === a.id ? ' is-active' : ''}`}
                style={{ background: a.hex }}
                onClick={() => setAccentColor(a.id)}
                aria-label={a.label}
                title={a.label}
                id={`accent-${a.id}`}
              />
            ))}
          </div>
        </section>

        {/* E — Light/Dark */}
        <section className="sf-drawer-section" aria-labelledby="set-mode-label">
          <h3 id="set-mode-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>E — Light / Dark Mode</h3>
          <div className="sf-seg-ctrl">
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => theme !== 'dark' && toggleTheme()} id="theme-dark">Dark</button>
            <button className={theme === 'light' ? 'active' : ''} onClick={() => theme !== 'light' && toggleTheme()} id="theme-light">Light</button>
          </div>
        </section>

        {/* F — Contrast */}
        <section className="sf-drawer-section" aria-labelledby="set-contrast-label">
          <h3 id="set-contrast-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>F — Accessibility Contrast</h3>
          <div className="sf-seg-ctrl">
            <button className={contrast === 'normal' ? 'active' : ''} onClick={() => setContrast('normal')} id="contrast-normal">Normal</button>
            <button className={contrast === 'high' ? 'active' : ''} onClick={() => setContrast('high')} id="contrast-high">High</button>
          </div>
        </section>

        {/* Pin */}
        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--rule-2)' }}>
          <button className="btn btn--sm" onClick={pinSettings} id="btn-pin-settings">
            ☆ Set as default
          </button>
          {hasPinned && (
            <button className="btn btn--sm" onClick={restorePin} id="btn-restore-settings">
              ↩ Restore
            </button>
          )}
        </div>
        <p className="sf-pin-note">Display preferences are applied immediately and saved locally.</p>
      </aside>
    </>
  );
}
