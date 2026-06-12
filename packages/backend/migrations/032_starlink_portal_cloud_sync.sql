-- Migration 032: Direct Starlink portal cloud sync tables.
--
-- The Starlink portal APIs key terminal status and telemetry by service line,
-- while Starfleet's dashboard keys display rows by site. Keep the service line
-- as the durable primary key and attach an optional site link for UI hydration.

CREATE TABLE IF NOT EXISTS starlink_terminals (
  service_line_id     TEXT PRIMARY KEY,
  site_id             INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  nickname            TEXT,
  account_id          TEXT NOT NULL,
  current_status      TEXT NOT NULL DEFAULT 'Unknown'
                      CHECK (current_status IN ('Online', 'Offline', 'Unknown')),
  last_seen_utc       TIMESTAMPTZ,
  billing_cycle_start DATE,
  status_updated_at   TIMESTAMPTZ,
  raw_terminal        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_starlink_terminals_site_id
  ON starlink_terminals(site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_starlink_terminals_account_id
  ON starlink_terminals(account_id);

CREATE INDEX IF NOT EXISTS idx_starlink_terminals_status
  ON starlink_terminals(current_status, status_updated_at DESC);

CREATE TABLE IF NOT EXISTS starlink_usage_history (
  log_date            DATE NOT NULL,
  service_line_id     TEXT NOT NULL REFERENCES starlink_terminals(service_line_id) ON DELETE CASCADE,
  consumed_gb         NUMERIC(12, 3) NOT NULL CHECK (consumed_gb >= 0),
  account_id          TEXT,
  billing_cycle_start DATE,
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (log_date, service_line_id)
);

CREATE INDEX IF NOT EXISTS idx_starlink_usage_history_service_date
  ON starlink_usage_history(service_line_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_starlink_usage_history_log_date
  ON starlink_usage_history(log_date DESC);

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
