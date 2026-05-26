import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Site, siteStatus, computeSignalScore } from '@starfleet/shared';
import { StatusChip, StatusDot } from './StatusChip';
import { getBaseUrl, getStoredToken } from '../store/auth';

const RWANDA_CENTER: [number, number] = [29.87, -1.94];
const RWANDA_BOUNDS: [[number, number], [number, number]] = [[28.86, -2.84], [30.90, -1.05]];

const TILE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DARK_TILE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function scoreColor(site: Site): string {
  const st = siteStatus(site);
  if (st === 'online') return 'var(--ok)';
  if (st === 'degraded') return 'var(--warn)';
  return 'var(--bad)';
}

function scoreHex(site: Site): string {
  const st = siteStatus(site);
  if (st === 'online') return '#3e7d4a';
  if (st === 'degraded') return '#b7791f';
  return '#b13c3c';
}

interface Props {
  sites: Site[];
  onSelectSite: (id: number) => void;
}

interface SatPosition {
  name: string;
  lat: number;
  lng: number;
  alt_km: number;
  elevation_deg: number;
}

export function MapView({ sites, onSelectSite }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const satMarkersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(
    sites.length > 0 ? sites[0].id : null,
  );
  const [showSats, setShowSats] = useState(false);
  const [satellites, setSatellites] = useState<SatPosition[]>([]);

  const isDark = document.documentElement.classList.contains('dark');

  const pins = useMemo(() => sites
    .filter(s => s.lat != null && s.lng != null)
    .map(s => ({ site: s, lng: s.lng!, lat: s.lat! })),
  [sites]);

  const selectedSite = useMemo(
    () => pins.find(p => p.site.id === selectedId)?.site ?? pins[0]?.site ?? null,
    [pins, selectedId],
  );

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: isDark ? DARK_TILE_URL : TILE_URL,
      center: RWANDA_CENTER,
      zoom: 8,
      maxBounds: [
        [RWANDA_BOUNDS[0][0] - 0.5, RWANDA_BOUNDS[0][1] - 0.5],
        [RWANDA_BOUNDS[1][0] + 0.5, RWANDA_BOUNDS[1][1] + 0.5],
      ],
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    pins.forEach(({ site, lng, lat }) => {
      const color = scoreHex(site);
      const isSel = site.id === selectedId;
      const size = isSel ? 14 : 10;

      const el = document.createElement('div');
      el.style.cssText = `
        width: ${size + 6}px;
        height: ${size + 6}px;
        border-radius: 50%;
        background: white;
        border: 2px solid ${color};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      `;
      if (isSel) el.style.transform = 'scale(1.2)';

      const inner = document.createElement('div');
      inner.style.cssText = `
        width: ${size - 4}px;
        height: ${size - 4}px;
        border-radius: 50%;
        background: ${color};
      `;
      el.appendChild(inner);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedId(site.id);
      });

      el.addEventListener('mouseenter', () => {
        const popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          className: 'starfleet-popup',
        })
          .setLngLat([lng, lat])
          .setHTML(`
            <div style="font-family: var(--font-ui, Inter, sans-serif); font-size: 12px;">
              <strong>${site.name}</strong><br/>
              <span style="color: #888;">${site.online_laptops}/${site.total_laptops} PCs</span>
            </div>
          `)
          .addTo(map);
        popupRef.current = popup;
      });

      el.addEventListener('mouseleave', () => {
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [pins, selectedId]);

  // Fetch satellite positions when layer is on
  useEffect(() => {
    if (!showSats) { setSatellites([]); return; }
    let cancelled = false;
    const token = getStoredToken();
    const fetchSats = () => {
      if (!token) return;
      fetch(`${getBaseUrl()}/api/intel/satellites`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : { satellites: [] })
        .then(d => { if (!cancelled) setSatellites(d.satellites || []); })
        .catch(() => {});
    };
    fetchSats();
    const timer = setInterval(fetchSats, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [showSats]);

  // Render satellite markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    satMarkersRef.current.forEach(m => m.remove());
    satMarkersRef.current = [];

    satellites.forEach(sat => {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 6px; height: 6px; border-radius: 50%;
        background: #e8856f; opacity: 0.7;
        box-shadow: 0 0 4px rgba(232,133,111,0.6);
        pointer-events: auto; cursor: default;
      `;
      el.addEventListener('mouseenter', () => {
        const popup = new maplibregl.Popup({
          closeButton: false, closeOnClick: false, offset: 8,
          className: 'starfleet-popup',
        })
          .setLngLat([sat.lng, sat.lat])
          .setHTML(`
            <div style="font-family: var(--font-ui, Inter, sans-serif); font-size: 11px;">
              <strong>${sat.name}</strong><br/>
              <span style="color: #888;">Alt ${sat.alt_km} km · El ${sat.elevation_deg}°</span>
            </div>
          `);
        popup.addTo(map);
        popupRef.current = popup;
      });
      el.addEventListener('mouseleave', () => {
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([sat.lng, sat.lat])
        .addTo(map);
      satMarkersRef.current.push(marker);
    });
  }, [satellites]);

  return (
    <div className="view">
      <div className="view__header">
        <div>
          <div className="eyebrow">Geography</div>
          <h1 className="view__title">Sites across Rwanda</h1>
          <p className="view__lede">
            {pins.length} mapped site{pins.length !== 1 ? 's' : ''}.
            {' '}Color tracks aggregate health — dishes, laptops, signal.
          </p>
        </div>
        <div className="view__actions">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StatusDot status="online" /> Healthy
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StatusDot status="degraded" /> Warning
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StatusDot status="dark" /> Critical
            </span>
            <span style={{ borderLeft: '1px solid var(--rule)', paddingLeft: 14 }}>
              <button
                className={showSats ? 'btn btn--primary' : 'btn'}
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => setShowSats(prev => !prev)}
              >
                🛰 Satellites {showSats ? `(${satellites.length})` : ''}
              </button>
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', overflow: 'hidden' }}>
        <div
          ref={mapContainer}
          style={{ flex: '1 1 0', minWidth: 0, minHeight: 520 }}
        />

        {selectedSite && (
          <aside style={{
            width: 260,
            borderLeft: '1px solid var(--rule)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            flexShrink: 0,
          }}>
            <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--rule-2)' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Selected site</div>
              <div style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 20,
                letterSpacing: '-0.01em',
                marginBottom: 4,
              }}>
                {selectedSite.name}
              </div>
              {selectedSite.location && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {selectedSite.location}
                </div>
              )}
              {selectedSite.lat != null && selectedSite.lng != null && (
                <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 10 }}>
                  {Math.abs(selectedSite.lat).toFixed(3)}°{selectedSite.lat < 0 ? 'S' : 'N'},{' '}
                  {selectedSite.lng.toFixed(3)}°E
                </div>
              )}
              <StatusChip status={siteStatus(selectedSite)} />
            </div>

            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--rule-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <MapStat label="Score today"
                value={selectedSite.score != null ? String(selectedSite.score) : '—'}
                sub={selectedSite.score_7day_avg != null ? `${selectedSite.score_7day_avg} avg (7d)` : undefined}
              />
              <MapStat label="Laptops online"
                value={`${selectedSite.online_laptops} / ${selectedSite.total_laptops}`}
                sub={selectedSite.online_laptops === 0 ? 'All offline' : undefined}
                badSub={selectedSite.online_laptops === 0}
              />
              {selectedSite.signal && (
                <MapStat label="Latency"
                  value={selectedSite.signal.pop_latency_ms != null ? `${selectedSite.signal.pop_latency_ms}ms` : '—'}
                  sub={selectedSite.signal.confidence === 'low' ? 'Low confidence' : undefined}
                />
              )}
            </div>

            {selectedSite.signal && (
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--rule-2)' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Signal</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                  <SignalItem label="SNR" value={selectedSite.signal.snr?.toFixed(1) ?? '—'} />
                  <SignalItem label="Obstruct." value={selectedSite.signal.obstruction_pct != null ? `${selectedSite.signal.obstruction_pct.toFixed(1)}%` : '—'} />
                  <SignalItem label="Ping drop" value={selectedSite.signal.ping_drop_pct != null ? `${selectedSite.signal.ping_drop_pct.toFixed(1)}%` : '—'} />
                  <SignalItem label="Spread" value={selectedSite.signal.spread_ms != null ? `${selectedSite.signal.spread_ms}ms` : '—'} />
                </div>
              </div>
            )}

            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--rule-2)' }}>
              <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                Serial
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {selectedSite.starlink_sn}
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ padding: '14px 18px', borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn" onClick={() => onSelectSite(selectedSite.id)}>
                Open site detail →
              </button>
            </div>
          </aside>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">All sites</h2>
          <span className="muted" style={{ fontSize: 12 }}>{pins.length} with coordinates</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Coordinates</th>
                <th>Status</th>
                <th className="num">Score</th>
                <th className="num">Laptops</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pins.map(({ site }) => {
                const color = scoreColor(site);
                return (
                  <tr
                    key={site.id}
                    className="row-click"
                    onClick={() => {
                      setSelectedId(site.id);
                      if (mapRef.current && site.lat != null && site.lng != null) {
                        mapRef.current.flyTo({ center: [site.lng!, site.lat!], zoom: 11, duration: 800 });
                      }
                    }}
                    style={site.id === selectedId ? { background: 'var(--bg-2)' } : undefined}
                  >
                    <td>
                      <div className="cell-primary">{site.name}</div>
                      {site.location && <div className="cell-mono">{site.location}</div>}
                    </td>
                    <td className="muted mono" style={{ fontSize: 11 }}>
                      {site.lat != null ? `${Math.abs(site.lat).toFixed(3)}°${site.lat < 0 ? 'S' : 'N'}` : '—'},{' '}
                      {site.lng != null ? `${site.lng.toFixed(3)}°E` : '—'}
                    </td>
                    <td><StatusChip status={siteStatus(site)} /></td>
                    <td className="num">
                      {site.score != null
                        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color }}>{site.score}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="num mono">
                      {site.online_laptops}<span className="muted">/{site.total_laptops}</span>
                    </td>
                    <td className="row-chevron">→</td>
                  </tr>
                );
              })}
              {pins.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">No sites have coordinates set.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MapStat({
  label, value, sub, badSub,
}: {
  label: string;
  value: string;
  sub?: string;
  badSub?: boolean;
}) {
  return (
    <div>
      <div className="metric-label" style={{ marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: badSub ? 'var(--bad)' : 'var(--muted)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function SignalItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 13 }}>{value}</dd>
    </div>
  );
}
