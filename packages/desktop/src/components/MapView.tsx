import { useState, useMemo } from 'react';
import { Site, siteStatus, computeSignalScore } from '@starfleet/shared';
import { StatusChip, StatusDot } from './StatusChip';

// ─── Rwanda bounds ────────────────────────────────────────────// ─── Stylised Rwanda outline (1000×800 viewBox) ────────────────────────────────
const RWANDA_PATH = 'M 258.6 198.3 L 304.9 196.9 L 319.9 185.8 L 331.8 166.4 L 343.8 159.4 L 366.2 147.0 L 390.1 147.0 L 414.1 142.8 L 430.5 130.3 L 446.9 128.9 L 454.4 128.9 L 460.4 128.9 L 466.4 134.5 L 470.9 134.5 L 484.3 113.7 L 488.8 117.9 L 503.7 124.8 L 506.7 134.5 L 509.7 141.4 L 511.2 151.1 L 512.7 160.8 L 520.2 171.9 L 527.7 176.1 L 527.7 176.1 L 536.6 177.5 L 554.6 177.5 L 569.5 177.5 L 585.9 163.6 L 594.9 156.7 L 603.9 148.4 L 621.8 140.0 L 639.8 140.0 L 648.7 123.4 L 651.7 106.8 L 659.2 99.8 L 680.1 91.5 L 689.1 83.2 L 705.5 73.5 L 716.0 59.6 L 722.0 47.1 L 728.0 43.0 L 728.0 43.0 L 735.4 37.4 L 741.4 22.2 L 745.9 5.5 L 763.8 0.0 L 778.8 0.0 L 789.2 0.0 L 811.7 1.4 L 793.7 9.7 L 792.2 20.8 L 792.2 20.8 L 801.2 31.9 L 801.2 38.8 L 799.7 52.7 L 814.6 49.9 L 825.1 61.0 L 828.1 72.1 L 828.1 80.4 L 832.6 88.7 L 838.6 102.6 L 841.6 112.3 L 849.0 123.4 L 859.5 126.2 L 877.4 135.9 L 889.4 148.4 L 905.8 156.7 L 926.8 165.0 L 929.7 183.0 L 931.2 196.9 L 938.7 210.7 L 946.2 230.2 L 956.7 242.6 L 971.6 259.3 L 974.6 275.9 L 971.6 295.3 L 973.1 307.8 L 974.6 328.6 L 974.6 348.0 L 974.6 363.3 L 971.6 379.9 L 970.1 393.8 L 973.1 407.6 L 991.0 415.9 L 991.0 429.8 L 995.5 440.9 L 1000.0 458.9 L 1000.0 475.6 L 997.0 495.0 L 988.0 503.3 L 988.0 521.3 L 986.5 535.2 L 986.5 556.0 L 983.6 568.5 L 982.1 579.5 L 964.1 592.0 L 955.2 593.4 L 934.2 593.4 L 911.8 585.1 L 902.8 590.6 L 901.3 596.2 L 886.4 608.7 L 861.0 605.9 L 847.5 605.9 L 825.1 605.9 L 819.1 600.3 L 807.2 590.6 L 792.2 579.5 L 786.2 567.1 L 768.3 565.7 L 753.4 571.2 L 739.9 579.5 L 714.5 579.5 L 707.0 582.3 L 686.1 586.5 L 666.7 601.7 L 656.2 621.1 L 642.8 621.1 L 606.9 612.8 L 591.9 594.8 L 575.5 583.7 L 563.5 580.9 L 559.0 578.2 L 548.6 567.1 L 541.1 582.3 L 541.1 608.7 L 544.1 628.1 L 544.1 641.9 L 536.6 654.4 L 535.1 664.1 L 535.1 684.9 L 529.1 707.1 L 526.2 722.4 L 521.7 748.7 L 514.2 750.1 L 506.7 766.7 L 491.8 766.7 L 481.3 775.0 L 463.4 766.7 L 458.9 766.7 L 452.9 775.0 L 442.5 795.8 L 421.5 791.7 L 405.1 787.5 L 393.1 782.0 L 378.2 779.2 L 373.7 786.1 L 360.2 787.5 L 354.3 790.3 L 346.8 798.6 L 331.8 797.2 L 319.9 795.8 L 301.9 791.7 L 288.5 786.1 L 282.5 788.9 L 275.0 800.0 L 263.1 795.8 L 252.6 786.1 L 248.1 769.5 L 248.1 754.2 L 246.6 741.8 L 243.6 729.3 L 234.7 721.0 L 224.2 716.8 L 203.3 712.7 L 186.8 704.3 L 170.4 700.2 L 158.4 696.0 L 148.0 694.6 L 125.6 691.9 L 109.1 698.8 L 104.6 709.9 L 103.1 727.9 L 104.6 739.0 L 98.7 759.8 L 85.2 745.9 L 64.3 741.8 L 49.3 734.8 L 35.9 726.5 L 26.9 716.8 L 31.4 693.2 L 25.4 676.6 L 13.5 664.1 L 13.5 653.0 L 7.5 636.4 L 0.0 622.5 L 0.0 605.9 L 3.0 597.6 L 13.5 587.9 L 35.9 575.4 L 53.8 565.7 L 62.8 544.9 L 61.3 542.1 L 46.3 557.4 L 38.9 564.3 L 40.4 544.9 L 38.9 532.4 L 35.9 532.4 L 34.4 533.8 L 19.4 536.6 L 14.9 525.5 L 14.9 503.3 L 31.4 490.8 L 16.4 488.0 L 19.4 475.6 L 35.9 472.8 L 46.3 465.9 L 56.8 454.8 L 67.3 434.0 L 59.8 425.6 L 47.8 417.3 L 32.9 427.0 L 43.3 432.6 L 38.9 440.9 L 26.9 446.4 L 25.4 431.2 L 34.4 417.3 L 38.9 404.9 L 53.8 402.1 L 58.3 389.6 L 64.3 378.5 L 68.8 360.5 L 73.2 349.4 L 91.2 331.4 L 85.2 324.4 L 89.7 316.1 L 101.6 309.2 L 107.6 299.5 L 113.6 292.5 L 119.6 282.8 L 124.1 273.1 L 124.1 263.4 L 115.1 255.1 L 107.6 266.2 L 95.7 278.7 L 94.2 266.2 L 97.2 249.6 L 110.6 239.9 L 115.1 237.1 L 122.6 242.6 L 131.5 246.8 L 137.5 252.3 L 146.5 253.7 L 157.0 256.5 L 162.9 266.2 L 173.4 270.4 L 180.9 274.5 L 189.8 280.1 L 195.8 282.8 L 207.8 263.4 L 219.7 255.1 L 233.2 245.4 L 245.1 232.9 Z';

