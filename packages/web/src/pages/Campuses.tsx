import { useMemo } from 'react';
import StatusChip from '../components/StatusChip';
import { useData } from '../context/DataContext';

interface CampusGroup {
  name: string;
  region: string;
  online: number;
  degraded: number;
  offline: number;
  total: number;
  laptops: number;
}

export default function Campuses() {
  const { dishes, loading } = useData();

  const campuses: CampusGroup[] = useMemo(() => {
    const map = new Map<string, CampusGroup>();
    dishes.forEach(d => {
      if (!map.has(d.campus)) {
        map.set(d.campus, { name: d.campus, region: d.region, online: 0, degraded: 0, offline: 0, total: 0, laptops: 0 });
      }
      const c = map.get(d.campus)!;
      c.total += 1;
      c.laptops += d.laptops;
      if (d.status === 'online') c.online += 1;
      else if (d.status === 'degraded') c.degraded += 1;
      else c.offline += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [dishes]);

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading Campuses...
      </div>
    );
  }

  function overallTone(c: CampusGroup): 'ok' | 'warn' | 'bad' {
    if (c.offline > 0) return 'bad';
    if (c.degraded > 0) return 'warn';
    return 'ok';
  }

  const regions = [...new Set(campuses.map(c => c.region))].sort();

  return (
    <div className="sf-view">
      <div className="sf-view-head">
        <div>
          <p className="sf-timecode">Site Operations</p>
          <h1 className="sf-view-title">Campus <em>Grid</em></h1>
          <p className="sf-view-lede">{campuses.length} campuses across {regions.length} regions — {campuses.filter(c => c.offline > 0).length} with offline links.</p>
        </div>
      </div>

      {regions.map(region => (
        <section key={region}>
          <p className="eyebrow" style={{ marginBottom: 12 }}>{region} Region</p>
          <div className="campus-grid">
            {campuses.filter(c => c.region === region).map(c => (
              <div key={c.name} className="campus-card" id={`campus-${c.name.replace(/\s+/g, '-').toLowerCase()}`}>
                <div className="campus-name">{c.name}</div>
                <div className="campus-region">
                  <StatusChip label={overallTone(c) === 'ok' ? 'ALL ONLINE' : overallTone(c) === 'warn' ? 'DEGRADED' : 'OFFLINE'} tone={overallTone(c)} size="sm" />
                </div>
                <div className="campus-metrics">
                  <div>
                    <span>Links</span>
                    {c.total}
                  </div>
                  <div>
                    <span>Devices</span>
                    {c.laptops}
                  </div>
                  <div>
                    <span>Down</span>
                    {c.offline + c.degraded > 0 ? <span style={{ color: 'var(--bad)' }}>{c.offline + c.degraded}</span> : '0'}
                  </div>
                </div>
                <div className="campus-dots">
                  {Array.from({ length: c.online }).map((_, i) => <span key={`ok-${i}`} className="dot dot--ok" />)}
                  {Array.from({ length: c.degraded }).map((_, i) => <span key={`w-${i}`} className="dot dot--warn" />)}
                  {Array.from({ length: c.offline }).map((_, i) => <span key={`b-${i}`} className="dot dot--bad" />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
