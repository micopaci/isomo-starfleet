import { useState } from 'react';
import { TriggerType, useSite, useSignalHistory, useLatencyHistory, useUsageHistory, UpdateSiteInput } from '@starfleet/shared';
import { StarlinkCard } from './StarlinkCard';
import { SignalChart } from './SignalChart';
import { LatencyChart } from './LatencyChart';
import { UsageChart } from './UsageChart';
import { LaptopTable } from './LaptopTable';
import { SiteNotesPanel } from './SiteNotesPanel';
import { BiweeklyUsagePanel } from './BiweeklyUsagePanel';
import { SiteEditModal } from './SiteEditModal';

interface Props {
  siteId: number;
  isAdmin: boolean;
  onTrigger: (deviceId: number, type: TriggerType) => Promise<void>;
  onUpdateSite: (id: number, input: UpdateSiteInput) => Promise<void>;
  onAddNote: (siteId: number, body: string) => Promise<void>;
  onDeleteNote: (siteId: number, noteId: number) => Promise<void>;
  onAddBiweeklyUsage: (
    siteId: number,
    entry: { period_start: string; period_end: string; gb_down?: number; gb_up?: number; notes?: string },
  ) => Promise<void>;
  onDeleteBiweeklyUsage: (siteId: number, entryId: number) => Promise<void>;
}

export function SiteDetail({
  siteId, isAdmin, onTrigger, onUpdateSite,
  onAddNote, onDeleteNote, onAddBiweeklyUsage, onDeleteBiweeklyUsage,
}: Props) {
  const { site, loading, error, refresh }    = useSite(siteId);
  const { scores, hasAnomalies, hasLowData } = useSignalHistory(siteId);
  const { readings }                         = useLatencyHistory(siteId);
  const { usage }                            = useUsageHistory(siteId, 6);
  const [editOpen, setEditOpen]              = useState(false);

  if (loading) return <div className="loading-state">Loading site…</div>;
  if (error)   return <div className="error-state">Error: {error} <button onClick={refresh}>Retry</button></div>;
  if (!site)   return null;

  async function handleTriggerAll() {
    if (!site) return;
    for (const d of site.devices) {
      await onTrigger(d.id, 'data_pull');
    }
  }

  async function handleSaveEdit(id: number, input: UpdateSiteInput) {
    await onUpdateSite(id, input);
    refresh();
  }

  return (
    <div className="site-detail">
      <div className="site-detail-header">
        <div>
          <h2>{site.name}</h2>
          <p className="muted">{site.location ?? site.starlink_sn}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isAdmin && (
            <button
              className="btn"
              style={{ fontSize: 12 }}
              onClick={() => setEditOpen(true)}
            >
              Edit site
            </button>
          )}
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
      </div>

      <div className="detail-grid">
        <StarlinkCard site={site} isAdmin={isAdmin} onTrigger={onTrigger} />
        <SignalChart scores={scores} hasAnomalies={hasAnomalies} hasLowData={hasLowData} />
        <LatencyChart readings={readings} />
        <UsageChart usage={usage} />
      </div>

      <LaptopTable
        devices={site.devices}
        siteId={siteId}
        isAdmin={isAdmin}
        onTrigger={onTrigger}
        onTriggerAll={handleTriggerAll}
      />

      <SiteNotesPanel
        siteId={siteId}
        isAdmin={isAdmin}
        onAddNote={onAddNote}
        onDeleteNote={onDeleteNote}
      />

      <BiweeklyUsagePanel
        siteId={siteId}
        isAdmin={isAdmin}
        onAddEntry={onAddBiweeklyUsage}
        onDeleteEntry={onDeleteBiweeklyUsage}
      />

      {editOpen && (
        <SiteEditModal
          site={site}
          onSave={handleSaveEdit}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}

function scoreClass(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}
