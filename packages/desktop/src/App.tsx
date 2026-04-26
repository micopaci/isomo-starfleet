import { useState, useEffect, useCallback } from 'react';
import { StarfleetApi, TriggerType, useFleetSummary, siteStatus } from '@starfleet/shared';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { MetricCards } from './components/MetricCards';
import { FleetOverview } from './components/FleetOverview';
import { OverviewView } from './components/OverviewView';
import { StarlinksView } from './components/StarlinksView';
import { ComputersView } from './components/ComputersView';
import { AlertsView } from './components/AlertsView';
import { MapView } from './components/MapView';
import { SiteDetail } from './components/SiteDetail';
import { DarkBanner } from './components/DarkBanner';
import { isLoggedIn, initClients, logout, getStoredToken, getBaseUrl } from './store/auth';

type FilterValue = 'all' | 'online' | 'degraded' | 'dark';
type NavTab = 'overview' | 'starlinks' | 'computers' | 'students' | 'alerts' | 'campuses' | 'map';

export function App() {
  const [authed, setAuthed]             = useState(isLoggedIn());
  const [selectedSiteId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter]             = useState<FilterValue>('all');
  const [darkSiteBanner, setDarkBanner] = useState<string | null>(null);
  const [dark, setDark]                 = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  // Dark mode — follow OS
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    document.documentElement.classList.toggle('dark', mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Electron dark mode bridge
  useEffect(() => {
    (window as any).electronAPI?.onDarkModeChanged?.((d: boolean) => setDark(d));
  }, []);

  // Inject Google Fonts for the new design system
  useEffect(() => {
    if (document.getElementById('starfleet-fonts')) return;
    const link = document.createElement('link');
    link.id = 'starfleet-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }, []);

  function handleLogin() {
    const token = getStoredToken()!;
    initClients(token, () => { logout(); setAuthed(false); });
    setAuthed(true);
  }

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  return (
    <AuthedApp
      selectedSiteId={selectedSiteId}
      setSelectedId={setSelectedId}
      filter={filter}
      setFilter={setFilter}
      darkSiteBanner={darkSiteBanner}
      setDarkBanner={setDarkBanner}
    />
  );
}

// ─── Authed shell ──────────────────────────────────────────────────────────────

function AuthedApp({
  selectedSiteId, setSelectedId,
  filter, setFilter,
  darkSiteBanner, setDarkBanner,
}: {
  selectedSiteId: number | null;
  setSelectedId: (id: number | null) => void;
  filter: FilterValue;
  setFilter: (f: FilterValue) => void;
  darkSiteBanner: string | null;
  setDarkBanner: (s: string | null) => void;
}) {
  const { sites, summary, loading } = useFleetSummary();
  const [activeTab, setActiveTab] = useState<NavTab>('overview');

  const [role] = useState<'admin' | 'viewer'>(() => {
    try {
      const token = getStoredToken();
      if (!token) return 'viewer';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.role === 'admin' ? 'admin' : 'viewer';
    } catch { return 'viewer'; }
  });

  // Watch for sites going dark
  useEffect(() => {
    sites.forEach(s => {
      if (siteStatus(s) === 'dark' && s.online_laptops === 0 && s.total_laptops > 0) {
        setDarkBanner(s.name);
      }
    });
  }, [sites, setDarkBanner]);

  // When a site is selected from the overview, switch to site-detail mode
  function handleSelectSite(id: number) {
    setSelectedId(id);
    setActiveTab('overview');
  }

  const makeApi = useCallback(() => (
    new StarfleetApi(getBaseUrl(), () => getStoredToken() || '', () => {
      logout();
      window.location.reload();
    })
  ), []);

  const handleTriggerSite = useCallback(async (siteId: number, type: TriggerType) => {
    const site = sites.find(s => s.id === siteId);
    const result = await makeApi().triggerSite(siteId, type);
    const label = actionLabel(type);
    alert(`${label} queued for ${site?.name ?? `site ${siteId}`} on ${result.count} managed device${result.count === 1 ? '' : 's'}.`);
  }, [makeApi, sites]);

  const handleRunFleetDiagnostics = useCallback(async () => {
    const targetSites = sites.filter(s => s.total_laptops > 0);
    let devices = 0;
    for (const site of targetSites) {
      const result = await makeApi().triggerSite(site.id, 'diagnostics');
      devices += result.count;
    }
    alert(`Diagnostics queued for ${devices} managed device${devices === 1 ? '' : 's'} across ${targetSites.length} site${targetSites.length === 1 ? '' : 's'}.`);
  }, [makeApi, sites]);

  const handleImportMonthlyUsage = useCallback(async (
    month: string,
    entries: Array<{ site_id: number; gb_total?: number; mb_total?: number; bytes_total?: number }>,
  ) => {
    const result = await makeApi().importMonthlyUsage(month, entries);
    alert(`Imported ${result.imported} monthly usage row${result.imported === 1 ? '' : 's'} for ${result.month}.`);
  }, [makeApi]);

  // Fleet stats for sidebar
  const onlineDishes = sites.filter(s => siteStatus(s) === 'online').length;
  const openAlerts   = sites.filter(s => siteStatus(s) !== 'online').length;

  const tabLabel: Record<NavTab, string> = {
    overview: 'Overview', starlinks: 'Starlinks', computers: 'Computers',
    students: 'Students', alerts: 'Alerts', campuses: 'Campuses', map: 'Map',
  };

  return (
    <div className="app-shell">
      {darkSiteBanner && (
        <DarkBanner siteName={darkSiteBanner} onDismiss={() => setDarkBanner(null)} />
      )}

      <Sidebar
        sites={sites}
        selectedId={selectedSiteId}
        filter={filter as any}
        activeTab={activeTab}
        onSelect={id => { setSelectedId(id); if (id !== null) setActiveTab('overview'); }}
        onFilter={f => setFilter(f as FilterValue)}
        onTabChange={tab => { setActiveTab(tab); setSelectedId(null); }}
        onlineDishes={onlineDishes}
        totalDishes={sites.length}
        openAlerts={openAlerts}
      />

      <main className="main-area">
        {/* Top bar */}
        <header className="topbar">
          <div className="topbar__crumbs">
            <strong>Isomo Academy</strong>
            <span style={{ color: 'var(--rule)' }}>/</span>
            <span>{tabLabel[activeTab]}</span>
            {selectedSiteId !== null && (
              <>
                <span style={{ color: 'var(--rule)' }}>/</span>
                <span>{sites.find(s => s.id === selectedSiteId)?.name}</span>
              </>
            )}
          </div>
          <div className="topbar__spacer" />
          <div className="topbar__status">
            <span>Status</span>
            <span className="val">
              {openAlerts > 0 ? `⚠ ${openAlerts} issues` : 'All systems normal'}
            </span>
          </div>
        </header>

        {loading && sites.length === 0 && (
          <div className="loading-state">Loading fleet data…</div>
        )}

        {/* Tab routing */}
        {activeTab === 'overview' && selectedSiteId === null && (
          <OverviewView
            sites={sites}
            summary={summary}
            onSelectSite={handleSelectSite}
            onRunDiagnostics={role === 'admin' ? handleRunFleetDiagnostics : undefined}
          />
        )}

        {activeTab === 'overview' && selectedSiteId !== null && (
          <SiteDetail
            siteId={selectedSiteId}
            isAdmin={role === 'admin'}
            onTrigger={async (deviceId, type) => {
              const result = await makeApi().triggerScript(deviceId, type);
              alert(`${actionLabel(type)} queued. Trigger #${result.trigger_id}.`);
            }}
          />
        )}

        {/* Placeholder views for tabs not yet wired to live API */}
        {activeTab === 'starlinks' && (
          <StarlinksView
            sites={sites}
            isAdmin={role === 'admin'}
            onSelectSite={handleSelectSite}
            onTriggerSite={handleTriggerSite}
            onImportMonthlyUsage={handleImportMonthlyUsage}
          />
        )}

        {activeTab === 'computers' && (
          <ComputersView />
        )}

        {activeTab === 'alerts' && (
          <AlertsView sites={sites} onSelectSite={handleSelectSite} />
        )}

        {activeTab === 'map' && (
          <MapView sites={sites} onSelectSite={handleSelectSite} />
        )}

        {activeTab === 'campuses' && (
          <PlaceholderView
            title="Campuses"
            lede="Per-campus breakdown — dishes, computers, and student signals."
            body={<FleetOverview sites={sites} onSelect={handleSelectSite} />}
          />
        )}

        {activeTab === 'students' && (
          <PlaceholderView
            title="Students"
            lede="Student connectivity and learning metrics — requires student data integration."
          />
        )}
      </main>
    </div>
  );
}

function actionLabel(type: TriggerType): string {
  switch (type) {
    case 'diagnostics': return 'Diagnostics';
    case 'location_refresh': return 'Location refresh';
    case 'data_pull': return 'Data pull';
    case 'ping_dish': return 'Dish ping';
    case 'reboot_starlink': return 'Starlink reboot';
  }
}

function PlaceholderView({
  title,
  lede,
  body,
}: {
  title: string;
  lede: string;
  body?: React.ReactNode;
}) {
  return (
    <div className="view">
      <div className="view__header">
        <div>
          <div className="eyebrow">Starfleet</div>
          <h1 className="view__title">{title}</h1>
          <p className="view__lede">{lede}</p>
        </div>
      </div>
      {body}
    </div>
  );
}
