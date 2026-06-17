import { useEffect, useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const PALETTES = [
  { id: 'field-green', name: 'Field green', swatches: ['#24825f', '#fbfcf8', '#141f1c'] },
  { id: 'navy',        name: 'Navy',        swatches: ['#d2674c', '#131d2e', '#0c1320'] },
  { id: 'carbon',      name: 'Carbon',      swatches: ['#d9a441', '#141418', '#0b0b0d'] },
  { id: 'slate',       name: 'Slate',       swatches: ['#4f8fd1', '#181f28', '#11161d'] },
  { id: 'warm-paper',  name: 'Warm paper',  swatches: ['#c8553d', '#fdfaf5', '#ede9e0'] },
  { id: 'chalk',       name: 'Chalk',       swatches: ['#3d67cc', '#ffffff', '#edf0f7'] },
  { id: 'stone',       name: 'Stone',       swatches: ['#6b5030', '#faf8f5', '#e5e2db'] },
];

export function SettingsDrawer({ isOpen, onClose }: Props) {
  const [palette, setPalette] = useState('field-green');
  const [typeset, setTypeset] = useState('editorial');
  const [density, setDensity] = useState('comfortable');
  const [contrast, setContrast] = useState('normal');

  useEffect(() => {
    setPalette(localStorage.getItem('sf_palette') || localStorage.getItem('sf_pin_palette') || 'field-green');
    setTypeset(localStorage.getItem('sf_typeset') || localStorage.getItem('sf_pin_typeset') || 'editorial');
    setDensity(localStorage.getItem('sf_density') || localStorage.getItem('sf_pin_density') || 'comfortable');
    setContrast(localStorage.getItem('sf_contrast') || localStorage.getItem('sf_pin_contrast') || 'normal');
  }, [isOpen]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateAttr = (key: string, val: string, storageKey: string) => {
    document.documentElement.setAttribute(`data-${key}`, val);
    localStorage.setItem(storageKey, val);
    if (key === 'palette') {
      const light = new Set(['warm-paper', 'chalk', 'stone']);
      document.documentElement.setAttribute('data-theme', light.has(val) ? 'light' : 'dark');
    }
  };

  const handlePalette = (p: string) => { setPalette(p); updateAttr('palette', p, 'sf_palette'); };
  const handleTypeset = (t: string) => { setTypeset(t); updateAttr('typeset', t, 'sf_typeset'); };
  const handleDensity = (d: string) => { setDensity(d); updateAttr('density', d, 'sf_density'); };
  const handleContrast = (c: string) => { setContrast(c); updateAttr('contrast', c, 'sf_contrast'); };

  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <aside className="drawer open" id="settings-drawer" aria-label="Display Settings">
        <div className="drawer-head">
          <div className="drawer-title" style={{ fontSize: 18 }}>Appearance</div>
          <button className="quiet-btn" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Close settings">
            <i className="ti ti-x" style={{ fontStyle: 'normal' }}>✕</i>
          </button>
        </div>
        <div className="drawer-body">
          <div className="set-row">
            <label>Color Palette</label>
            <div className="set-options-list">
              {PALETTES.map(p => (
                <button
                  key={p.id}
                  className={`set-btn ${palette === p.id ? 'active' : ''}`}
                  onClick={() => handlePalette(p.id)}
                >
                  {p.name}
                  <div className="swatches-preview">
                    {p.swatches.map((c, i) => <span key={i} style={{ background: c }}></span>)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <label>Typeset</label>
            <div className="seg-ctrl">
              <button className={typeset === 'editorial' ? 'active' : ''} onClick={() => handleTypeset('editorial')}>Editorial</button>
              <button className={typeset === 'terminal' ? 'active' : ''} onClick={() => handleTypeset('terminal')}>Terminal</button>
              <button className={typeset === 'clean-sans' ? 'active' : ''} onClick={() => handleTypeset('clean-sans')}>Clean</button>
            </div>
          </div>

          <div className="set-row">
            <label>Density</label>
            <div className="seg-ctrl">
              <button className={density === 'compact' ? 'active' : ''} onClick={() => handleDensity('compact')}>Compact</button>
              <button className={density === 'comfortable' ? 'active' : ''} onClick={() => handleDensity('comfortable')}>Comfortable</button>
              <button className={density === 'large' ? 'active' : ''} onClick={() => handleDensity('large')}>Large</button>
            </div>
          </div>

          <div className="set-row">
            <label>Contrast</label>
            <div className="seg-ctrl">
              <button className={contrast === 'normal' ? 'active' : ''} onClick={() => handleContrast('normal')}>Normal</button>
              <button className={contrast === 'high' ? 'active' : ''} onClick={() => handleContrast('high')}>High</button>
            </div>
          </div>

          <div className="drawer-actions-grid" style={{ marginTop: 'auto' }}>
            <button 
              onClick={() => {
                localStorage.setItem('sf_pin_palette', palette);
                localStorage.setItem('sf_pin_typeset', typeset);
                localStorage.setItem('sf_pin_density', density);
                localStorage.setItem('sf_pin_contrast', contrast);
                alert('Preferences pinned as default.');
              }}
            >
              Pin as default
            </button>
            <button 
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
            >
              Reset all
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
