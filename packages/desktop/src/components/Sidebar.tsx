import { Site, siteStatus, SiteStatusValue } from '@starfleet/shared';

type FilterValue = 'all' | SiteStatusValue;
export type NavTab = 'overview' | 'starlinks' | 'computers' | 'alerts' | 'campuses' | 'map' | 'report';

interface Props {
  sites: Site[];
  selectedId: number | null;
  filter: FilterValue;
  activeTab: NavTab;
  onSelect: (id: number | null) => void;
  onFilter: (f: FilterValue) => void;
  onTabChange: (tab: NavTab) => void;
  onOpenSettings: () => void;
  kpData?: { k_index: number } | null;
  fleetUptime?: string;
  onlineDishes?: number;
  totalDishes?: number;
  openAlerts?: number;
}

const OPS_ITEMS: { id: NavTab; label: string; icon?: string }[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'starlinks', label: 'Starlinks' },
  { id: 'computers', label: 'Computers' },
  { id: 'alerts',    label: 'Alerts' },
  { id: 'campuses',  label: 'Campuses' },
  { id: 'map',       label: 'Map' },
];

export function Sidebar({
  sites, activeTab,
  onTabChange, onOpenSettings,
  kpData,
  onlineDishes = 0, totalDishes = 0, openAlerts = 0,
}: Props) {

  // Mock data for computers counts
  const totalComputers = 301;
  const rainSites = 3;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-name">Starfleet <span>Isomo ops</span></div>
      </div>

      <div>
        <div className="nav-label">Operations</div>
        <nav className="nav" aria-label="Primary Ops">
          {OPS_ITEMS.map(item => (
            <button
              key={item.id}
              className={activeTab === item.id ? 'active' : ''}
              onClick={() => onTabChange(item.id)}
            >
              {item.label}
              {item.id === 'alerts' && <small id="lbl-badge-alerts">{openAlerts}</small>}
              {item.id === 'starlinks' && <small>{totalDishes}</small>}
              {item.id === 'computers' && <small>{totalComputers}</small>}
              {item.id === 'campuses' && <small>{totalDishes}</small>}
              {item.id === 'map' && <small>RW</small>}
            </button>
          ))}
        </nav>
        
        <div className="nav-label" style={{ marginTop: 18 }}>Reports</div>
        <nav className="nav" aria-label="Primary Reports">
          <button
            className={activeTab === 'report' ? 'active' : ''}
            onClick={() => onTabChange('report')}
          >
            Fleet Report <small><i className="ti ti-file-analytics"></i></small>
          </button>
        </nav>
      </div>

      <div className="sidebar-tools">
        <label>
          <span className="field-label">Campus region</span>
          <select className="campus-region-selector" defaultValue="all">
            <option value="all">All campuses</option>
            <option value="Eastern">Eastern region</option>
            <option value="Western">Western region</option>
            <option value="Northern">Northern region</option>
            <option value="Southern">Southern region</option>
            <option value="Central">Central region</option>
          </select>
        </label>
        
        <button 
          className="quiet-btn" 
          onClick={onOpenSettings}
          style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <i className="ti ti-settings"></i> Settings
        </button>
        
        <div className="mini-hud">
          <div className="line">
            <span>kp index</span>
            <b style={{ color: kpData && kpData.k_index >= 5 ? 'var(--bad)' : kpData && kpData.k_index >= 4 ? 'var(--warn)' : 'var(--info)' }}>
              {kpData ? `${kpData.k_index} ${kpData.k_index >= 4 ? 'storm' : 'quiet'}` : '—'}
            </b>
          </div>
          <div className="line"><span>rain &gt;5mm</span><b>{rainSites} sites</b></div>
          <div className="line"><span>sat overhead</span><b>18</b></div>
        </div>
      </div>
    </aside>
  );
}