// ─── Lakes ─────────────────────────────────────────────────────────────────────
const LAKES = [
  { cx: 68.6, cy: 469.3, rx: 24, ry: 110, name: 'Lake Kivu' },
  { cx: 705.9, cy: 357.5, rx: 60, ry: 12, name: 'Lake Muhazi' },
  { cx: 926.5, cy: 558.7, rx: 18, ry: 50, name: 'Lake Ihema' },
];�───────────────────────────────────────────────
const LAKES = [
  { cx: 93, cy: 460, rx: 24, ry: 110, name: 'Lake Kivu' },
  { cx: 706, cy: 358, rx: 60, ry:  12, name: 'Lake Muhazi' },
  { cx: 912, cy: 559, rx: 18, ry:  50, name: 'Lake Ihema' },
];

// ─── Reference cities ──────────────────────────────────────────────────────────
const CITIES = [
  { name: 'Kigali',    lat: -1.944, lng: 30.094 },
  { name: 'Butare',    lat: -2.595, lng: 29.739 },
  { name: 'Gisenyi',   lat: -1.702, lng: 29.257 },
  { name: 'Nyagatare', lat: -1.295, lng: 30.327 },
];

function project(lat: number, lng: number) {
  const x = ((lng - RW.minLng) / (RW.maxLng - RW.minLng)) * 1000;
  const y = ((RW.maxLat - lat) / (RW.maxLat - RW.minLat)) * 800;
  return { x, y };
}

