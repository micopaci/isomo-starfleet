import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useData, type Dish } from '../context/DataContext';

// Rwanda bounding box: roughly -1.05 to -2.84 lat, 28.86 to 30.90 lng
const RWANDA_CENTER: [number, number] = [-1.94, 29.87];
const ZOOM = 8;

function toneColor(status: string): string {
  if (status === 'online') return '#34b483';
  if (status === 'degraded') return '#d9a441';
  return '#cf5b48';
}

function createMarker(dish: Dish): L.CircleMarker {
  const color = toneColor(dish.status);
  return L.circleMarker(
    [dish.lat_coord ?? -1.94, dish.lng_coord ?? 29.87],
    { radius: 9, fillColor: color, fillOpacity: 1, color: '#0e0e0e', weight: 1, opacity: 0.5 }
  ).bindTooltip(`<strong>${dish.name}</strong><br/>${dish.campus} · ${dish.status.toUpperCase()}`, { direction: 'top', offset: [0, -6] });
}

export default function MapView() {
  const { dishes } = useData();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [selected, setSelected] = useState<Dish | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, {
      center: RWANDA_CENTER,
      zoom: ZOOM,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    leafletRef.current = map;

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leafletRef.current) return;

    const markersGroup = L.layerGroup().addTo(leafletRef.current);

    dishes.forEach(d => {
      if (!d.lat_coord) return;
      const marker = createMarker(d);
      marker.addTo(markersGroup);
      marker.on('click', () => setSelected(d));
    });

    return () => {
      markersGroup.remove();
    };
  }, [dishes]);

  return (
    <div className="sf-view" style={{ gap: 0, padding: 0 }}>
      <div className="sf-view-head" style={{ padding: '28px 28px 20px', gap: 0 }}>
        <div>
          <p className="sf-timecode">Geographic Distribution</p>
          <h1 className="sf-view-title">Fleet <em>Map</em></h1>
          <p className="sf-view-lede">All Starlink terminals across Rwanda. Click a marker for live metrics.</p>
        </div>
      </div>

      <div className="map-wrap" style={{ borderTop: '1px solid var(--rule)', flex: 1, minHeight: 560 }}>
        <div className="map-stage">
          <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 540 }} id="fleet-map" />
        </div>
        <div className="map-side">
          {selected ? (
            <>
              <div>
                <p className="sf-timecode">Selected site</p>
                <div className="sf-drawer-title" style={{ fontSize: 20 }}>{selected.name}</div>
                <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{selected.campus} · {selected.region}</p>
              </div>
              <div style={{ display: 'grid', gap: 1, background: 'var(--rule)', border: '1px solid var(--rule)' }}>
                {[
                  { l: 'Status', v: selected.status.toUpperCase(), c: toneColor(selected.status) },
                  { l: 'Latency', v: selected.latency > 0 ? `${selected.latency}ms` : '—', c: undefined },
                  { l: 'Download', v: selected.down > 0 ? `${selected.down}Mbps` : '—', c: undefined },
                  { l: 'Laptops', v: `${selected.laptops}`, c: undefined },
                  { l: 'Uptime', v: selected.uptime > 0 ? `${selected.uptime.toFixed(1)}%` : '—', c: undefined },
                  { l: 'Rain', v: selected.rain > 0 ? `${selected.rain}mm` : 'none', c: selected.rain > 5 ? 'var(--warn)' : undefined },
                ].map(row => (
                  <div key={row.l} style={{ background: 'var(--surface)', padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{row.l}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: row.c || 'var(--ink)' }}>{row.v}</span>
                  </div>
                ))}
              </div>
              <button className="btn btn--sm" onClick={() => setSelected(null)} id="btn-deselect-site">
                <i className="ti ti-x" /> Deselect
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="sf-timecode" style={{ marginBottom: 12 }}>Fleet summary</p>
                {(['online', 'degraded', 'offline'] as const).map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ width: 10, height: 10, background: toneColor(s), display: 'inline-block' }} />
                    <span style={{ flex: 1, fontSize: 12 }}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>
                      {dishes.filter(d => d.status === s).length}
                    </span>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11 }}>Click a marker on the map to view site metrics</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
