-- Starlink Fleet Monitor — Initial Schema
-- Migration 001: Create all 9 core tables

-- 1. Sites
CREATE TABLE IF NOT EXISTS sites (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  starlink_sn TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Devices (Windows laptops)
CREATE TABLE IF NOT EXISTS devices (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname    TEXT NOT NULL,
  windows_sn  TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('agent', 'standard')),
  last_seen   TIMESTAMPTZ
);

-- 3. Signal readings (Starlink dish metrics per device reporter)
CREATE TABLE IF NOT EXISTS signal_readings (
  id               SERIAL PRIMARY KEY,
  site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pop_latency_ms   NUMERIC,
  snr              NUMERIC,
  obstruction_pct  NUMERIC,
  ping_drop_pct    NUMERIC,
  reporter_count   INTEGER NOT NULL DEFAULT 1,
  confidence       TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'low'))
);

-- 4. Latency readings (per device, network latency distribution)
CREATE TABLE IF NOT EXISTS latency_readings (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  p50_ms      NUMERIC NOT NULL,
  p95_ms      NUMERIC NOT NULL,
  spread_ms   NUMERIC,
  is_outlier  BOOLEAN NOT NULL DEFAULT FALSE
);

-- 5. Daily signal scores (one per site per day, 90-day retention)
CREATE TABLE IF NOT EXISTS daily_scores (
  id      SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  score   INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  cause   TEXT NOT NULL DEFAULT '',
  UNIQUE (site_id, date)
);

-- 6. Device health snapshots
CREATE TABLE IF NOT EXISTS device_health (
  id                  SERIAL PRIMARY KEY,
  device_id           INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  battery_pct         NUMERIC,
  battery_health_pct  NUMERIC,
  disk_free_gb        NUMERIC,
  disk_total_gb       NUMERIC,
  ram_used_mb         NUMERIC,
  ram_total_mb        NUMERIC
);

-- 7. Data usage accumulator (per device per day)
CREATE TABLE IF NOT EXISTS data_usage (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  bytes_down  BIGINT NOT NULL DEFAULT 0,
  bytes_up    BIGINT NOT NULL DEFAULT 0,
  UNIQUE (device_id, date)
);

-- 8. Script trigger log (Intune remediations)
CREATE TABLE IF NOT EXISTS script_triggers (
  id            SERIAL PRIMARY KEY,
  device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  triggered_by  TEXT NOT NULL,
  type          TEXT NOT NULL,
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  result        TEXT
);

-- 9. Users (admin / viewer roles)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────── Indexes ─────────

-- recorded_at indexes (for time-range queries)
CREATE INDEX IF NOT EXISTS idx_signal_readings_recorded_at   ON signal_readings(recorded_at);
CREATE INDEX IF NOT EXISTS idx_latency_readings_recorded_at  ON latency_readings(recorded_at);
CREATE INDEX IF NOT EXISTS idx_device_health_recorded_at     ON device_health(recorded_at);
CREATE INDEX IF NOT EXISTS idx_script_triggers_triggered_at  ON script_triggers(triggered_at);

-- site_id FK indexes
CREATE INDEX IF NOT EXISTS idx_signal_readings_site_id   ON signal_readings(site_id);
CREATE INDEX IF NOT EXISTS idx_latency_readings_site_id  ON latency_readings(site_id);
CREATE INDEX IF NOT EXISTS idx_data_usage_site_id        ON data_usage(site_id);
CREATE INDEX IF NOT EXISTS idx_devices_site_id           ON devices(site_id);

-- device_id FK indexes
CREATE INDEX IF NOT EXISTS idx_signal_readings_device_id   ON signal_readings(device_id);
CREATE INDEX IF NOT EXISTS idx_latency_readings_device_id  ON latency_readings(device_id);
CREATE INDEX IF NOT EXISTS idx_device_health_device_id     ON device_health(device_id);
CREATE INDEX IF NOT EXISTS idx_data_usage_device_id        ON data_usage(device_id);
CREATE INDEX IF NOT EXISTS idx_script_triggers_device_id   ON script_triggers(device_id);

-- daily_scores date index
CREATE INDEX IF NOT EXISTS idx_daily_scores_date ON daily_scores(date);
