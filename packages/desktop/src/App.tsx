import { useState, useEffect, useCallback } from 'react';
import { useFleetSummary, siteStatus } from '@starfleet/shared';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { MetricCards } from './components/MetricCards';
import { FleetOverview } from './components/FleetOverview';
import { SiteDetail } from './components/SiteDetail';
import { DarkBanner } from './components/DarkBanner';
import { isLoggedIn, initClients, logout, getStoredToken } from './store/auth';

type FilterValue = 'all' | 'online' | 'degraded' | 'dark';

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

  function handleLogin() {
    const token = getStoredToken()!;
    initClients(token, () => { logout(); setAuthed(false); });
    setAuthed(true);
  }

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  return <AuthedApp
    selectedSiteId={selectedSiteId}
    setSelectedId={setSelectedId}
    filter={filter}
    setFilter={setFilter}
    darkSiteBanner={darkSiteBanner}
    setDarkBanner={setDarkBanner}
  />;
}

// ─── Authed shell — uses hooks that need the API client to be initialised ─────

function AuthedApp({ selectedSiteId, setSelectedId, filter, setFilter, darkSiteBanner, setDarkBanner }: {
  selectedSiteId: number | null;
  setSelectedId: (id: number | null) => void;
  filter: FilterValue;
  setFilter: (f: FilterValue) => void;
  darkSiteBanner: string | null;
  setDarkBanner: (s: string | null) => void;
}) {
  const { sites, summary, loading } = useFleetSummary();
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

  async function handleTrigger(deviceId: number, type: string) {
    try {
      const { StarfleetApi } = await import('@starfleet/shared');
      // Use global api via import — already initialised
      console.log(`Trigger ${type} on device ${deviceId}`);
    } catch (e) {
      console.error('Trigger failed', e);
    }
  }

  return (
    <div className="app-shell">
      {darkSiteBanner && (
        <DarkBanner siteName={darkSiteBanner} onDismiss={() => setDarkBanner(null)} />
      )}

      <Sidebar
        sites={sites}
        selectedId={selectedSiteId}
        filter={filter as any}
        onSelect={setSelectedId}
        onFilter={f => setFilter(f as FilterValue)}
      />

      <main className="main-area">
        <MetricCards summary={summary} />

        {loading && sites.length === 0 && (
          <div className="loading-state">Loading fleet data…</div>
        )}

        {selectedSiteId === null ? (
          <FleetOverview sites={sites} onSelect={setSelectedId} />
        ) : (
          <SiteDetail
            siteId={selectedSiteId}
            isAdmin={role === 'admin'}
            onTrigger={handleTrigger}
          />
        )}
      </main>
    </div>
  );
}
