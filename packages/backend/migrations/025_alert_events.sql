-- Migration 025: Durable fleet alert events
-- Tracks web-facing alerts across connectivity, signal, weather, and site moves.

CREATE TABLE IF NOT EXISTS alert_events (
  id              BIGSERIAL PRIMARY KEY,
  active_key      TEXT NOT NULL UNIQUE,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  site_id         INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  device_id       INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alert_events_status_seen
  ON alert_events(status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_site_seen
  ON alert_events(site_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_category_seen
  ON alert_events(category, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_open
  ON alert_events(last_seen_at DESC)
  WHERE status = 'open';
