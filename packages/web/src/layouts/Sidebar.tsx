import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import ThemePanel from './ThemePanel';
import { useState } from 'react';
import { useData } from '../context/DataContext';

const REPORT_NAV = [
  { path: '/report', label: 'Fleet Report', icon: 'ti-file-analytics', count: '' },
  { path: '/decommissioned', label: 'Decommissioned', icon: 'ti-circle-off', count: '' },
];

export default function Sidebar() {
  const loc = useLocation();
  const nav = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { dishes, inactiveDishes, alerts, inventory, intel, securitySummary, loading } = useData();

  const openAlertsCount = alerts.filter(a => a.open).length;
  const campusesCount = new Set(dishes.map(d => d.campus).filter(Boolean)).size;
  const offlineDishes = dishes.filter(d => d.status !== 'online').length;
  const totalStarlinks = dishes.length + inactiveDishes.length;
  const criticalVulns = securitySummary?.critical ?? 0;

  const items = [
    { path: '/overview',   label: 'Overview',     icon: 'ti-layout-dashboard', count: loading ? '' : String(offlineDishes) },
    { path: '/starlinks',  label: 'Starlinks',     icon: 'ti-antenna',          count: loading ? '' : String(totalStarlinks) },
    { path: '/alerts',     label: 'Alerts',        icon: 'ti-bell',             count: loading ? '' : String(openAlertsCount) },
    { path: '/security',   label: 'Security',      icon: 'ti-shield-lock',      count: criticalVulns > 0 ? String(criticalVulns) : '' },
    { path: '/campuses',   label: 'Campuses',      icon: 'ti-school',           count: loading ? '' : String(campusesCount) },
    { path: '/map',        label: 'Map',           icon: 'ti-map',              count: 'RW' },
    { path: '/inventory',  label: 'Computers',     icon: 'ti-device-laptop',    count: loading ? '' : String(inventory.length) },
  ];

  function isActive(path: string) {
    return loc.pathname === path || (path === '/overview' && loc.pathname === '/');
  }

  return (
    <>
      <aside className="sf-sidebar" aria-label="Main navigation">
        <div className="sf-brand">
          <div className="sf-brand-mark" aria-hidden="true">S</div>
          <div className="sf-brand-name">
            Starfleet
            <span>Isomo ops</span>
          </div>
        </div>

        <nav aria-label="Operations">
          <p className="sf-nav-label">Operations</p>
          <ul className="sf-nav" role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map(item => (
              <li key={item.path}>
                <button
                  className={`sf-nav-item${isActive(item.path) ? ' is-active' : ''}`}
                  onClick={() => nav(item.path)}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  id={`nav-${item.label.toLowerCase()}`}
                >
                  <span className="sf-nav-item-icon"><i className={`ti ${item.icon}`} aria-hidden="true" /></span>
                  <span className="sf-nav-item-label">{item.label}</span>
                  {item.count && <span className="sf-nav-item-count">{item.count}</span>}
                </button>
              </li>
            ))}
          </ul>

          <p className="sf-nav-label" style={{ marginTop: 14 }}>Reports</p>
          <ul className="sf-nav" role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {REPORT_NAV.map(item => (
              <li key={item.path}>
                <button
                  className={`sf-nav-item${isActive(item.path) ? ' is-active' : ''}`}
                  onClick={() => nav(item.path)}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="sf-nav-item-icon"><i className={`ti ${item.icon}`} aria-hidden="true" /></span>
                  <span className="sf-nav-item-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sf-sidebar-foot">
          <div className="sf-mini-hud">
            <div className="sf-mini-hud-row">
              <span>kp index</span>
              <b style={{ color: intel.kpIndex != null && intel.kpIndex >= 5 ? 'var(--bad)' : intel.kpIndex != null && intel.kpIndex >= 4 ? 'var(--warn)' : 'var(--info)' }}>
                {loading ? '...' : intel.kpIndex != null ? `${intel.kpIndex} ${intel.kpLabel}` : '—'}
              </b>
            </div>
            <div className="sf-mini-hud-row">
              <span>rain &gt;5mm</span>
              <b>{loading ? '...' : `${dishes.filter(d => d.rain > 5).length} sites`}</b>
            </div>
            <div className="sf-mini-hud-row">
              <span>sat overhead</span>
              <b>{loading ? '...' : intel.satCount != null ? intel.satCount : '—'}</b>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--sm"
              style={{ flex: 1, justifyContent: 'center', gap: 6 }}
              onClick={() => setSettingsOpen(true)}
              id="btn-open-settings"
              aria-label="Open display settings"
            >
              <i className="ti ti-settings" aria-hidden="true" />
              <span className="sf-nav-item-label">Settings</span>
            </button>
            <button
              className="btn btn--sm btn--icon"
              onClick={toggleTheme}
              id="btn-toggle-theme"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <i className={`ti ${theme === 'dark' ? 'ti-sun' : 'ti-moon'}`} aria-hidden="true" />
            </button>
            <button
              className="btn btn--sm btn--icon"
              onClick={() => { localStorage.removeItem('sf_token'); localStorage.removeItem('sf_auth'); nav('/login'); }}
              id="btn-logout"
              aria-label="Sign out"
            >
              <i className="ti ti-logout" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {settingsOpen && <ThemePanel onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
