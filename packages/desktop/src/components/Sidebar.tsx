import { Site, siteStatus, SiteStatusValue } from '@starfleet/shared';

type FilterValue = 'all' | SiteStatusValue;

interface Props {
  sites: Site[];
  selectedId: number | null;
  filter: FilterValue;
  onSelect: (id: number | null) => void;
  onFilter: (f: FilterValue) => void;
}

const DOT_COLOR: Record<SiteStatusValue, string> = {
  online: '#22c55e',
  degraded: '#f59e0b',
  dark: '#ef4444',
};

export function Sidebar({ sites, selectedId, filter, onSelect, onFilter }: Props) {
  const filters: FilterValue[] = ['all', 'online', 'degraded', 'dark'];

  const visible = sites.filter(s =>
    filter === 'all' ? true : siteStatus(s) === filter,
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">🛰</span>
        <span className="sidebar-title">Starfleet</span>
      </div>

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

      <div className="site-list">
        <button
          className={`site-item ${selectedId === null ? 'active' : ''}`}
          onClick={() => onSelect(null)}
        >
          <span className="site-dot" style={{ background: '#6366f1' }} />
          <span className="site-name">Fleet Overview</span>
        </button>

        {visible.map(site => {
          const status = siteStatus(site);
          return (
            <button
              key={site.id}
              className={`site-item ${selectedId === site.id ? 'active' : ''}`}
              onClick={() => onSelect(site.id)}
            >
              <span className="site-dot" style={{ background: DOT_COLOR[status] }} />
              <span className="site-name">{site.name}</span>
              <span className="site-count">{site.online_laptops}/{site.total_laptops}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
