-- Migration 017 — Agent compatibility hardening + usage pipeline extensions

-- 1) Track non-heartbeat ingest success timestamp per device
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_ingest_ok_at TIMESTAMPTZ;

-- 2) Idempotency dedupe ledger for ingest payloads (7-day rolling cleanup via cron)
CREATE TABLE IF NOT EXISTS ingest_payload_dedup (
  id          BIGSERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  payload_id  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint, device_id, payload_id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_payload_dedup_received_at
  ON ingest_payload_dedup(received_at);

-- 3) Candidate evidence for site move confirmation (must be seen on >=2 distinct days)
CREATE TABLE IF NOT EXISTS site_move_candidates (
  device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  from_site_id      INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  to_site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  first_seen_date   DATE NOT NULL,
  last_seen_date    DATE NOT NULL,
  seen_days         INTEGER NOT NULL DEFAULT 1,
  last_reported_lat NUMERIC,
  last_reported_lon NUMERIC,
  last_distance_km  NUMERIC,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, to_site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_move_candidates_device
  ON site_move_candidates(device_id);

-- 4) Monthly site total usage import (Starlink portal/manual source)
CREATE TABLE IF NOT EXISTS site_usage_totals_monthly (
  id          BIGSERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  month       DATE NOT NULL,
  bytes_total BIGINT NOT NULL CHECK (bytes_total >= 0),
  source      TEXT NOT NULL DEFAULT 'starlink_portal_manual',
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, month)
);

CREATE INDEX IF NOT EXISTS idx_site_usage_totals_monthly_month
  ON site_usage_totals_monthly(month);

-- 5) Archive for data_usage rows older than 30 days
CREATE TABLE IF NOT EXISTS data_usage_archive (
  id          BIGSERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  bytes_down  BIGINT NOT NULL DEFAULT 0,
  bytes_up    BIGINT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, date)
);

CREATE INDEX IF NOT EXISTS idx_data_usage_archive_site_date
  ON data_usage_archive(site_id, date);

-- 6) Agent health snapshots (queue depth, oldest queued payload age, version, etc.)
CREATE TABLE IF NOT EXISTS agent_health_snapshots (
  id                   BIGSERIAL PRIMARY KEY,
  device_id            INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id              INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queue_depth          INTEGER,
  oldest_queue_age_sec INTEGER,
  wifi_adapter_count   INTEGER,
  agent_version        TEXT,
  run_id               TEXT,
  last_error           TEXT,
  last_success_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_health_device_recorded_at
  ON agent_health_snapshots(device_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_health_site_recorded_at
  ON agent_health_snapshots(site_id, recorded_at DESC);

-- 7) Heartbeat-based uptime view (requested) replacing signal-based approximation
CREATE OR REPLACE VIEW site_uptime_today AS
SELECT
  d.site_id,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE
      (
        COUNT(*) FILTER (WHERE d.last_seen >= (NOW() AT TIME ZONE 'Africa/Kigali')::date)
      )::NUMERIC / COUNT(*)::NUMERIC * 100.0
  END AS uptime_pct
FROM devices d
GROUP BY d.site_id;
