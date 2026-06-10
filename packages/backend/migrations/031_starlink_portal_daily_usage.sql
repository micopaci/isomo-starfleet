-- Migration 031: Daily Starlink portal usage totals and scraper audit trail.

CREATE TABLE IF NOT EXISTS site_usage_totals_daily (
  id                    BIGSERIAL PRIMARY KEY,
  site_id               INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  bytes_total           BIGINT NOT NULL CHECK (bytes_total >= 0),
  source                TEXT NOT NULL DEFAULT 'starlink_portal_scraper',
  confidence            TEXT NOT NULL DEFAULT 'portal_total'
                        CHECK (confidence IN ('portal_total', 'manual', 'derived_from_snapshot', 'cycle_reset_estimate')),
  service_line_id       TEXT,
  starlink_identifier   TEXT,
  billing_period_start  DATE,
  billing_period_end    DATE,
  scraped_at            TIMESTAMPTZ,
  uploaded_by           TEXT,
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, date)
);

CREATE INDEX IF NOT EXISTS idx_site_usage_totals_daily_date
  ON site_usage_totals_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_site_usage_totals_daily_site_date
  ON site_usage_totals_daily(site_id, date DESC);

CREATE TABLE IF NOT EXISTS starlink_portal_usage_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  site_id               INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot_date         DATE NOT NULL,
  bytes_used_cumulative BIGINT NOT NULL CHECK (bytes_used_cumulative >= 0),
  source                TEXT NOT NULL DEFAULT 'starlink_portal_scraper',
  service_line_id       TEXT,
  starlink_identifier   TEXT,
  billing_period_start  DATE,
  billing_period_end    DATE,
  collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, snapshot_date, source)
);

CREATE INDEX IF NOT EXISTS idx_starlink_portal_usage_snapshots_site_date
  ON starlink_portal_usage_snapshots(site_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS starlink_portal_scraper_runs (
  id                BIGSERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  sites_seen        INTEGER NOT NULL DEFAULT 0,
  sites_imported    INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  report_sent_at    TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_starlink_portal_scraper_runs_started_at
  ON starlink_portal_scraper_runs(started_at DESC);
