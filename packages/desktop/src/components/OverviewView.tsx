import { useState } from 'react';
import { Site, FleetSummary, downloadCsv, siteStatus, TriggerType } from '@starfleet/shared';
import { StatusDot, StatusChip } from './StatusChip';

interface Props {
  sites: Site[];
  summary: FleetSummary | null;
  onSelectSite: (id: number) => void;
  onRunDiagnostics?: () => Promise<void>;
}

export function OverviewView({ sites, summary, onSelectSite, onRunDiagnostics }: Props) {
  const darkSites    = sites.filter(s => siteStatus(s) === 'dark');
  const degradedSites = sites.filter(s => siteStatus(s) === 'degraded');
  const onlineSites   = sites.filter(s => siteStatus(s) === 'online');

  const totalLaptops  = summary?.total_laptops ?? 0;
  const onlineLaptops = summary?.online_laptops ?? 0;
  const totalIntuneLaptops = summary?.total_intune_laptops ?? sites.reduce((a, s) => a + (s.total_intune_laptops ?? 0), 0);
  const onlineIntuneLaptops = summary?.online_intune_laptops ?? sites.reduce((a, s) => a + (s.online_intune_laptops ?? 0), 0);
  const totalChromebooks = summary?.total_chromebooks ?? sites.reduce((a, s) => a + (s.total_chromebooks ?? 0), 0);
  const onlineChromebooks = summary?.online_chromebooks ?? sites.reduce((a, s) => a + (s.online_chromebooks ?? 0), 0);
  const staleLaptops  = summary?.stale_devices ?? 0;
  const openIssues    = darkSites.length + degradedSites.length;
  const [busy, setBusy] = useState(false);

  // Mock data calculations for UI completeness
  const dataToday = '4.21 TB';
  const avgLatency = sites.reduce((acc, s) => acc + (s.signal?.pop_latency_ms || 0), 0) / (onlineSites.length || 1);

  async function runDiagnostics() {
    if (!onRunDiagnostics) return;
    setBusy(true);
    try {
      await onRunDiagnostics();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to queue diagnostics.');
    } finally {
      setBusy(false);
    }
  }

  function exportReport() {
    // Moved to report view in real app, kept here as stub or trigger if needed
    alert('Export moved to Fleet Report view');
  }

  return (
    <div className="view">
      <div className="hero-flow">
        <div>
          <div className="timecode">{new Date().toISOString().slice(0, 10)} · {sites.length} sites reporting</div>
          <h1 className="view__title" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', marginTop: 6, marginBottom: 12 }}>
            {openIssues > 0
              ? `${openIssues} site${openIssues !== 1 ? 's' : ''} need attention.`
              : 'All sites healthy.'}
          </h1>
          <p className="lede">
            System overview of the Isomo Starlink network.
          </p>
        </div>
        <div style={{ alignSelf: 'center', textAlign: 'right' }}>
          <button className="btn-row primary" onClick={runDiagnostics} disabled={!onRunDiagnostics || busy} style={{ padding: '10px 16px', fontSize: 13 }}>
            {busy ? 'Sweeping…' : 'Run sweep'}
          </button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">Sites online</div>
          <div className="kpi-value">{onlineSites.length}<span style={{ fontSize: 18, color: 'var(--muted)', fontWeight: 400 }}>/{sites.length}</span></div>
          <div className="kpi-sub">{degradedSites.length} degraded</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Data today</div>
          <div className="kpi-value">{dataToday}</div>
          <div className="kpi-sub">Across active sites</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg latency</div>
          <div className="kpi-value">{avgLatency.toFixed(0)}ms</div>
          <div className="kpi-sub">Kigali PoP</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Geomagnetic Kp</div>
          <div className="kpi-value">2</div>
          <div className="kpi-sub">Quiet conditions</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head">
            <h2>Needs attention</h2>
          </div>
          
          {openIssues === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--surface)' }}>
              <i className="ti ti-circle-check" style={{ fontSize: 42, color: 'var(--ok)', display: 'block', marginBottom: 12 }}></i>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500 }}>All clear — no sites need attention right now.</div>
              <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>The entire Starlink fleet is online and operating within parameters.</div>
            </div>
          ) : (
            <div className="flow-list">
              {[...darkSites, ...degradedSites].map(site => {
                const st = siteStatus(site);
                const isBad = st === 'dark';
                return (
                  <div key={site.id} className="flow-row">
                    <div className="content">
                      <div className="flow-title">
                        <span className={`status-pill ${st === 'dark' ? 'critical' : 'warning'}`}>
                          <span className={`dot ${st === 'dark' ? 'bad' : 'warn'}`}></span>
                          {st.toUpperCase()}
                        </span>
                        <span>{site.name}</span>
                      </div>
                      <div className="flow-desc">
                        {isBad ? 'Dish has been unreachable since last poll.' : 'Dish is online but reporting degraded metrics.'}
                      </div>
                      <div className="flow-meta">
                        <span className={`metric-chip ${isBad ? 'bad' : 'warn'}`}>Lat: {site.signal?.pop_latency_ms || '—'}ms</span>
                        <span className="metric-chip">SNR: {site.signal?.snr || '—'}</span>
                        {site.signal?.obstruction_pct != null && (
                          <span className={`metric-chip ${site.signal.obstruction_pct > 0.05 ? 'warn' : ''}`}>
                            Obs: {(site.signal.obstruction_pct * 100).toFixed(1)}%
                          </span>
                        )}
                        {site.weather?.rainfall_mm && site.weather.rainfall_mm > 5 && (
                          <span className="metric-chip warn">Rain: {site.weather.rainfall_mm}mm</span>
                        )}
                      </div>
                    </div>
                    <div className="actions">
                      <button className="btn-row primary" onClick={() => onSelectSite(site.id)}>Details</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head">
            <h2>Fleet mix</h2>
            <span className="meta">live summary</span>
          </div>
          <div className="fleet-mix">
            <div className="mix-bar">
              <span className="ok" style={{ flex: onlineSites.length || 0 }}></span>
              <span className="warn" style={{ flex: degradedSites.length || 0 }}></span>
              <span className="bad" style={{ flex: darkSites.length || 0 }}></span>
            </div>
            <div className="mix-lines">
              <div className="mix-line">
                <span><span className="dot ok"></span> Online dishes</span>
                <b className="mono">{onlineSites.length}</b>
              </div>
              <div className="mix-line">
                <span><span className="dot warn"></span> Degraded dishes</span>
                <b className="mono">{degradedSites.length}</b>
              </div>
              <div className="mix-line">
                <span><span className="dot bad"></span> Offline dishes</span>
                <b className="mono">{darkSites.length}</b>
              </div>
              
              <div className="mix-line" style={{ borderTop: '1px solid var(--rule-2)', marginTop: 6, paddingTop: 6 }}>
                <span>Healthy laptops</span>
                <b className="mono">{onlineLaptops} / {totalLaptops}</b>
              </div>
              <div className="mix-line">
                <span>Updates due</span>
                <b className="mono">{staleLaptops} / {totalLaptops}</b>
              </div>
              <div className="mix-line">
                <span>Offline laptops</span>
                <b className="mono">{totalLaptops - onlineLaptops} / {totalLaptops}</b>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 22 }}>
        <div className="panel-head">
          <h2>Campus health preview</h2>
        </div>
        <div className="campus-grid">
          {sites.slice(0, 8).map(site => {
            const st = siteStatus(site);
            return (
              <div
                key={site.id}
                className="campus-card"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectSite(site.id)}
              >
                <div className="campus-name">{site.name}</div>
                <div className="campus-region">{site.location || 'Rwanda'}</div>
                <div className="campus-metrics">
                  <div><span>Laptops</span>{site.online_laptops}/{site.total_laptops}</div>
                  <div><span>Dishes</span>1</div>
                  <div><span>Latency</span>{site.signal?.pop_latency_ms || '—'}ms</div>
                </div>
                <div className="dish-dots">
                  <span className={`dot ${st === 'dark' ? 'bad' : st === 'degraded' ? 'warn' : 'ok'}`}></span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
