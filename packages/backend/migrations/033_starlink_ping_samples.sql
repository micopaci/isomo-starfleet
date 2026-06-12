-- Migration 033: Starlink cloud ping/status sample history.
--
-- Kept separate from 032 so deployments that already applied the first cloud
-- sync migration still get the ping graph/alert storage through migrate.

CREATE TABLE IF NOT EXISTS starlink_ping_samples (
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  service_line_id  TEXT NOT NULL REFERENCES starlink_terminals(service_line_id) ON DELETE CASCADE,
  site_id          INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  current_status   TEXT NOT NULL DEFAULT 'Unknown'
                   CHECK (current_status IN ('Online', 'Offline', 'Unknown')),
  is_offline       BOOLEAN,
  ping_latency_ms  NUMERIC,
  ping_drop_pct    NUMERIC,
  last_seen_utc    TIMESTAMPTZ,
  raw_terminal     JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (recorded_at, service_line_id)
);

CREATE INDEX IF NOT EXISTS idx_starlink_ping_samples_service_time
  ON starlink_ping_samples(service_line_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_starlink_ping_samples_site_time
  ON starlink_ping_samples(site_id, recorded_at DESC)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_starlink_ping_samples_status_time
  ON starlink_ping_samples(current_status, recorded_at DESC);
