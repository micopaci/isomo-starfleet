import { Site, siteStatus, SiteStatusValue } from '@starfleet/shared';

type FilterValue = 'all' | SiteStatusValue;
type NavTab = 'overview' | 'starlinks' | 'computers' | 'students' | 'alerts' | 'campuses' | 'map';

interface Props {
  sites: Site[];
  selectedId: number | null;
  filter: FilterValue;
  activeTab: NavTab;
  onSelect: (id: number | null) => void;
  onFilter: (f: FilterValue) => void;
  onTabChange: (tab: NavTab) => void;
  fleetUptime?: string;
  onlineDishes?: number;
  totalDishes?: number;
  openAlerts?: number;
}

const TONE: Record<SiteStatusValue, string> = {
  online:   'ok',
  degraded: 'warn',
  dark:     'bad',
};

const NAV_ITEMS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'overview',  label: 'Overview',  icon: '⊞' },
  { id: 'starlinks', label: 'Starlinks', icon: '◎' },
  { id: 'computers', label: 'Computers', icon: '⊡' },
  { id: 'students',  label: 'Students',  icon: '◯' },
  { id: 'alerts',    label: 'Alerts',    icon: '◬' },
  { id: 'campuses',  label: 'Campuses',  icon: '⌂' },
  { id: 'map',       label: 'Map',       icon: '⊠' },
];

export function Sidebar({
  sites, selectedId, filter, activeTab,
  onSelect, onFilter, onTabChange,
  fleetUptime, onlineDishes = 0, totalDishes = 0, openAlerts = 0,
}: Props) {
  const filters: FilterValue[] = ['all', 'online', 'degraded', 'dark'];
  const visible = sites.filter(s => filter === 'all' ? true : siteStatus(s) === filter);

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-header">
        <div className="sidebar-logo" aria-hidden>S</div>
        <div className="sidebar-wordmark">
          Starfleet
          <small>Isomo Ops</small>
        </div>
      </div>

      {/* Main nav */}
      <div>
        <div className="sidebar-section-label">Operations</div>
        <nav className="site-list" role="navigation">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`site-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => onTabChange(item.id)}
            >
              <span style={{ fontSize: 13, opacity: 0.7, flexShrink: 0 }}>{item.icon}</span>
              <span className="site-name">{item.label}</span>
              {item.id === 'alerts' && openAlerts > 0 && (
                <span className="site-count" style={{ color: 'var(--bad)' }}>{openAlerts}</span>
              )}
              {item.id === 'starlinks' && (
                <span className="site-count">{onlineDishes}/{totalDishes}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Site filter (visible when in overview/site-focused mode) */}
      {activeTab === 'overview' && (
        <div>
          <div className="sidebar-section-label">Filter sites</div>
          <div className="filter-row">
            {filters.map(f => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => onFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <nav className="site-list">
            <button
              className={`site-item ${selectedId === null ? 'active' : ''}`}
              onClick={() => onSelect(null)}
            >
              <span className={`site-dot status-online`} />
              <span className="site-name">All sites</span>
            </button>
            {visible.map(site => {
              const st = siteStatus(site);
              return (
                <button
                  key={site.id}
                  className={`site-item ${selectedId === site.id ? 'active' : ''}`}
                  onClick={() => onSelect(site.id)}
                >
                  <span className={`site-dot status-${st}`} />
                  <span className="site-name">{site.name}</span>
                  <span className="site-count">{site.online_laptops}/{site.total_laptops}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Foot — fleet pulse */}
      <div className="sidebar-foot">
        <div className="sidebar-pulse">
          <div className="sidebar-pulse__label">Fleet uptime · 30d</div>
          <div className="sidebar-pulse__value">
            {fleetUptime ?? '—'}
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>%</span>
          </div>
          <div className="sidebar-pulse__sub">{onlineDishes}/{totalDishes} dishes online</div>
        </div>
      </div>
    </aside>
  );
}