function siteTone(site: Site): 'ok' | 'warn' | 'bad' {
  const st = siteStatus(site);
  if (st === 'online')   return 'ok';
  if (st === 'degraded') return 'warn';
  return 'bad';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  sites: Site[];
  onSelectSite: (id: number) => void;
}

export function MapView({ sites, onSelectSite }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(
    sites.length > 0 ? sites[0].id : null,
  );
  const [hoveredId, setHoveredId]   = useState<number | null>(null);

  // Pin data with projected coordinates
  const pins = useMemo(() => sites
    .filter(s => s.lat != null && s.lng != null)
    .map(s => {
      const { x, y } = project(s.lat!, s.lng!);
      return { site: s, x, y, tone: siteTone(s) };
    }), [sites]);

  const cityPts = useMemo(() =>
    CITIES.map(c => ({ ...c, ...project(c.lat, c.lng) })), []);

  const selectedPin  = pins.find(p => p.site.id === selectedId) ?? pins[0] ?? null;
  const selectedSite = selectedPin?.site ?? null;

  const toneVar = (t: 'ok' | 'warn' | 'bad') =>
    t === 'ok' ? 'var(--ok)' : t === 'warn' ? 'var(--warn)' : 'var(--bad)';

  return (
    <div className="view">
      {/* Header */}
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
          </div>
        </div>
      </div>

      {/* Map + side panel */}
      <div className="card" style={{ display: 'flex', overflow: 'hidden' }}>
        {/* SVG map */}
        <div style={{ flex: '1 1 0', padding: 20, minWidth: 0, background: 'var(--surface-2)' }}>
          <svg
            viewBox="0 0 1000 800"
            style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 520 }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--rule-2)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* Grid */}
            <rect width="1000" height="800" fill="url(#mapGrid)" opacity="0.6" />

            {/* Country fill */}
            <path d={RWANDA_PATH} fill="var(--surface)" stroke="var(--ink-3)" strokeWidth="1.2" strokeLinejoin="round" />
            <path d={RWANDA_PATH} fill="none" stroke="var(--rule)" strokeWidth="6" strokeLinejoin="round" opacity="0.3" />

            {/* Lakes */}
            {LAKES.map(l => (
              <g key={l.name}>
                <ellipse cx={l.cx} cy={l.cy} rx={l.rx} ry={l.ry}
                  fill="var(--bg-2)" stroke="var(--rule)" strokeWidth="0.8" />
                <text x={l.cx + l.rx + 5} y={l.cy + 3}
                  fontSize="10" fill="var(--muted)"
                  fontFamily="var(--font-mono)" letterSpacing="0.08em">
                  {l.name.toUpperCase()}
                </text>
              </g>
            ))}

            {/* Cities */}
            {cityPts.map(c => (
              <g key={c.name}>
                <circle cx={c.x} cy={c.y} r="2.5" fill="var(--muted)" />
                <text x={c.x + 6} y={c.y + 3}
                  fontSize="10.5" fill="var(--muted)"
                  fontFamily="var(--font-mono)" letterSpacing="0.04em">
                  {c.name}
                </text>
              </g>
            ))}

            {/* Connector line to selected */}
            {selectedPin && (
              <line
                x1={selectedPin.x} y1={selectedPin.y}
                x2={selectedPin.x} y2={selectedPin.y - 42}
                stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3"
              />
            )}

            {/* Site pins */}
            {pins.map(({ site, x, y, tone }) => {
              const isSel = site.id === selectedId;
              const isHov = site.id === hoveredId;
              const r     = isSel ? 13 : isHov ? 11 : 9;
              const tc    = toneVar(tone);
              const label = site.name.split(' ')[0]; // first word as short label

              return (
                <g
                  key={site.id}
                  onMouseEnter={() => setHoveredId(site.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => setSelectedId(site.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Pulse ring for critical */}
                  {tone === 'bad' && (
                    <circle cx={x} cy={y} r={r + 6} fill={tc} opacity="0.18">
                      <animate attributeName="r" values={`${r};${r + 14};${r}`} dur="2.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.25;0;0.25" dur="2.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* Outer ring */}
                  <circle cx={x} cy={y} r={r + 3}
                    fill="var(--surface)" stroke={tc} strokeWidth={isSel ? 2 : 1.4} />
                  {/* Inner fill */}
                  <circle cx={x} cy={y} r={r - 2} fill={tc} />

                  {/* Label card — only for selected or hovered */}
                  {(isSel || isHov) && (
                    <g transform={`translate(${x + 16} ${y - 24})`}>
                      <rect x="0" y="0" width={label.length * 8 + 18} height="36"
                        fill="var(--surface)" stroke="var(--rule)" strokeWidth="1" rx="0" />
                      <text x="9" y="14"
                        fontSize="11.5" fill="var(--ink)" fontFamily="var(--font-ui)" fontWeight="500">
                        {label}
                      </text>
                      <text x="9" y="28"
                        fontSize="10" fill="var(--muted)"
                        fontFamily="var(--font-mono)" letterSpacing="0.04em">
                        {site.online_laptops}/{site.total_laptops} PCs
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Scale bar */}
            <g transform="translate(60 730)" fontFamily="var(--font-mono)">
              <line x1="0" y1="0" x2="80" y2="0" stroke="var(--ink-3)" strokeWidth="1" />
              <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--ink-3)" strokeWidth="1" />
              <line x1="80" y1="-4" x2="80" y2="4" stroke="var(--ink-3)" strokeWidth="1" />
              <text x="40" y="16" fontSize="10" fill="var(--muted)" textAnchor="middle" letterSpacing="0.08em">~50 KM</text>
            </g>

            {/* Compass */}
            <g transform="translate(940 55)" fontFamily="var(--font-mono)">
              <circle r="14" fill="none" stroke="var(--rule)" strokeWidth="1" />
              <path d="M 0 -10 L 3 0 L 0 10 L -3 0 Z" fill="var(--ink)" />
              <text y="-21" fontSize="10" fill="var(--muted)" textAnchor="middle" letterSpacing="0.08em">N</text>
            </g>
          </svg>

          {pins.length === 0 && (
            <div className="empty-state">
              No sites with location data. Add lat/lng to sites to show pins.
            </div>
          )}
        </div>

        {/* Side panel */}
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

            {/* Site stats */}
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

            {/* Signal */}
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

            {/* SN */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--rule-2)' }}>
              <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                Serial
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {selectedSite.starlink_sn}
              </div>
            </div>

            <div style={{ flex: 1 }} />

            {/* Footer */}
            <div style={{ padding: '14px 18px', borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn" onClick={() => onSelectSite(selectedSite.id)}>
                Open site detail →
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* All sites table */}
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
              {pins.map(({ site, tone }) => (
                <tr
                  key={site.id}
                  className={`row-click${site.id === selectedId ? '' : ''}`}
                  onClick={() => setSelectedId(site.id)}
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
                      ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: toneVar(tone) }}>{site.score}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num mono">
                    {site.online_laptops}<span className="muted">/{site.total_laptops}</span>
                  </td>
                  <td className="row-chevron">→</td>
                </tr>
              ))}
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

// ── helpers ────────────────────────────────────────────────────────────────────

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
