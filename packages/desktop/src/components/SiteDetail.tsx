import { useSite, useSignalHistory, useLatencyHistory } from '@starfleet/shared';
import { StarlinkCard } from './StarlinkCard';
import { SignalChart } from './SignalChart';
import { LatencyChart } from './LatencyChart';
import { LaptopTable } from './LaptopTable';

interface Props {
  siteId: number;
  isAdmin: boolean;
  onTrigger: (deviceId: number, type: string) => void;
}

export function SiteDetail({ siteId, isAdmin, onTrigger }: Props) {
  const { site, loading, error, refresh }    = useSite(siteId);
  const { scores, hasAnomalies, hasLowData } = useSignalHistory(siteId);
  const { readings }                         = useLatencyHistory(siteId);

  if (loading) return <div className="loading-state">Loading site…</div>;
  if (error)   return <div className="error-state">Error: {error} <button onClick={refresh}>Retry</button></div>;
  if (!site)   return null;

  async function handleTriggerAll() {
    if (!site) return;
    for (const d of site.devices) {
      await onTrigger(d.id, 'data_pull');
    }
  }

  return (
    <div className="site-detail">
      <div className="site-detail-header">
        <div>
          <h2>{site.name}</h2>
          <p className="muted">{site.location ?? site.starlink_sn}</p>
        </div>
        {site.score != null && (
          <div className={`score-pill score-pill-${scoreClass(site.score)}`}>
            {site.score}
            {site.score_7day_avg != null && (
              <span className="score-avg" title="7-day rolling average">
                &nbsp;/ {site.score_7day_avg} avg
              </span>
            )}
          </div>
        )}
      </div>

      <div className="detail-grid">
        <StarlinkCard site={site} isAdmin={isAdmin} onTrigger={onTrigger} />
        <SignalChart scores={scores} hasAnomalies={hasAnomalies} hasLowData={hasLowData} />
        <LatencyChart readings={readings} />
      </div>

      <LaptopTable
        devices={site.devices}
        siteId={siteId}
        isAdmin={isAdmin}
        onTrigger={onTrigger}
        onTriggerAll={handleTriggerAll}
      />
    </div>
  );
}

function scoreClass(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}
