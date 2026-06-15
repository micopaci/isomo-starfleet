import { Site, siteStatus } from '@starfleet/shared';

interface Props {
  sites: Site[];
  onSelectSite: (id: number) => void;
}

export function CampusesView({ sites, onSelectSite }: Props) {
  return (
    <div className="view">
      <div className="hero-flow">
        <div>
          <div className="timecode">Campuses · {sites.length} sites · grid scan</div>
          <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
            Campuses
          </h1>
          <p className="lede">
            Campus cards keep the rhythm flat: site, region, laptop count, dish state, online devices, average latency, and per-dish status dots.
          </p>
        </div>
      </div>
      
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: 13, fontWeight: 600 }}>Campus grid</h2>
          <span className="meta">Showing {sites.length} of {sites.length}</span>
        </div>
        
        <div className="campus-grid">
          {sites.map(site => {
            const st = siteStatus(site);
            const latency = site.signal?.pop_latency_ms;
            const rain = site.weather_predictor?.rainfall_mm ?? 0;
            const isDark = st === 'dark';
            const regionLabel = site.district || site.location || 'Unknown region';
            
            let tone = 'ok';
            if (isDark) tone = 'bad';
            else if (st === 'degraded') tone = 'warn';

            return (
              <article 
                key={site.id} 
                className="campus-card" 
                onClick={() => onSelectSite(site.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="campus-name">{site.name}</div>
                <div className="campus-region">
                  {regionLabel} · Campus
                </div>
                <div className="campus-metrics">
                  <div><span>Laptops</span>{site.online_laptops} / {site.total_laptops}</div>
                  <div><span>Dish State</span>{isDark ? '0/1' : '1/1'}</div>
                  <div><span>pop lat</span>{latency ? `${latency}ms` : '—'}</div>
                </div>
                <div className="dish-dots">
                  {/* Primary status dot */}
                  <span className={`dot ${tone}`}></span>
                  {/* Secondary/health dots (mocked logic or simple representation) */}
                  <span className={`dot ${site.online_laptops > 0 ? 'ok' : 'bad'}`} title={`${site.online_laptops} laptops online`}></span>
                  <span className={`dot ${rain > 5 ? 'warn' : 'ok'}`} title={rain > 5 ? `Rain: ${rain}mm` : 'Clear weather'}></span>
                </div>
              </article>
            );
          })}
          
          {sites.length === 0 && (
            <div style={{ padding: 40, gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)' }}>
              No campuses found.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
